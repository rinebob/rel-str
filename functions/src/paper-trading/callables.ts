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
  SIGNAL_EXPRESSION_TEMPLATES,
  SIGNAL_GOVERNING_VARIANT,
  SIGNAL_SHADOW_VARIANT_KEYS,
  type PaperCohort,
  type PaperSignalOrderRequest,
  type PaperSignalOrderResponse,
  type PaperTrade,
  type SignalExpressionTemplate,
} from '@paper-trading/contracts';
import {
  buildCohortId,
  buildSpreadTradeDesc,
  buildTradeId,
  EQUITY_TRADE_DESC,
} from '@paper-trading/ids';
import { db } from '../firebase-admin-init';
import { getMarketDatePT } from '../common/pt-date-utils';
import { ST_ORDER_INTENTS_COLLECTION } from '../common/st-collections';
import { extractEquityPrice, MCP_PREFIX } from './engine/rh-mcp-shapes';
import { applyEntryFill, createPendingTrade } from './ledger';
import type { EntryFillInput, PendingTradeInput } from './ledger';
import {
  getCohort,
  ledgerDeps,
  listTrades,
  resolveTradeId,
  setCohort,
} from './repository';
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

// The noon-PT `expressionFillPassTimer` lives in
// passes/expression-fill-pass.ts with the pass it schedules.
