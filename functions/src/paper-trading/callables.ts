/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * `paperSignalOrder` callable — accept an ST signal as a paper trade.
 * The order ticket is the provenance anchor: the equity side fills at the
 * acceptance-time RH quote through the ledger, and each direction-mapped
 * expression template is emitted as a STAGED st-order-tickets doc (#1005)
 * that the noon-PT expression-fill pass resolves into a contract-bearing
 * trade (legacy PENDING trades still drain — no new ones are written).
 *
 * No broker mutation calls exist anywhere on this path — the only MCP
 * tools invoked are read-only quote/chain lookups.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';

import { TradeSide } from '@common';
import { OptionQuoteSource } from '@options/common';
import {
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
import { ST_ORDER_INTENTS_COLLECTION, ST_ORDER_TICKETS_ROOT } from '../common/st-collections';
import { stSignalOccurrenceId, stTicketId } from '@st/ids';
import { StOrderTicketWriter } from '../order-tickets/st-order-ticket-writer';
import { StPositionGroupWriter } from '../position-groups/st-position-group-writer';
import type { StPositionGroupEmitter } from '../position-groups/st-position-group-writer';
import type { StGroupOrigin } from '@st/position-groups';
import type { StOrderTicket } from '@st/order-tickets';
import type {
  EmitStOrderTicketInput,
  StOrderTicketEmitter,
} from '../order-tickets/st-order-ticket-writer';
import { extractEquityPrice, MCP_PREFIX } from './engine/rh-mcp-shapes';
import {
  applyEntryFill,
  applyExitFill,
  cancelPendingTrade,
  computeExitPnl,
  orderPriceForLiquidationValue,
} from './ledger';
import type {
  ApplyFillResult,
  CancelTradeInput,
  EntryFillInput,
  ExitFillInput,
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
import { ledgerDepsWithCapture } from './screenshot-lifecycle';
import { buildCohortDoc, makeTicketEmitter, runSignalOrderRetry } from './signal-order-retry';
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
  signalContext?: {
    signalType?: string;
    barDate?: string;
    direction?: string;
    decisionId?: string;
  };
}

/** Narrow ticket-writer surface the paper callables need (#984/#1002/#1005). */
export type PaperOrderTicketsDep = Pick<
  StOrderTicketEmitter,
  'emit' | 'markFilled' | 'markFailed' | 'resolveTicketSeed' | 'get'
>;

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
  setCohort(cohort: PaperCohort): Promise<void>;
  now(): Date;
  /**
   * Canonical `st-order-tickets` emitter (#984/#1002/#1005). When present,
   * the handler stages `pap_` tickets: one per expression template
   * (stays `staged` — the ticket IS the pending expression; the expression-
   * fill pass mints the trade when it resolves a contract) plus the
   * equity ticket, which flips `filled`/`failed` with its ledger fill.
   * Optional for tests/pre-wired callers.
   */
  tickets?: PaperOrderTicketsDep;
  /**
   * Canonical `st-position-groups` emitter (#984/#1004). When present, the
   * handler creates one `{SYM}-{YYMMDD}-grp-{NN}` doc per accept covering
   * every member ticket/trade, stamps `origin.positionGroupId` on emitted
   * tickets and `dims.positionGroupId` on trades, and returns the id.
   * Optional for tests/pre-wired callers — cohorts keep writing either way.
   */
  groups?: PaperPositionGroupsDep;
}

/** Narrow group-writer surface the paper callables need (#984/#1004). */
export type PaperPositionGroupsDep = Pick<StPositionGroupEmitter, 'create' | 'ensure' | 'get'>;

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
  const ticketQtyUsable = ticketQty !== undefined && Number.isInteger(ticketQty) && ticketQty > 0;
  if (ticketQty !== undefined && !ticketQtyUsable) {
    logger.warn(
      `ticket quantity ${ticket.quantity} unusable for refId ${data.refId} — falling back to request quantity`,
    );
  }
  const quantity = ticketQtyUsable ? ticketQty : data.quantity;
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

  // Signal lineage — resolved early: the retry path rebuilds a missing
  // position group from it, and the fresh path mints ticket origins.
  const sc = ticket.signalContext;
  const originType = sc?.signalType ? 'signal' : 'manual';
  // Canonical st-signals occurrence id — only when the legacy ticket's
  // signalContext carries the barDate + signalType needed to mint it.
  const occurrenceId =
    sc?.signalType && sc?.barDate
      ? stSignalOccurrenceId(symbol, sc.barDate, sc.signalType)
      : undefined;
  // StGroupOrigin (signal|program|manual) widens to the ticket origin —
  // the same object seeds both the group doc and member ticket origins.
  const ticketOrigin: StGroupOrigin =
    originType === 'signal'
      ? { type: 'signal', ...(occurrenceId ? { signalId: occurrenceId } : {}) }
      : { type: 'manual' };

  // Expression member ids are staged-ticket seeds (#1005), resolved against
  // emitted pap_ docs — a matching refId = this accept's own ticket
  // (idempotent re-emit); a foreign refId = the base is taken, suffix it.
  const expressionSeedsFor = (side: TradeSide): Promise<string[]> =>
    Promise.all(
      (SIGNAL_EXPRESSION_TEMPLATES[side] ?? []).map((t) => {
        const base = buildTradeId(
          idDate,
          'sig',
          symbol,
          buildSpreadTradeDesc(t.expression, t.targetDelta, t.targetDte),
        );
        return deps.tickets
          ? deps.tickets.resolveTicketSeed(base, data.refId, data.signalId)
          : base;
      }),
    );

  // Canonical staged tickets (#984/#1002/#1005) — emitted on both the fresh
  // and retry paths (emit is create()-idempotent): one per expression
  // template (stays `staged` — the ticket IS the pending expression) plus the
  // equity ticket, which flips filled/failed with its ledger fill.
  const emitTicket = makeTicketEmitter({
    tickets: deps.tickets,
    data,
    userId,
    sc,
    nowIso,
  });

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
    if (!eqTrade) {
      throw new HttpsError(
        'failed-precondition',
        `signal ${data.signalId} has partial trades (${existing.map((t) => t.id).join(', ')}) — manual cleanup required`,
      );
    }
    return runSignalOrderRetry({
      deps, data, userId, existing, eqTrade, ticketOrigin, emitTicket, nowIso,
      fallbackIdDate: idDate,
    });
  }

  const templates = SIGNAL_EXPRESSION_TEMPLATES[data.direction];
  const variantKeys = [SIGNAL_GOVERNING_VARIANT, ...SIGNAL_SHADOW_VARIANT_KEYS];

  // 2. Resolve all ids up front so the cohort can reference every member.
  const equityBase = buildTradeId(idDate, 'sig', symbol, EQUITY_TRADE_DESC);
  const equityTradeId = await deps.resolveTradeId(equityBase);
  const cohortId = await deps.resolveCohortId(idDate, symbol);
  const expressionSeeds = await expressionSeedsFor(data.direction);
  const paperTicket = {
    signalId: data.signalId,
    refId: data.refId,
    acceptedAt: nowIso,
    // Trade → canonical ticket join key. For accept-time members the
    // lifecycle ticket is `pap_{tradeId}`; #1005-minted expression trades
    // instead stamp `pap_{seed}` — the staged ticket they grew from —
    // which is why consumers join on `trade.ticket.ticketId`, not a
    // derived `pap_{tradeId}`.
    ticketId: stTicketId('paper', equityTradeId),
  };

  // Canonical position group (#984/#1004): one `{SYM}-{YYMMDD}-grp-{NN}`
  // doc per accept covering every member ticket/trade — the dual-write
  // partner of the legacy cohort doc. Deterministic members: ticket ids
  // are `pap_{tradeId}`, so the full set is known before any write.
  // Written BEFORE the emits so member tickets carry `origin.positionGroupId`.
  // Post-#1005: expression members are staged tickets, not trades — the
  // group's memberTradeIds/openCount cover only what exists as a trade
  // (the equity leg); expression trades join via groups.addMembers at fill.
  const memberTicketIds = [equityTradeId, ...expressionSeeds].map((id) =>
    stTicketId('paper', id),
  );
  const positionGroupId = deps.groups
    ? await deps.groups.create({
        symbol,
        idDate,
        origin: ticketOrigin,
        mode: 'paper',
        userId,
        memberTicketIds: deps.tickets ? memberTicketIds : [],
        memberTradeIds: [equityTradeId],
        // Only the equity trade exists at mint — it fills OPEN below.
        rollups: { openCount: 1, closedCount: 0 },
        now: nowIso,
      })
    : null;
  const memberOrigin: EmitStOrderTicketInput['origin'] = positionGroupId
    ? { ...ticketOrigin, positionGroupId }
    : { ...ticketOrigin };

  // 3. Equity side: RH quote → entry fill via the ledger.
  const quote = await deps.callTool(`${MCP_PREFIX}get_equity_quotes`, { symbols: [symbol] });
  const price = extractEquityPrice(quote, symbol);
  if (price === undefined) {
    throw new HttpsError('unavailable', `no equity quote for ${symbol}`);
  }
  const equityTicketId = await emitTicket({
    idSeed: equityTradeId,
    origin: memberOrigin,
    cohortId,
    terms: {
      symbol,
      side: data.direction === TradeSide.SHORT ? 'sell' : 'buy',
      instrument: 'equity',
      quantity,
      orderType: 'market',
      timeInForce: 'gfd',
      marketHours: 'regular_hours',
      expression: EQUITY_TRADE_DESC,
    },
  });
  try {
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
        ...(positionGroupId ? { positionGroupId } : {}),
        signalId: data.signalId,
        ticket: paperTicket,
      },
      underlyingClose: price,
      now: nowIso,
    });
  } catch (err) {
    if (equityTicketId && deps.tickets) {
      await deps.tickets.markFailed(
        equityTicketId,
        { category: 'paper-fill', message: err instanceof Error ? err.message : String(err) },
        nowIso,
      );
    }
    throw err;
  }
  if (equityTicketId && deps.tickets) {
    await deps.tickets.markFilled(
      equityTicketId,
      { averagePrice: price, filledQty: quantity, filledAt: nowIso },
      nowIso,
    );
  }

  // 4. Staged expression tickets — the pending expressions the noon-PT
  //    expression-fill pass consumes (#1005). No PENDING trade is written;
  //    the trade materializes at fill under a minted
  //    {SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN} id carrying the
  //    resolved contract. cohortId is a soak-period bridge so the minted
  //    trade can still carry the legacy cohort grouping.
  await Promise.all(
    templates.map(async (t: SignalExpressionTemplate, i: number) => {
      await emitTicket({
        idSeed: expressionSeeds[i],
        origin: memberOrigin,
        cohortId,
        terms: {
          symbol,
          side: t.side === TradeSide.SHORT ? 'sell' : 'buy',
          instrument: 'option',
          quantity: 1,
          orderType: 'market',
          timeInForce: 'gfd',
          marketHours: 'regular_hours',
          expression: t.expression,
          expressionTemplate: t,
        },
      });
    }),
  );

  // 5. Cohort doc — the fan-out anchor. tradeIds lists only minted trades
  //    (the equity leg); expressionTemplates stays the soak anchor for the
  //    staged members (minted trades rejoin the cohort via ticket.cohortId).
  await deps.setCohort(
    buildCohortDoc(
      cohortId, data.signalId, symbol, data.direction,
      [equityTradeId], templates.map((t) => t.key), nowIso, nowIso,
    ),
  );

  logger.info(
    `signal ${data.signalId}: equity ${equityTradeId} + ${expressionSeeds.length} staged ` +
      `expression tickets → ${cohortId}` +
      (positionGroupId ? ` (group ${positionGroupId})` : ''),
  );
  return {
    cohortId,
    equityTradeId,
    expressionTradeIds: expressionSeeds,
    ...(positionGroupId ? { positionGroupId } : {}),
  };
}

// ── Production wiring ──────────────────────────────────────────────────────

/**
 * Canonical `st-order-tickets` → legacy `OrderTicketDoc` view (#1003
 * reader cutover). The paper-order handler reads the same narrow fields
 * either way; the adapter keeps the deps contract stable.
 */
export function stTicketToOrderTicketDoc(t: StOrderTicket): OrderTicketDoc {
  const qty = t.terms?.quantity;
  return {
    id: t.id,
    refId: t.refId,
    symbol: t.terms?.symbol,
    side: t.terms?.side,
    quantity: qty != null ? String(qty) : undefined,
    signalContext: t.signalContext
      ? {
          signalType: t.signalContext.signalType,
          barDate: t.signalContext.barDate,
          direction: t.signalContext.direction,
          decisionId: t.signalContext.decisionId,
        }
      : undefined,
  };
}

/**
 * Ticket lookup by refId — canonical-first with legacy fallback (#1003).
 * Correct at every point in the soak: pre-migration misses fall through
 * to `order-intents`; post-migration hits return the canonical doc.
 */
export async function getTicketDoc(firestore: Firestore, refId: string): Promise<OrderTicketDoc | null> {
  const canon = await firestore
    .collection(ST_ORDER_TICKETS_ROOT)
    .where('refId', '==', refId)
    .get();
  if (!canon.empty) {
    // refId collides with emitted pap_{tradeId} lifecycle tickets during
    // the soak — order docs never carry terms.expression/expressionTemplate,
    // lifecycle tickets always do. If every hit is a lifecycle ticket the
    // order doc lives in the legacy collection — fall through.
    const docs = canon.docs.map((d) => d.data() as StOrderTicket);
    const pick =
      docs.find((t) => t.migratedFrom === 'order-intents')
      ?? docs.find((t) => t.terms != null && t.terms.expression === undefined && t.terms.expressionTemplate === undefined);
    if (pick) return stTicketToOrderTicketDoc(pick);
  }
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
    applyEntryFill: (input) => applyEntryFill(input, ledgerDepsWithCapture(db)),
    setCohort: (cohort) => setCohort(db, cohort),
    now: () => new Date(),
    tickets: new StOrderTicketWriter(),
    groups: new StPositionGroupWriter(),
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
  /** Canonical ticket lookup + cancellation (#984/#1002/#1005) — after the
   *  ledger cancel succeeds, `pap_{tradeId}` flips to `cancelled`; when no
   *  trade exists at all, a still-`staged` expression ticket IS the pending
   *  expression and is cancelled directly (#1005). Fail-soft inside the writer;
   *  absent dep keeps pre-#1002 behavior. */
  tickets?: Pick<StOrderTicketEmitter, 'get' | 'markCancelled'>;
  /** Trades stamped with a staged ticket's id (#1005) — a still-`staged`
   *  ticket can already own a minted OPEN trade (group-join retry window);
   *  cancelling it must not strand a live position. */
  listTradesByTicketId?(ticketId: string): Promise<PaperTrade[]>;
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
    // #1005: pending expressions are staged tickets, not PENDING trades —
    // cancel `pap_{tradeId}` when it's the caller's own staged ticket.
    const ticketId = stTicketId('paper', data.tradeId);
    const ticket = await deps.tickets?.get(ticketId);
    if (!ticket) {
      throw new HttpsError('not-found', `paper trade ${data.tradeId} not found`);
    }
    if (!ticket.userId || ticket.userId !== request.auth.uid) {
      throw new HttpsError('permission-denied', 'paper trade belongs to another user');
    }
    if (ticket.state !== 'staged') {
      throw new HttpsError(
        'failed-precondition',
        `paper trade ${data.tradeId} is not pending (ticket ${ticket.state})`,
      );
    }
    // A staged ticket can already own a minted OPEN trade — mint commits
    // before the ticket flips filled, and a failed group join leaves the
    // ticket staged by design. Cancelling here would strand a live
    // position with a cancelled provenance ticket and no heal path
    // (listStagedExpressionTickets only reads state:'staged').
    const stamped = (await deps.listTradesByTicketId?.(ticketId)) ?? [];
    const live = stamped.filter(
      (t) => t.status !== PaperTradeStatus.CANCELLED && t.status !== PaperTradeStatus.EXPIRED,
    );
    if (live.length > 0) {
      throw new HttpsError(
        'failed-precondition',
        `paper trade ${data.tradeId} already filled (${live[0].id}) — cancel the position, not the ticket`,
      );
    }
    const nowIso = deps.now().toISOString();
    const res = await deps.tickets?.markCancelled(ticketId, nowIso);
    if (res && !res.applied) {
      // The state moved between the read and the txn — report the real
      // outcome rather than a false "cancelled" success.
      const raced = await deps.tickets?.get(ticketId);
      throw new HttpsError(
        'failed-precondition',
        `paper trade ${data.tradeId} is not pending (ticket ${raced?.state ?? res.from ?? 'unavailable'})`,
      );
    }
    return { tradeId: data.tradeId };
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
  const nowIso = deps.now().toISOString();
  try {
    await deps.cancelPendingTrade({
      userId: request.auth.uid,
      tradeId: trade.id,
      now: nowIso,
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
  // Ledger cancel succeeded — settle the canonical ticket too. A fill
  // racing this cancel wins inside the writer's txn guard (filled ≥ staged).
  // Fail-soft like every other ticket write: a canonical-doc failure must
  // not turn an already-succeeded ledger cancel into an internal error.
  try {
    const memberTicketId = stTicketId('paper', trade.id);
    // Ownership guard: `pap_{trade.id}` can belong to a DIFFERENT accept —
    // resolveTicketSeed consults ticket docs only, so a staged expression
    // ticket may sit on this seed while the pending trade is foreign to
    // it. Same doctrine as the fill pass: refId OR signalId.
    const memberTicket = await deps.tickets?.get(memberTicketId);
    const tradeSignalId = trade.ticket?.signalId ?? trade.signalId;
    const sameAccept =
      memberTicket != null &&
      (memberTicket.refId === trade.ticket?.refId ||
        (!!tradeSignalId && memberTicket.signalContext?.signalId === tradeSignalId));
    if (memberTicket && !sameAccept) {
      logger.warn(
        `st_paper_cancel_ticket_foreign ${JSON.stringify({ tradeId: trade.id, ticketId: memberTicketId })}`,
      );
    } else {
      await deps.tickets?.markCancelled(memberTicketId, nowIso);
    }
  } catch (err) {
    logger.warn(
      `st_paper_cancel_ticket ${JSON.stringify({ tradeId: trade.id, error: err instanceof Error ? err.message : String(err) })}`,
    );
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
        tickets: new StOrderTicketWriter(),
        listTradesByTicketId: (ticketId) => listTrades(db, { ticketId }),
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

/** Per-leg mark that fed a `netExitBreakdown` result — persisted in the
 *  raw-quote audit row so an eval-triggered exit can be traced back to real
 *  quotes rather than a synthesized scalar. */
export interface NetExitLegQuote {
  contractID?: string;
  symbol?: string;
  mark: number;
}

export interface NetExitBreakdown {
  /** Signed order-level exit price (the value `netExitPrice` returns). */
  orderMark: number;
  legs: NetExitLegQuote[];
}

/** Net order-level exit price plus the per-leg quotes that produced it.
 *  Signed so the ledger's cashDelta equals the position's liquidation value
 *  (long legs sell for +value, short legs cost −value at buyback). Returns
 *  undefined when any leg quote is missing. */
export async function netExitBreakdown(
  trade: PaperTrade,
  deps: Pick<ClosePaperTradeDeps, 'getOptionQuotes' | 'callTool'>,
): Promise<NetExitBreakdown | undefined> {
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
  const legs: NetExitLegQuote[] = [];
  for (const leg of trade.legs) {
    const mark =
      leg.kind === 'share' ? equityMark : optionMarks.get(leg.contractID);
    if (mark === undefined) return undefined;
    legs.push(
      leg.kind === 'share'
        ? { symbol: trade.symbol, mark }
        : { contractID: leg.contractID, mark },
    );
    value += (leg.side === TradeSide.SHORT ? -1 : 1) * mark * leg.quantity * leg.multiplier;
  }
  return {
    orderMark: orderPriceForLiquidationValue(value, trade.order, trade.legs),
    legs,
  };
}

/** Scalar form of `netExitBreakdown` for callers that only need the price. */
export async function netExitPrice(
  trade: PaperTrade,
  deps: Pick<ClosePaperTradeDeps, 'getOptionQuotes' | 'callTool'>,
): Promise<number | undefined> {
  return (await netExitBreakdown(trade, deps))?.orderMark;
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
        applyExitFill: (input) => applyExitFill(input, ledgerDepsWithCapture(db)),
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
