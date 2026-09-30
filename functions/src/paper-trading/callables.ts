/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * `paperSignalOrder` callable — accept an ST signal as a paper trade.
 * The order ticket is the provenance anchor: the equity side fills at the
 * acceptance-time RH quote through the ledger, then the cohort fans out
 * into PENDING expression trades (one per direction-mapped template) that
 * the noon-PT expression-fill pass resolves into real contracts.
 *
 * No broker mutation calls exist anywhere on this path — the only MCP
 * tools invoked are read-only quote/chain lookups.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

import { TradeSide } from '@common';
import { OptionQuoteSource } from '@options/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
  SIGNAL_EXPRESSION_TEMPLATES,
  SIGNAL_GOVERNING_VARIANT,
  SIGNAL_SHADOW_VARIANT_KEYS,
  type CancelPaperTradeRequest,
  type CancelPaperTradeResponse,
  type ClosePaperTradeRequest,
  type ClosePaperTradeResponse,
  type PaperCohort,
  type PaperSignalOrderRequest,
  type PaperSignalOrderResponse,
  type PaperTrade,
  type SignalExpressionTemplate,
  type VariantRun,
} from '@paper-trading/contracts';
import {
  buildCohortId,
  buildSpreadTradeDesc,
  buildTradeId,
  EQUITY_TRADE_DESC,
} from '@paper-trading/ids';
import { db } from '../firebase-admin-init';
import { getMarketDatePT, calendarDaysBetween } from '../common/pt-date-utils';
import { ST_ORDER_INTENTS_COLLECTION } from '../common/st-collections';
import { extractEquityPrice, MCP_PREFIX } from './engine/rh-mcp-shapes';
import {
  applyEntryFill,
  applyExitFill,
  cancelPendingTrade,
  computeExitPnl,
  createPendingTrade,
  orderMultiplier,
} from './ledger';
import type {
  ApplyFillResult,
  CancelTradeInput,
  EntryFillInput,
  ExitFillInput,
  PendingTradeInput,
} from './ledger';
import {
  getCohort,
  getTrade,
  ledgerDeps,
  listTrades,
  resolveTradeId,
  setCohort,
  updateVariantRun,
} from './repository';
import { RobinhoodMcpOptionQuoteProvider } from './engine/quote-providers/rh-mcp-option-quote-provider';
import type { RobinhoodMcpSessionManager } from '../options-strategy-engine/mcp/robinhood-mcp-session-manager';
import { createRobinhoodMcpSessionManagerFromEnv } from '../options-strategy-engine/mcp/robinhood-mcp-session-manager';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './engine/options-strategy-cors';
import { createLogger } from './engine/logging';

const logger = createLogger('PaperSignalOrder');

export { extractEquityPrice };

// ── Deps (injected for tests) ──────────────────────────────────────────────

export interface OrderTicketDoc {
  id?: string;
  refId?: string;
  symbol?: string;
  side?: string;
  quantity?: string;
  signalContext?: { signalType?: string; direction?: string; decisionId?: string };
}

export interface PaperSignalOrderDeps {
  /** Order-ticket lookup by refId (idempotency lineage); null when not found. */
  getTicket(refId: string): Promise<OrderTicketDoc | null>;
  /** Existing trades for the signal (idempotent retry short-circuit). */
  listTradesBySignal(signalId: string): Promise<PaperTrade[]>;
  getCohort(cohortId: string): Promise<PaperCohort | null>;
  /** RH MCP read-only tool caller (`get_equity_quotes`, `get_option_*`). */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  resolveTradeId(baseId: string): Promise<string>;
  resolveCohortId(date: Date, symbol: string): Promise<string>;
  applyEntryFill(input: EntryFillInput): Promise<unknown>;
  createPendingTrade(input: PendingTradeInput): Promise<unknown>;
  setCohort(cohort: PaperCohort): Promise<void>;
  now(): Date;
}

function validate(data: Partial<PaperSignalOrderRequest>): asserts data is PaperSignalOrderRequest {
  const quantityOk =
    data.quantity === undefined ||
    (Number.isFinite(data.quantity) && data.quantity > 0 && Number.isInteger(data.quantity));
  if (
    !data ||
    typeof data.signalId !== 'string' || !data.signalId ||
    typeof data.symbol !== 'string' || !data.symbol ||
    !Object.values(TradeSide).includes(data.direction as TradeSide) ||
    !quantityOk ||
    typeof data.refId !== 'string' || !data.refId
  ) {
    throw new HttpsError(
      'invalid-argument',
      'paperSignalOrder requires signalId, symbol, direction, refId (quantity: positive whole shares)',
    );
  }
}

export async function handlePaperSignalOrder(
  request: { data?: unknown; auth?: { uid: string } },
  deps: PaperSignalOrderDeps,
): Promise<PaperSignalOrderResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to accept a signal as paper');
  }
  const data = (request.data ?? {}) as Partial<PaperSignalOrderRequest>;
  validate(data);
  const userId = request.auth.uid;

  // 1. Provenance — the order ticket is the accepted-order anchor.
  const ticket = await deps.getTicket(data.refId);
  if (!ticket) {
    throw new HttpsError('not-found', `order ticket ${data.refId} not found`);
  }
  if (ticket.symbol && ticket.symbol.toUpperCase() !== data.symbol.toUpperCase()) {
    throw new HttpsError(
      'invalid-argument',
      `ticket symbol ${ticket.symbol} does not match request symbol ${data.symbol}`,
    );
  }
  // Ticket side is the source of truth for direction when present — a buy
  // ticket must not be accepted as a SHORT expression.
  if (ticket.side) {
    const normalized = ticket.side.toLowerCase();
    const ticketDirection =
      normalized === 'buy' ? TradeSide.LONG : normalized === 'sell' ? TradeSide.SHORT : undefined;
    if (ticketDirection && ticketDirection !== data.direction) {
      throw new HttpsError(
        'invalid-argument',
        `ticket side ${ticket.side} does not match request direction ${data.direction}`,
      );
    }
  }
  // Quantity inherits the order ticket's computed sizing (PRD); request
  // quantity is the fallback for tickets that carry none.
  const ticketQty = ticket.quantity === undefined ? undefined : Number(ticket.quantity);
  const quantity =
    ticketQty !== undefined && Number.isInteger(ticketQty) && ticketQty > 0
      ? ticketQty
      : data.quantity;
  if (quantity === undefined || !Number.isInteger(quantity) || quantity <= 0) {
    throw new HttpsError(
      'invalid-argument',
      'no usable quantity — order ticket has none and request quantity missing/invalid',
    );
  }

  const now = deps.now();
  const nowIso = now.toISOString();
  const marketDate = getMarketDatePT(now);
  // Trade ids embed YYMMDD — build from the PT market date, not UTC.
  const idDate = new Date(`${marketDate}T12:00:00Z`);
  const symbol = data.symbol.toUpperCase();

  // Idempotent retry: a prior call for this signal already wrote trades —
  // return the existing cohort (rebuild the doc if the earlier run died
  // between trade writes and the cohort write) instead of minting a
  // second cohort under suffixed ids. Concurrency note: two simultaneous
  // accepts for the same signal can both pass this check — the cohort seq
  // scan and trade-id suffixes keep ids unique, but a duplicate cohort is
  // possible in that narrow race (single-user today; revisit if batching).
  const existing = await deps.listTradesBySignal(data.signalId);
  if (existing.length > 0) {
    const eqTrade = existing.find((t) => t.expression === EQUITY_TRADE_DESC);
    const cohortId = eqTrade?.cohortId;
    if (!cohortId || !eqTrade) {
      throw new HttpsError(
        'failed-precondition',
        `signal ${data.signalId} has partial trades (${existing.map((t) => t.id).join(', ')}) — manual cleanup required`,
      );
    }
    const expressionIds = existing.filter((t) => t.id !== eqTrade.id).map((t) => t.id);
    if (!(await deps.getCohort(cohortId))) {
      logger.warn(`rebuilding missing cohort ${cohortId} for signal ${data.signalId}`);
      // Rebuild from the stored trade dims, not the new request — a retry
      // must reproduce the original cohort, not the caller's args.
      const templateKeys = existing.filter(hasTemplate).map((t) => t.expressionTemplate.key);
      if (templateKeys.length !== expressionIds.length) {
        logger.warn(
          `cohort ${cohortId}: only ${templateKeys.length}/${expressionIds.length} expression trades carry templates`,
        );
      }
      await deps.setCohort(
        buildCohortDoc(cohortId, data.signalId, eqTrade.symbol, eqTrade.order.side,
          [eqTrade.id, ...expressionIds], templateKeys,
          eqTrade.createdAt ?? nowIso, nowIso),
      );
    }
    return { cohortId, equityTradeId: eqTrade.id, expressionTradeIds: expressionIds };
  }

  const templates = SIGNAL_EXPRESSION_TEMPLATES[data.direction];
  const variantKeys = [SIGNAL_GOVERNING_VARIANT, ...SIGNAL_SHADOW_VARIANT_KEYS];
  const paperTicket = { signalId: data.signalId, refId: data.refId, acceptedAt: nowIso };

  // 2. Resolve all ids up front so the cohort can reference every member.
  const equityBase = buildTradeId(idDate, 'sig', symbol, EQUITY_TRADE_DESC);
  const equityTradeId = await deps.resolveTradeId(equityBase);
  const cohortId = await deps.resolveCohortId(idDate, symbol);
  const pendingIds = await Promise.all(
    templates.map((t: SignalExpressionTemplate) =>
      deps.resolveTradeId(
        buildTradeId(idDate, 'sig', symbol, buildSpreadTradeDesc(t.expression, t.targetDelta, t.targetDte)),
      ),
    ),
  );

  // 3. Equity side: RH quote → entry fill via the ledger.
  const quote = await deps.callTool(`${MCP_PREFIX}get_equity_quotes`, { symbols: [symbol] });
  const price = extractEquityPrice(quote, symbol);
  if (price === undefined) {
    throw new HttpsError('unavailable', `no equity quote for ${symbol}`);
  }
  await deps.applyEntryFill({
    userId,
    tradeId: equityTradeId,
    order: { side: data.direction, type: 'MARKET', quantity },
    legs: [
      {
        kind: 'share',
        side: data.direction,
        quantity,
        multiplier: 1,
        entryMark: price,
        lastMark: price,
      },
    ],
    fill: {
      fillId: `entry-${equityTradeId}`,
      role: 'entry',
      date: marketDate,
      price,
      quantity,
      quoteSource: OptionQuoteSource.RH_MCP,
    },
    dims: {
      source: PaperTradeSource.SIGNAL,
      symbol,
      expression: EQUITY_TRADE_DESC,
      governingVariant: SIGNAL_GOVERNING_VARIANT,
      variantKeys,
      cohortId,
      signalId: data.signalId,
      ticket: paperTicket,
    },
    underlyingClose: price,
    now: nowIso,
  });

  // 4. PENDING expression trades — the noon pass resolves contracts.
  await Promise.all(
    templates.map((t: SignalExpressionTemplate, i: number) =>
      deps.createPendingTrade({
        userId,
        tradeId: pendingIds[i],
        order: { side: t.side, type: 'MARKET', quantity: 1 },
        dims: {
          source: PaperTradeSource.SIGNAL,
          symbol,
          expression: t.expression,
          governingVariant: SIGNAL_GOVERNING_VARIANT,
          variantKeys,
          cohortId,
          signalId: data.signalId,
          ticket: paperTicket,
        },
        expressionTemplate: t,
        now: nowIso,
      }),
    ),
  );

  // 5. Cohort doc — the fan-out anchor.
  await deps.setCohort(
    buildCohortDoc(
      cohortId, data.signalId, symbol, data.direction,
      [equityTradeId, ...pendingIds], templates.map((t) => t.key), nowIso, nowIso,
    ),
  );

  logger.info(
    `signal ${data.signalId}: equity ${equityTradeId} + ${pendingIds.length} pending ` +
      `expressions → ${cohortId}`,
  );
  return { cohortId, equityTradeId, expressionTradeIds: pendingIds };
}

const hasTemplate = (t: PaperTrade): t is PaperTrade & { expressionTemplate: SignalExpressionTemplate } =>
  !!t.expressionTemplate;

function buildCohortDoc(
  id: string,
  signalId: string,
  symbol: string,
  direction: TradeSide,
  tradeIds: string[],
  expressionTemplates: string[],
  acceptedAt: string,
  updatedAt: string,
): PaperCohort {
  return {
    kind: PaperTradingKind.COHORT,
    id,
    signalId,
    symbol,
    direction,
    acceptedAt,
    tradeIds,
    expressionTemplates,
    createdAt: acceptedAt,
    updatedAt,
  };
}

// ── Production wiring ──────────────────────────────────────────────────────

async function getTicketDoc(firestore: Firestore, refId: string): Promise<OrderTicketDoc | null> {
  const byRef = await firestore
    .collection(ST_ORDER_INTENTS_COLLECTION)
    .where('refId', '==', refId)
    .limit(1)
    .get();
  if (!byRef.empty) return byRef.docs[0].data() as OrderTicketDoc;
  const byId = await firestore.doc(`${ST_ORDER_INTENTS_COLLECTION}/${refId}`).get();
  return byId.exists ? (byId.data() as OrderTicketDoc) : null;
}

export async function resolveCohortId(firestore: Firestore, date: Date, symbol: string): Promise<string> {
  for (let seq = 1; seq < 100; seq++) {
    const id = buildCohortId(date, symbol, seq);
    if (!(await getCohort(firestore, id))) return id;
  }
  throw new Error(`cohort id exhausted for ${symbol} on ${date.toISOString()}`);
}

/**
 * Production deps for `handlePaperSignalOrder`, parameterized on the RH MCP
 * tool caller so the verify script and the onCall wrapper share one wiring.
 */
export function paperSignalOrderProdDeps(
  callTool: PaperSignalOrderDeps['callTool'],
): PaperSignalOrderDeps {
  const timeSuffix = new Date().toISOString().slice(11, 16).replace(':', '');
  return {
    getTicket: (refId) => getTicketDoc(db, refId),
    listTradesBySignal: (signalId) => listTrades(db, { signalId, source: PaperTradeSource.SIGNAL }),
    getCohort: (cohortId) => getCohort(db, cohortId),
    callTool,
    resolveTradeId: (base) => resolveTradeId(db, base, timeSuffix),
    resolveCohortId: (date, symbol) => resolveCohortId(db, date, symbol),
    applyEntryFill: (input) => applyEntryFill(input, ledgerDeps(db)),
    createPendingTrade: (input) => createPendingTrade(input, ledgerDeps(db)),
    setCohort: (cohort) => setCohort(db, cohort),
    now: () => new Date(),
  };
}

export const paperSignalOrder = onCall<PaperSignalOrderRequest, Promise<PaperSignalOrderResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: ['RH_CREDENTIAL_BUNDLE'],
  },
  async (request) => {
    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      const m = (manager = await createRobinhoodMcpSessionManagerFromEnv());
      return await handlePaperSignalOrder(
        request,
        paperSignalOrderProdDeps((name, args) => m.callTool(name, args)),
      );
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        `paperSignalOrder failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await manager?.close();
    }
  },
);

// ── cancelPaperTrade (task #666) ───────────────────────────────────────────

/**
 * Cancel a PENDING trade before the expression-fill pass resolves it.
 * Pure ledger — no MCP session needed. Guard ladder: auth → arg shape →
 * not-found → ownership → pending status; the ledger txn re-checks status
 * so a cancel racing the fill pass fails safe (its rejection maps back to
 * failed-precondition).
 */
export interface CancelPaperTradeDeps {
  getTrade(tradeId: string): Promise<PaperTrade | null>;
  cancelPendingTrade(input: CancelTradeInput): Promise<unknown>;
  now(): Date;
}

export async function handleCancelPaperTrade(
  request: { data?: unknown; auth?: { uid: string } },
  deps: CancelPaperTradeDeps,
): Promise<CancelPaperTradeResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to cancel a paper trade');
  }
  const data = (request.data ?? {}) as Partial<CancelPaperTradeRequest>;
  if (typeof data.tradeId !== 'string' || !data.tradeId) {
    throw new HttpsError('invalid-argument', 'cancelPaperTrade requires tradeId');
  }
  const trade = await deps.getTrade(data.tradeId);
  if (!trade) {
    throw new HttpsError('not-found', `paper trade ${data.tradeId} not found`);
  }
  // Fail closed: a trade with no recorded owner isn't cancellable at all
  // (every first-party PENDING producer sets userId — absent means corrupt).
  if (!trade.userId || trade.userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'paper trade belongs to another user');
  }
  if (trade.status !== PaperTradeStatus.PENDING) {
    throw new HttpsError(
      'failed-precondition',
      `paper trade ${trade.id} is not pending (status ${trade.status})`,
    );
  }
  try {
    await deps.cancelPendingTrade({
      userId: request.auth.uid,
      tradeId: trade.id,
      now: deps.now().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(msg)) {
      throw new HttpsError('not-found', msg);
    }
    if (/not pending/i.test(msg)) {
      // Lost the race with the fill pass — same answer as the pre-check.
      throw new HttpsError('failed-precondition', msg);
    }
    throw err;
  }
  return { tradeId: trade.id };
}

export const cancelPaperTrade = onCall<CancelPaperTradeRequest, Promise<CancelPaperTradeResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      return await handleCancelPaperTrade(request, {
        getTrade: (tradeId) => getTrade(db, tradeId),
        cancelPendingTrade: (input) => cancelPendingTrade(input, ledgerDeps(db)),
        now: () => new Date(),
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        `cancelPaperTrade failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
);

// ── closePaperTrade (task #667) ────────────────────────────────────────────

/**
 * Close an OPEN paper trade at a *live* Robinhood quote — whole unit,
 * multi-leg trades close as one order-level fill. No stored-mark fallback
 * and no user-entered price: any missing/non-finite leg quote is
 * `unavailable` with no ledger write. After the ledger close the governing
 * variant run is finalized EXITED with its exitEvent (same handler, post-
 * txn — a missed update is backfilled by the eval pass's CLOSED-trade path).
 */
export interface ClosePaperTradeDeps {
  getTrade(tradeId: string): Promise<PaperTrade | null>;
  /** Live option marks by OCC contract id (RobinhoodMcpOptionQuoteProvider). */
  getOptionQuotes(
    contractIds: string[],
    side: TradeSide,
  ): Promise<{ contractID: string; mark?: number }[]>;
  /** Equity quote tool caller (`get_equity_quotes`). */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  applyExitFill(input: ExitFillInput): Promise<ApplyFillResult>;
  /** repository.updateVariantRun. */
  updateRun(tradeId: string, run: VariantRun): Promise<void>;
  now(): Date;
}

/** Net order-level exit price: signed so the ledger's cashDelta equals the
 *  position's liquidation value (long legs sell for +value, short legs cost
 *  −value at buyback). Returns undefined when any leg quote is missing. */
export async function netExitPrice(
  trade: PaperTrade,
  deps: Pick<ClosePaperTradeDeps, 'getOptionQuotes' | 'callTool'>,
): Promise<number | undefined> {
  const optionLegs = trade.legs.filter((l) => l.kind === 'option');
  const optionMarks = new Map<string, number>();
  if (optionLegs.length) {
    // The provider throws on quote-miss/unparseable ids — same contract as a
    // missing mark: no quote, no close.
    let quotes: { contractID: string; mark?: number }[];
    try {
      quotes = await deps.getOptionQuotes(
        optionLegs.map((l) => l.contractID),
        trade.order.side,
      );
    } catch (err) {
      logger.warn(`option quote lookup failed for ${trade.id}: ${err}`);
      return undefined;
    }
    for (const q of quotes) {
      if (q.mark !== undefined && Number.isFinite(q.mark)) {
        optionMarks.set(q.contractID, q.mark);
      }
    }
    if (optionMarks.size !== optionLegs.length) return undefined;
  }
  let equityMark: number | undefined;
  if (trade.legs.some((l) => l.kind === 'share')) {
    // Same contract as the option path — a thrown tool error is a quote
    // miss (unavailable), not an internal failure.
    try {
      const raw = await deps.callTool(`${MCP_PREFIX}get_equity_quotes`, {
        symbols: [trade.symbol],
      });
      equityMark = extractEquityPrice(raw, trade.symbol);
    } catch (err) {
      logger.warn(`equity quote lookup failed for ${trade.id}: ${err}`);
      return undefined;
    }
    if (equityMark === undefined || !Number.isFinite(equityMark)) return undefined;
  }

  // Liquidation value: long legs +mark, short legs −mark.
  let value = 0;
  for (const leg of trade.legs) {
    const mark =
      leg.kind === 'share' ? equityMark : optionMarks.get(leg.contractID);
    if (mark === undefined) return undefined;
    value += (leg.side === TradeSide.SHORT ? -1 : 1) * mark * leg.quantity * leg.multiplier;
  }
  // Sign for the ledger formula: -signedCashDelta(fill, entrySide) must equal
  // the liquidation value → price carries the entry-side sign.
  const signed =
    trade.order.side === TradeSide.SHORT ? -value : value;
  return signed / (trade.order.quantity * orderMultiplier(trade.legs));
}

export async function handleClosePaperTrade(
  request: { data?: unknown; auth?: { uid: string } },
  deps: ClosePaperTradeDeps,
): Promise<ClosePaperTradeResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to close a paper trade');
  }
  const data = (request.data ?? {}) as Partial<ClosePaperTradeRequest>;
  if (typeof data.tradeId !== 'string' || !data.tradeId) {
    throw new HttpsError('invalid-argument', 'closePaperTrade requires tradeId');
  }
  const trade = await deps.getTrade(data.tradeId);
  if (!trade) {
    throw new HttpsError('not-found', `paper trade ${data.tradeId} not found`);
  }
  if (!trade.userId || trade.userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'paper trade belongs to another user');
  }
  if (trade.status !== PaperTradeStatus.OPEN) {
    throw new HttpsError(
      'failed-precondition',
      `paper trade ${trade.id} is not open (status ${trade.status})`,
    );
  }
  if (!trade.legs.length) {
    throw new HttpsError('failed-precondition', `paper trade ${trade.id} has no legs`);
  }

  const now = deps.now();
  const nowIso = now.toISOString();
  const marketDate = getMarketDatePT(now);

  const exitPrice = await netExitPrice(trade, deps);
  if (exitPrice === undefined || !Number.isFinite(exitPrice)) {
    throw new HttpsError('unavailable', `no live quote for ${trade.id} — close not attempted`);
  }

  let result: ApplyFillResult;
  try {
    result = await deps.applyExitFill({
      userId: trade.userId,
      tradeId: trade.id,
      fill: {
        fillId: `exit-${trade.id}-manual-${now.getTime()}`,
        role: 'exit',
        date: marketDate,
        price: exitPrice,
        quantity: trade.order.quantity,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
      now: nowIso,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(msg)) throw new HttpsError('not-found', msg);
    if (/not open/i.test(msg)) throw new HttpsError('failed-precondition', msg);
    throw err;
  }

  // Finalize the governing run — a manual close is a governing exit. The
  // ledger close already committed; a transient failure here must not hide
  // the successful close from the client (the eval pass backfills the run
  // on its next pass over CLOSED trades).
  const governing = result.trade.variantRuns.find((r) => r.governing && r.state === 'ACTIVE');
  if (governing) {
    const entry = result.trade.fills.find((f) => f.role === 'entry');
    try {
      await deps.updateRun(trade.id, {
        ...governing,
        state: 'EXITED',
        exitEvent: {
          date: marketDate,
          price: exitPrice,
          pnl: entry
            ? computeExitPnl(entry, exitPrice, trade.order.side, trade.legs)
            : 0,
          daysHeld: entry ? calendarDaysBetween(entry.date, marketDate) : 0,
        },
      });
    } catch (err) {
      logger.warn(`run finalize failed post-close on ${trade.id} — eval pass backfills: ${err}`);
    }
  }

  logger.info(`closed ${trade.id} at ${exitPrice} (pnl ${result.trade.realizedPnl})`);
  return {
    tradeId: trade.id,
    exitPrice,
    realizedPnl: result.trade.realizedPnl,
    closedAt: nowIso,
  };
}

export const closePaperTrade = onCall<ClosePaperTradeRequest, Promise<ClosePaperTradeResponse>>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 120,
    secrets: ['RH_CREDENTIAL_BUNDLE'],
  },
  async (request) => {
    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      const m = (manager = await createRobinhoodMcpSessionManagerFromEnv());
      const callTool = (name: string, args: Record<string, unknown>) =>
        m.callTool(name, args);
      const optionQuotes = new RobinhoodMcpOptionQuoteProvider({ callTool });
      return await handleClosePaperTrade(request, {
        getTrade: (tradeId) => getTrade(db, tradeId),
        getOptionQuotes: (ids, side) => optionQuotes.getQuotes(ids, side),
        callTool,
        applyExitFill: (input) => applyExitFill(input, ledgerDeps(db)),
        updateRun: (tradeId, run) =>
          updateVariantRun(db, tradeId, run, new Date().toISOString()),
        now: () => new Date(),
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      throw new HttpsError(
        'internal',
        `closePaperTrade failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      await manager?.close();
    }
  },
);

// The noon-PT `expressionFillPassTimer` lives in
// passes/expression-fill-pass.ts with the pass it schedules.
