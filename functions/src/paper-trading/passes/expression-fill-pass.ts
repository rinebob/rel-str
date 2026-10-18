/**
 * @topic #553 — Paper Trading Infra (task #564)
 * @topic #984 — ST Firestore Reorg (task #1005)
 *
 * expression-fill-pass — noon-PT fill of pending signal expressions.
 * Sources (#1005):
 *  - staged `pap_*` tickets carrying `terms.expressionTemplate` — the
 *    pending expression lives on the ticket; the trade is MINTED here under a
 *    canonical `{SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN}` id.
 *  - legacy `PENDING` trades — pre-#1005 docs still drain in place
 *    (`applyPendingFill`), including a staged ticket whose seed id still
 *    has its PENDING trade (filled in place, not re-minted).
 * For each item: `get_option_chains` → in-band expirations →
 * `get_option_instruments` → batched `get_option_quotes` →
 * `selectOptionContract` by template delta/DTE → fill → mark the source
 * ticket `filled` + join the minted trade to its position group.
 *
 * Read-only: only quote/chain MCP tools are invoked — no `place_*`/`review_*`
 * broker mutations exist on this path.
 */

import { buildOccContractId, OptionQuoteSource } from '@options/common';
import type { PaperTrade } from '@paper-trading/contracts';
import { calendarDaysBetween } from '../../common/pt-date-utils';
import { selectOptionContract } from '../../common/option-contract-selection';
import type { HistoricalOptionContract } from '../../types/partner';
import {
  MCP_PREFIX,
  QUOTE_BATCH,
  extractChains,
  extractQuoteItems,
  fetchAllOptionInstruments,
  parseNum,
  quoteItemId,
  quoteMark,
  type RhInstrument,
} from '../engine/rh-mcp-shapes';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { PaperTradeSource, PaperTradeStatus, SIGNAL_GOVERNING_VARIANT } from '@paper-trading/contracts';
import type { SignalExpressionTemplate } from '@paper-trading/contracts';
import type { StOrderTicket, StTicketError, StTicketFillSummary, StTicketOriginType } from '@st/order-tickets';
import { stTicketId, stTradeId } from '@st/ids';
import type { StPositionGroupEmitter } from '../../position-groups/st-position-group-writer';
import { StPositionGroupWriter } from '../../position-groups/st-position-group-writer';
import { StOrderTicketWriter } from '../../order-tickets/st-order-ticket-writer';
import { db } from '../../firebase-admin-init';
import { getMarketDatePT } from '../../common/pt-date-utils';
import {
  createRobinhoodMcpSessionManagerFromEnv,
  type RobinhoodMcpSessionManager,
} from '../../options-strategy-engine/mcp/robinhood-mcp-session-manager';
import type { EntryFillInput, PendingFillInput } from '../ledger';
import { applyEntryFill, applyPendingFill } from '../ledger';
import { getTrade, listTrades, listTradeDocIdsByPrefix } from '../repository';
import { ledgerDepsWithCapture } from '../screenshot-lifecycle';
import { createLogger } from '../engine/logging';

const logger = createLogger('ExpressionFillPass');

/** Bound on per-trade instrument lookups — nearest-DTE expirations only. */
const MAX_EXPIRATIONS = 4;
/** Concurrent fill paths per pass — bounds RH MCP burst + acct-doc contention. */
const FILL_CONCURRENCY = 4;
/** Concurrent quote batches per trade — bounds intra-trade MCP bursts. */
const QUOTE_CONCURRENCY = 3;
/** Lost seq race retry — a second pass re-scans; beyond that it's a real error. */
const MINT_ATTEMPTS = 2;

/** Canonical origin type → paper-trade source (staged expression tickets
 *  are signal-originated today; the map keeps the door open). */
const SOURCE_BY_ORIGIN: Record<StTicketOriginType, PaperTradeSource> = {
  signal: PaperTradeSource.SIGNAL,
  program: PaperTradeSource.STRATEGY,
  manual: PaperTradeSource.MANUAL,
  management: PaperTradeSource.MANUAL,
};

// ── Deps ───────────────────────────────────────────────────────────────────

export interface ExpressionFillPassDeps {
  /** Staged `pap_*` tickets with `terms.expressionTemplate` (#1005 source). */
  listStagedExpressionTickets(): Promise<StOrderTicket[]>;
  /** Legacy PENDING trades — pre-#1005 docs draining in place. */
  listPendingTrades(): Promise<PaperTrade[]>;
  getTrade(tradeId: string): Promise<PaperTrade | null>;
  /** Trades stamped with this staged ticket id — mint dedupe/heal. */
  listTradesByTicketId(ticketId: string): Promise<PaperTrade[]>;
  /** Trade doc ids under a canonical-id prefix — stTradeId seq scan. */
  listTradeDocIdsByPrefix(prefix: string): Promise<string[]>;
  /** RH MCP read-only tool caller (`get_option_chains`/`instruments`/`quotes`). */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Legacy in-place fill — the trade doc already exists (PENDING). */
  applyPendingFill(input: PendingFillInput): Promise<unknown>;
  /** Minted fill — creates the trade doc (#1005 staged-ticket path). */
  applyEntryFill(input: EntryFillInput): Promise<unknown>;
  /** Ticket re-read — the staged list is a snapshot; the state is
   *  re-checked before the ledger fill so a racing cancel wins. */
  getTicket(ticketId: string): Promise<StOrderTicket | null>;
  /** Non-terminal `lastError` stamp — records why a staged ticket
   *  skipped (stays staged for the next pass's retry). */
  recordTicketError(
    ticketId: string,
    error: StTicketError,
    now: string,
  ): Promise<void>;
  /** staged → filled on the consumed ticket. */
  markTicketFilled(ticketId: string, fill: StTicketFillSummary, now: string): Promise<unknown>;
  /** staged → cancelled — heals a ticket whose owned seed trade already
   *  settled CANCELLED/EXPIRED before the pass saw it. */
  markTicketCancelled(ticketId: string, now: string): Promise<unknown>;
  /** Group membership join for minted trades (#1004). */
  groups?: Pick<StPositionGroupEmitter, 'addMembers'>;
  now(): Date;
}

export interface ExpressionFillPassSummary {
  filled: number;
  skipped: number;
  errors: { id: string; error: string }[];
}

// ── MCP fetch helpers ──────────────────────────────────────────────────────

/** Fetch expiration dates for the trade's underlying via `get_option_chains`. */
async function fetchExpirations(
  callTool: ExpressionFillPassDeps['callTool'],
  symbol: string,
): Promise<string[]> {
  const raw = await callTool(`${MCP_PREFIX}get_option_chains`, { underlying_symbol: symbol });
  const dates = new Set<string>();
  for (const chain of extractChains(raw)) {
    if (chain.symbol && chain.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
    for (const d of chain.expiration_dates ?? []) dates.add(d);
  }
  return [...dates];
}

/** Fetch instruments for one expiration via `get_option_instruments` (paginated). */
const fetchInstruments = (
  callTool: ExpressionFillPassDeps['callTool'],
  symbol: string,
  expiration: string,
  rhType: 'put' | 'call',
): Promise<RhInstrument[]> =>
  fetchAllOptionInstruments(callTool, {
    chain_symbol: symbol,
    expiration_dates: expiration,
    type: rhType,
  });

/** Quote a batch of instrument ids via `get_option_quotes` (parallel batches). */
async function fetchQuotes(
  callTool: ExpressionFillPassDeps['callTool'],
  instrumentIds: string[],
): Promise<Map<string, { mark?: number; delta?: number }>> {
  const batches: string[][] = [];
  for (let i = 0; i < instrumentIds.length; i += QUOTE_BATCH) {
    batches.push(instrumentIds.slice(i, i + QUOTE_BATCH));
  }
  const raws: unknown[] = [];
  for (let i = 0; i < batches.length; i += QUOTE_CONCURRENCY) {
    raws.push(
      ...(await Promise.all(
        batches
          .slice(i, i + QUOTE_CONCURRENCY)
          .map((ids) => callTool(`${MCP_PREFIX}get_option_quotes`, { instrument_ids: ids })),
      )),
    );
  }
  const byId = new Map<string, { mark?: number; delta?: number }>();
  for (const raw of raws) {
    for (const item of extractQuoteItems(raw)) {
      const id = quoteItemId(item);
      if (!id) continue;
      byId.set(id, {
        mark: quoteMark(item),
        delta: parseNum(item.quote?.delta),
      });
    }
  }
  return byId;
}

// ── Pass ───────────────────────────────────────────────────────────────────

export async function runExpressionFillPass(
  marketDate: string,
  deps: ExpressionFillPassDeps,
): Promise<ExpressionFillPassSummary> {
  const staged = await deps.listStagedExpressionTickets();
  // A legacy PENDING trade is owned by the ticket path only when its staged
  // ticket carries the SAME refId — post-#1005 seeds resolve against ticket
  // docs, so a different accept can hold pap_{pendingId}; that pending still
  // drains here rather than being stolen into a foreign ticket.
  const stagedById = new Map(staged.map((t) => [t.id, t]));
  const pending = (await deps.listPendingTrades()).filter((t) => {
    const ticket = stagedById.get(stTicketId('paper', t.id));
    return !(ticket && sameAcceptMember(ticket, t));
  });
  const summary: ExpressionFillPassSummary = { filled: 0, skipped: 0, errors: [] };

  type WorkItem = { label: string; run: () => Promise<FillOutcome> };
  const items: WorkItem[] = [
    ...staged.map((ticket) => ({
      label: ticket.id,
      run: () => fillStagedTicket(marketDate, ticket, deps),
    })),
    ...pending.map((trade) => ({
      label: trade.id,
      run: () => fillPendingTrade(marketDate, trade, deps),
    })),
  ];

  // Items are independent docs — parallelize (bounded); account writes
  // retry inside the ledger transaction if fills contend on one acct doc.
  const results: PromiseSettledResult<FillOutcome>[] = [];
  for (let i = 0; i < items.length; i += FILL_CONCURRENCY) {
    results.push(
      ...(await Promise.allSettled(
        items.slice(i, i + FILL_CONCURRENCY).map((item) => item.run()),
      )),
    );
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      if (r.value === 'filled') summary.filled++;
      else summary.skipped++;
    } else {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      // A trade/ticket cancelled mid-pass correctly rejects the fill —
      // that's a legitimate race outcome, not a failure.
      if (/not pending/i.test(message)) {
        summary.skipped++;
        logger.info(`${items[i].label}: skipped — ${message}`);
      } else {
        summary.errors.push({ id: items[i].label, error: message });
        logger.warn(`${items[i].label}: fill failed — ${message}`);
      }
    }
  }

  return summary;
}

type FillOutcome = 'filled' | 'skipped';

/**
 * A staged ticket and a trade are the same accept's member when either lineage key
 * matches — refId (same request) OR signalId (same signal-scoped accept;
 * a client retry can carry a fresh refId while the dedupe is
 * signal-scoped).
 */
function sameAcceptMember(ticket: StOrderTicket, trade: PaperTrade): boolean {
  const tradeSignalId = trade.signalId ?? trade.ticket?.signalId;
  return (
    trade.ticket?.refId === ticket.refId ||
    (!!ticket.signalContext?.signalId &&
      ticket.signalContext.signalId === tradeSignalId)
  );
}

/** Contract selection — shared by the minted and in-place fill paths. */
async function selectContract(
  marketDate: string,
  label: string,
  symbol: string,
  template: SignalExpressionTemplate,
  deps: ExpressionFillPassDeps,
): Promise<{
  contractID: string;
  strike: number;
  expiration: string;
  mark: number;
} | null> {
  const rhType = template.optionType === 'call' ? 'call' : 'put';

  // expirations inside the template DTE band, nearest target first
  const inBand = (await fetchExpirations(deps.callTool, symbol))
    .map((expiration) => ({ expiration, dte: calendarDaysBetween(marketDate, expiration) }))
    .filter((e) => e.dte >= template.minDte && e.dte <= template.maxDte)
    .sort((a, b) => Math.abs(a.dte - template.targetDte) - Math.abs(b.dte - template.targetDte))
    .slice(0, MAX_EXPIRATIONS);

  if (inBand.length === 0) {
    logger.info(`${label}: no expiration inside ${template.minDte}-${template.maxDte}d band`);
    return null;
  }

  // instruments (parallel over in-band expirations) → quotes → candidates
  const instrumentPages = await Promise.all(
    inBand.map(({ expiration }) => fetchInstruments(deps.callTool, symbol, expiration, rhType)),
  );
  const instruments = instrumentPages.flat();
  const quotes = await fetchQuotes(
    deps.callTool,
    instruments.map((i) => i.id).filter((id): id is string => !!id),
  );

  const candidates: HistoricalOptionContract[] = [];
  for (const inst of instruments) {
    const strike = parseNum(inst.strike_price);
    const q = inst.id ? quotes.get(inst.id) : undefined;
    if (!inst.expiration_date || strike === undefined || !q) continue;
    candidates.push({
      contractID: buildOccContractId(symbol, inst.expiration_date, template.optionType, strike),
      symbol,
      expiration: inst.expiration_date,
      strike: String(strike),
      type: template.optionType,
      mark: q.mark === undefined ? undefined : String(q.mark),
      delta: q.delta === undefined ? undefined : String(q.delta),
    });
  }

  const selected = selectOptionContract(marketDate, candidates, {
    type: template.optionType,
    targetDelta: template.targetDelta,
    targetDte: template.targetDte,
    minDte: template.minDte,
    maxDte: template.maxDte,
    requireMark: true,
    useAbsoluteDelta: true,
  });

  if (!selected || selected.mark === undefined || !selected.contract.contractID) {
    logger.info(`${label}: no selectable contract (${candidates.length} candidates)`);
    return null;
  }

  const { contract } = selected;
  const contractID = contract.contractID;
  const strike = parseNum(contract.strike);
  if (!contractID || strike === undefined || !contract.expiration) {
    throw new Error(`${label}: selected contract ${contractID ?? 'n/a'} lacks id/strike/expiration`);
  }
  return { contractID, strike, expiration: contract.expiration, mark: selected.mark };
}

// ── Staged-ticket path (#1005) ─────────────────────────────────────────────

async function fillStagedTicket(
  marketDate: string,
  ticket: StOrderTicket,
  deps: ExpressionFillPassDeps,
): Promise<FillOutcome> {
  const nowIso = deps.now().toISOString();
  const seed = ticket.id.replace(/^pap_/, '');

  // Dedupe — the ticket is consumable exactly once. Two covered states:
  //  (a) a minted trade already carries ticket.ticketId (mint succeeded but
  //      markFilled failed — heal the ticket, don't mint a second trade);
  //  (b) a pre-#1005 trade at the seed id is already past PENDING.
  const heal = async (trade?: PaperTrade): Promise<FillOutcome> => {
    const entry = trade?.fills.find((f) => f.role === 'entry');
    // A stamped trade with no entry fill is a partial write — stamping a
    // 0-price fillSummary would record a lie. Leave the ticket staged and
    // note why; the wedge is diagnosable rather than silent.
    if (trade && !entry) {
      logger.warn(`${ticket.id}: heal deferred — ${trade.id} has no entry fill`);
      await deps.recordTicketError(
        ticket.id,
        { category: 'no_entry_fill', message: `covering trade ${trade.id} has no entry fill` },
        nowIso,
      );
      return 'skipped';
    }
    // Group membership is an idempotent union — replay it so a minted
    // trade whose addMembers failed last pass still lands in the group.
    // A failed join leaves the ticket staged so the next pass retries.
    const groupId = trade?.positionGroupId ?? ticket.origin.positionGroupId;
    if (trade && groupId && deps.groups) {
      const joined = await deps.groups.addMembers(groupId, { tradeIds: [trade.id] }, nowIso);
      if (!joined) {
        logger.warn(`${ticket.id}: heal deferred — group join failed for ${groupId}`);
        await deps.recordTicketError(
          ticket.id,
          { category: 'group_join', message: `addMembers to ${groupId} failed for minted trade ${trade.id}` },
          nowIso,
        );
        return 'skipped';
      }
    }
    await deps.markTicketFilled(
      ticket.id,
      {
        averagePrice: entry?.price ?? 0,
        filledQty: entry?.quantity ?? ticket.terms.quantity ?? 1,
        filledAt: nowIso,
      },
      nowIso,
    );
    return 'filled';
  };
  const stamped = await deps.listTradesByTicketId(ticket.id);
  if (stamped.length > 0) return heal(stamped[0]);
  // The seed trade is THIS accept's member only when the lineage matches
  // (refId or signalId — same doctrine as the retry-path adoption):
  // post-#1005, pap_{id} may sit on a foreign accept's pending trade;
  // stealing it would misfile that trade and silently consume this ticket.
  const seedTrade = await deps.getTrade(seed);
  const legacy = seedTrade && sameAcceptMember(ticket, seedTrade) ? seedTrade : null;
  if (legacy && legacy.status !== PaperTradeStatus.PENDING) {
    // Owned seed trade already settled — heal the ticket's terminal state
    // (cancelled/excised seed → the member is dead, not filled).
    if (legacy.status === PaperTradeStatus.OPEN || legacy.status === PaperTradeStatus.CLOSED
        || legacy.status === PaperTradeStatus.ASSIGNED) {
      return heal(legacy);
    }
    await deps.markTicketCancelled(ticket.id, nowIso);
    return 'skipped';
  }

  if (!ticket.userId) {
    throw new Error(`staged ticket ${ticket.id} is missing userId`);
  }
  const template = ticket.terms?.expressionTemplate;
  if (!template) {
    logger.warn(`${ticket.id}: staged ticket lacks terms.expressionTemplate`);
    await deps.recordTicketError(
      ticket.id,
      { category: 'invalid_terms', message: 'staged ticket lacks terms.expressionTemplate' },
      nowIso,
    );
    return 'skipped';
  }
  // Cancel race — the staged list is a snapshot; a cancel committing after
  // the read must be honored before any broker work or ledger write. If
  // the ticket moved past 'staged' (cancelled/filled/failed), the state
  // owns the outcome — skip and let the next pass heal whatever needs
  // healing. A cancel landing between this check and the mint falls to the
  // writer's fill-wins doctrine (same as the live broker path).
  const current = await deps.getTicket(ticket.id);
  if (!current || current.state !== 'staged') {
    logger.info(
      `${ticket.id}: ticket state is ${current?.state ?? 'missing'} — fill skipped (cancel/state wins)`,
    );
    return 'skipped';
  }

  const symbol = ticket.terms.symbol.toUpperCase();
  const sel = await selectContract(marketDate, ticket.id, symbol, template, deps);
  if (!sel) {
    await deps.recordTicketError(
      ticket.id,
      { category: 'no_contract', message: 'no in-band contract matched the template' },
      nowIso,
    );
    return 'skipped';
  }

  // Legacy in-place fill uses the trade's own quantity (authoritative);
  // the mint path falls back to the ticket's terms.
  const quantity = legacy?.order.quantity ?? ticket.terms.quantity ?? 1;
  const fillSummary: StTicketFillSummary = {
    averagePrice: sel.mark,
    filledQty: quantity,
    filledAt: nowIso,
  };
  const legs = [
    {
      kind: 'option' as const,
      contractID: sel.contractID,
      type: template.optionType,
      strike: sel.strike,
      expiration: sel.expiration,
      side: template.side,
      quantity,
      multiplier: 100,
      entryMark: sel.mark,
      lastMark: sel.mark,
    },
  ];
  const contractOverrides = {
    strike: sel.strike,
    expiration: sel.expiration,
    optionType: template.optionType,
    // Minted docs keep the recipe — the in-place path already retains it
    // post-fill as provenance, and retry membership reads the key.
    expressionTemplate: template,
    lastMarkedAt: nowIso,
  };

  if (legacy) {
    // Pre-#1005 accept: the seed's PENDING doc still exists — fill it in
    // place (its dims already carry cohort/group/signal lineage).
    await deps.applyPendingFill({
      userId: legacy.userId ?? ticket.userId,
      tradeId: legacy.id,
      legs,
      fill: {
        fillId: `entry-${legacy.id}`,
        role: 'entry',
        date: marketDate,
        price: sel.mark,
        quantity,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      tradeOverrides: contractOverrides,
      now: nowIso,
    });
    await deps.markTicketFilled(ticket.id, fillSummary, nowIso);
    return 'filled';
  }

  // Mint — the trade materializes here under the canonical contract-bearing
  // id {SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN} (#1005).
  const mintSignalId = ticket.signalContext?.signalId ?? ticket.origin.signalId;
  const idDate = new Date(`${marketDate}T12:00:00Z`);
  const expr = ticket.terms.expression ?? template.expression;
  // stTradeId wants exp as 6/8 digits — contract.expiration is ISO.
  const expDigits = sel.expiration.replace(/-/g, '').slice(2);
  const strikeStr = String(sel.strike);
  // Prefix for the {NN} scan — derived from the canonical builder's output
  // (seq=1 rendered then stripped) so the scan can never drift from the
  // layout.
  const idPrefix = stTradeId(symbol, idDate, ticket.origin.type, expr, expDigits, strikeStr, 1)
    .replace(/-\d+$/, '-');

  for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt++) {
    // Dedupe re-check inside the loop — the contract-selection MCP calls
    // take seconds, so a concurrent pass may have minted THIS ticket since
    // the staged-list snapshot. If a trade already carries our ticketId,
    // this is the losing pass: heal and stop, never mint a sibling.
    const stampedNow = await deps.listTradesByTicketId(ticket.id);
    if (stampedNow.length > 0) return heal(stampedNow[0]);
    const existingIds = await deps.listTradeDocIdsByPrefix(idPrefix);
    let seq = 1;
    for (const id of existingIds) {
      const m = /-(\d+)$/.exec(id);
      if (m) seq = Math.max(seq, parseInt(m[1], 10) + 1);
    }
    const tradeId = stTradeId(symbol, idDate, ticket.origin.type, expr, expDigits, strikeStr, seq);
    try {
      await deps.applyEntryFill({
        userId: ticket.userId,
        tradeId,
        order: { side: template.side, type: 'MARKET', quantity },
        legs,
        fill: {
          fillId: `entry-${tradeId}`,
          role: 'entry',
          date: marketDate,
          price: sel.mark,
          quantity,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
        dims: {
          source: SOURCE_BY_ORIGIN[ticket.origin.type],
          symbol,
          expression: expr,
          governingVariant: SIGNAL_GOVERNING_VARIANT,
          // Soak bridges — cohortId rides the ticket until the FE re-points
          // to position groups (#1013).
          ...(ticket.cohortId ? { cohortId: ticket.cohortId } : {}),
          ...(ticket.origin.positionGroupId
            ? { positionGroupId: ticket.origin.positionGroupId }
            : {}),
          // The caller-passed signal id (signalContext.signalId) is what
          // listTradesBySignal queries on accept retry; origin.signalId is
          // the canonical occurrence id. Prefer the retry-visible one.
          ...(mintSignalId ? { signalId: mintSignalId } : {}),
          ticket: {
            ...(mintSignalId ? { signalId: mintSignalId } : {}),
            refId: ticket.refId,
            acceptedAt: ticket.createdAt,
            ticketId: ticket.id,
          },
        },
        tradeOverrides: contractOverrides,
        now: nowIso,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) {
        // Lost the race — but to WHAT? If the winning doc carries our
        // ticketId, a concurrent pass minted THIS ticket and we must heal,
        // not re-mint: a blind seq bump would write a second OPEN trade.
        const raced = await deps.listTradesByTicketId(ticket.id);
        if (raced.length > 0) return heal(raced[0]);
        // A different ticket holds the contract base — rescan seq once.
        if (attempt + 1 < MINT_ATTEMPTS) continue;
      }
      throw err;
    }
    // Post-mint dedupe — the seq scan above is advisory; a winner that
    // committed between our in-loop dedupe re-check and our write would
    // leave a stamped sibling. Detect it loudly rather than orphaning a
    // phantom OPEN trade forever (a delete would corrupt the account
    // position legs the fill just wrote — surface for manual cleanup).
    const stampedPost = await deps.listTradesByTicketId(ticket.id);
    const sibling = stampedPost.find((t) => t.id !== tradeId);
    if (sibling) {
      logger.error(
        `${ticket.id}: duplicate mint — ${tradeId} is a sibling of ${sibling.id}; manual cleanup required`,
      );
    }

    // Committed — join the group, then close out the ticket. A failed
    // join leaves the ticket staged so the next pass's heal replays it;
    // a minted-then-unstamped ticket heals via the ticket.ticketId
    // dedupe when markFilled itself fails.
    if (ticket.origin.positionGroupId && deps.groups) {
      const joined = await deps.groups.addMembers(
        ticket.origin.positionGroupId,
        { tradeIds: [tradeId] },
        nowIso,
      );
      if (!joined) {
        logger.warn(
          `${ticket.id}: minted ${tradeId} but group join failed — leaving staged for next pass`,
        );
        await deps.recordTicketError(
          ticket.id,
          { category: 'group_join', message: `addMembers to ${ticket.origin.positionGroupId} failed after minting ${tradeId}` },
          nowIso,
        );
        return 'skipped';
      }
    }
    await deps.markTicketFilled(ticket.id, fillSummary, nowIso);
    return 'filled';
  }
  throw new Error(`${ticket.id}: mint attempts exhausted`);
}

// ── Legacy PENDING drain (pre-#1005 docs with no staged ticket) ────────────

async function fillPendingTrade(
  marketDate: string,
  trade: PaperTrade,
  deps: ExpressionFillPassDeps,
): Promise<FillOutcome> {
  if (!trade.userId) {
    throw new Error(`pending trade ${trade.id} is missing userId`);
  }
  const template = trade.expressionTemplate;
  if (!template) {
    throw new Error(`pending trade ${trade.id} has no expressionTemplate`);
  }
  const symbol = trade.symbol.toUpperCase();
  const sel = await selectContract(marketDate, trade.id, symbol, template, deps);
  if (!sel) return 'skipped';

  await deps.applyPendingFill({
    userId: trade.userId,
    tradeId: trade.id,
    legs: [
      {
        kind: 'option',
        contractID: sel.contractID,
        type: template.optionType,
        strike: sel.strike,
        expiration: sel.expiration,
        side: template.side,
        quantity: trade.order.quantity,
        multiplier: 100,
        entryMark: sel.mark,
        lastMark: sel.mark,
      },
    ],
    fill: {
      fillId: `entry-${trade.id}`,
      role: 'entry',
      date: marketDate,
      price: sel.mark,
      quantity: trade.order.quantity,
      quoteSource: OptionQuoteSource.RH_MCP,
    },
    tradeOverrides: {
      strike: sel.strike,
      expiration: sel.expiration,
      optionType: template.optionType,
      lastMarkedAt: deps.now().toISOString(),
    },
    now: deps.now().toISOString(),
  });
  return 'filled';
}

// -- Noon-PT scheduled entrypoint -------------------------------------------

/**
 * Fills pending signal expressions queued by `paperSignalOrder`: staged
 * `pap_*` tickets mint contract-bearing trades (#1005), legacy PENDING
 * docs drain in place. RH option chains → instruments → quotes →
 * delta/DTE selection → fill → OPEN. Runs at noon PT — the same cadence
 * as strategy opens.
 */
export const expressionFillPassTimer = onSchedule(
  {
    schedule: '0 12 * * 1-5',
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: ['RH_CREDENTIAL_BUNDLE'],
  },
  async () => {
    logger.info('Expression fill pass starting');
    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      const m = (manager = await createRobinhoodMcpSessionManagerFromEnv());
      const tickets = new StOrderTicketWriter();
      const summary = await runExpressionFillPass(getMarketDatePT(), {
        listStagedExpressionTickets: () => tickets.listStagedExpressionTickets(),
        listPendingTrades: () =>
          listTrades(db, { status: PaperTradeStatus.PENDING }),
        getTrade: (tradeId) => getTrade(db, tradeId),
        listTradesByTicketId: (ticketId) => listTrades(db, { ticketId }),
        listTradeDocIdsByPrefix: (prefix) => listTradeDocIdsByPrefix(db, prefix),
        callTool: (name, args) => m.callTool(name, args),
        applyPendingFill: (input) => applyPendingFill(input, ledgerDepsWithCapture(db)),
        applyEntryFill: (input) => applyEntryFill(input, ledgerDepsWithCapture(db)),
        getTicket: (ticketId) => tickets.get(ticketId),
        recordTicketError: (ticketId, error, now) => tickets.noteError(ticketId, error, now),
        markTicketFilled: (ticketId, fill, now) => tickets.markFilled(ticketId, fill, now),
        markTicketCancelled: (ticketId, now) => tickets.markCancelled(ticketId, now),
        groups: new StPositionGroupWriter(),
        now: () => new Date(),
      });
      logger.info(
        `Expression fill pass complete: filled=${summary.filled} ` +
          `skipped=${summary.skipped} errors=${summary.errors.length}`,
      );
    } finally {
      await manager?.close();
    }
  },
);
