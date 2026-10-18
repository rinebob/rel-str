/**
 * @topic #984 — ST Firestore Reorg (task #1003)
 *
 * Legacy `savant-trader/data/order-intents` → `st-order-tickets` mapping,
 * shared by two consumers:
 *
 * 1. `orderIntentsMirror` (order-intents-mirror.ts) — the soak-period
 *    dual-write: every FE write to a legacy intent doc re-maps and merges
 *    into the canonical doc, so new writes hit both collections.
 * 2. `migrate-order-intents-1003.ts` — the one-shot backfill of the
 *    existing docs, using the same mapper plus the paper-trade settle
 *    pass (`paperTradeStateSettle`) the #999 mapper contract calls out.
 *
 * Doctrine:
 * - `refId` is preserved verbatim — it is the RH idempotency key; losing
 *   it risks duplicate broker orders on re-submit.
 * - `status:'paper'` is a MODE, not a state → `{mode:'paper'}` + `pap_`
 *   doc id (per `mapLegacyTicketStatus`, #999).
 * - Screenshot tracking fields (role/linkedPositionId/signalId/
 *   lastSeenState/capturedEvents) nest under `ticket.tracking`.
 * - A canonical doc already in a terminal state is never regressed by a
 *   mirror write of a non-terminal legacy state.
 * - Malformed docs are reported (never silently dropped or guessed).
 */
import { stSignalOccurrenceId, stTicketId } from '@st/ids';
import {
  mapLegacyTicketStatus,
  mapOrderSourceToOriginType,
  validateStTicketTerms,
  type StMode,
  type StOrderTicket,
  type StTicketFillSummary,
  type StTicketState,
  type StTicketTerms,
} from '@st/order-tickets';
import type { OrderTicketTrackingFields } from '@screenshot-capture/contracts';

export interface LegacyIntentMapResult {
  ticket?: StOrderTicket;
  /** Non-empty when the doc can't be mapped — migration tallies these. */
  malformed?: string[];
  /** Non-fatal notes (fallbacks applied). */
  warnings?: string[];
}

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

function num(v: unknown): number | undefined {
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/** Deep-strip undefined values so the doc is safe for a merge `set()`. */
function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T;
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) out[k] = stripUndefined(val);
    }
    return out as T;
  }
  return v;
}

/**
 * Settle a paper ticket's final state from its linked trade (the #999
 * mapper contract: open → stays non-terminal, closed → terminal).
 * `PENDING` expression trades map to 'submitted' — the order was accepted
 * but its contract hasn't resolved yet.
 */
export function paperTradeStateSettle(tradeStatus: string): StTicketState | undefined {
  switch (tradeStatus) {
    case 'PENDING':
    case 'OPEN':
    case 'ASSIGNED':
      return 'submitted';
    case 'CLOSED':
      return 'filled';
    case 'CANCELLED':
      return 'cancelled';
    case 'EXPIRED':
      return 'expired';
    default:
      return undefined;
  }
}

export const TERMINAL_STATES: ReadonlySet<StTicketState> = new Set([
  'filled', 'cancelled', 'expired', 'failed',
]);

/**
 * Terminal-wins: given an existing canonical doc's state and a freshly
 * mapped write payload, strip the state-adjacent fields when the existing
 * state is terminal and the incoming state is not — a mirror write or a
 * migration rerun must never regress a settled ticket. Shared by
 * `mirrorOrderIntent` and `migrate-order-intents-1003.ts`.
 */
export function suppressTerminalRegression(
  existingState: StTicketState | undefined,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const incoming = doc.state as StTicketState | undefined;
  if (!existingState || !incoming) return doc;
  // Fill always wins — the writer's doctrine (a fill racing a cancel
  // settles filled; a filled ticket can't expire or cancel afterwards).
  const fillWins = existingState === 'filled' && incoming !== 'filled';
  const terminalToNonTerminal =
    TERMINAL_STATES.has(existingState) && !TERMINAL_STATES.has(incoming);
  if (!fillWins && !terminalToNonTerminal) return doc;
  const {
    state: _s, submittedAt: _sa, filledAt: _f, cancelledAt: _c,
    fillSummary: _fs, lastError: _le, terminalAt: _t,
    ...rest
  } = doc;
  return rest;
}

/** Post-staging states that need a `submittedAt` stamp per the writer contract. */
const POST_STAGING_STATES: ReadonlySet<StTicketState> = new Set([
  'submitted', 'cancel_pending', 'filled', 'cancelled', 'expired', 'failed',
]);

/** Order-insensitive structural equality — Firestore returns its own key
 *  ordering on read, so mapped-doc-vs-stored comparisons (migration rerun
 *  detection, parity audit) must not depend on insertion order. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length
      && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const keys = Object.keys(ra);
  return keys.length === Object.keys(rb).length
    && keys.every((k) => deepEqual(ra[k], rb[k]));
}

/**
 * Map one legacy order-intents doc to a canonical StOrderTicket.
 * `opts.settledState` overrides the mapped state and `opts.settledFill`
 * supplies the fill payload — the migration's paper-settle pass provides
 * both after looking up the linked trade (`filled` requires fillSummary
 * per the canonical audit).
 */
export function legacyIntentToTicket(
  intentId: string,
  legacy: Record<string, unknown>,
  opts: { settledState?: StTicketState; settledFill?: StTicketFillSummary } = {},
): LegacyIntentMapResult {
  const malformed: string[] = [];
  const warnings: string[] = [];

  const statusMap = mapLegacyTicketStatus(str(legacy.status));
  if (!statusMap) malformed.push(`unmappable status '${String(legacy.status)}'`);

  const originType = mapOrderSourceToOriginType(str(legacy.source));
  if (!originType) malformed.push(`unmappable source '${String(legacy.source)}'`);

  const userId = str(legacy.userId);
  if (!userId) malformed.push('missing userId');

  const accountTarget = str(legacy.accountNumber);
  if (!accountTarget) malformed.push('missing accountNumber');

  const symbol = str(legacy.symbol);
  if (!symbol) malformed.push('missing symbol');

  const createdAt = str(legacy.createdAt);
  if (!createdAt) malformed.push('missing createdAt');

  const refId = str(legacy.refId);
  if (!refId) warnings.push(`missing refId — fell back to doc id '${intentId}'`);

  const side = str(legacy.side);
  if (side !== 'buy' && side !== 'sell') malformed.push(`unmappable side '${String(legacy.side)}'`);

  // ── terms ────────────────────────────────────────────────────────────
  const instrumentType = str(legacy.instrumentType);
  const terms: StTicketTerms = {
    symbol: symbol ?? '',
    side: (side === 'buy' || side === 'sell' ? side : 'buy'),
  };
  if (instrumentType === 'equity' || instrumentType === 'etf' || instrumentType === 'option') {
    terms.instrument = instrumentType;
  }
  const quantity = num(legacy.quantity);
  const dollarAmount = num(legacy.dollarAmount);
  // Both-sized legacy docs exist in prod — prefer quantity deterministically
  // (share sizing is the more explicit intent) and note the drop.
  if (quantity != null && dollarAmount != null) {
    warnings.push(`both quantity (${quantity}) and dollarAmount (${dollarAmount}) present — kept quantity, dropped dollarAmount`);
  }
  if (quantity != null) terms.quantity = quantity;
  else if (dollarAmount != null) terms.dollarAmount = dollarAmount;
  const orderType = str(legacy.orderType);
  if (orderType === 'market' || orderType === 'limit' || orderType === 'stop_market'
    || orderType === 'stop_limit' || orderType === 'stop_loss') {
    terms.orderType = orderType;
  }
  const tif = str(legacy.timeInForce);
  if (tif === 'gfd' || tif === 'gtc') terms.timeInForce = tif;
  const hours = str(legacy.marketHours);
  if (hours === 'regular_hours' || hours === 'extended_hours' || hours === 'all_day_hours') {
    terms.marketHours = hours;
  }
  const limitPrice = num(legacy.limitPrice) ?? num(legacy.price); // option tickets use `price`
  const stopPrice = num(legacy.stopPrice);
  if (limitPrice != null || stopPrice != null) {
    terms.limits = stripUndefined({ limitPrice, stopPrice });
  }
  if (Array.isArray(legacy.taxLots)) {
    terms.taxLots = legacy.taxLots
      .filter((l) => l && typeof l === 'object')
      .map((l) => ({ lotId: str((l as Record<string, unknown>).lotId) ?? '', quantity: String((l as Record<string, unknown>).quantity ?? '') }));
  }
  if (instrumentType === 'option') {
    if (!Array.isArray(legacy.legs) || legacy.legs.length === 0) {
      malformed.push('option ticket without legs');
    } else {
      terms.legs = (legacy.legs as Record<string, unknown>[]).map((l) => stripUndefined({
        side: (str(l.side) === 'sell' ? 'sell' : 'buy') as 'buy' | 'sell',
        occSymbol: str(l.symbol) ?? '',
        optionId: str(l.optionId) ?? '',
        positionEffect: (str(l.positionEffect) === 'close' ? 'close' : 'open') as 'open' | 'close',
        ratioQuantity: num(l.ratioQuantity),
      }));
    }
  } else if (Array.isArray(legacy.legs) && legacy.legs.length > 0) {
    warnings.push(`legs present but instrumentType '${instrumentType ?? 'missing'}' is not 'option' — legs dropped`);
  }
  try {
    validateStTicketTerms(terms);
  } catch (err) {
    malformed.push(`terms: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (malformed.length > 0) return { malformed, warnings };

  const mode: StMode = statusMap!.mode;
  const state: StTicketState = opts.settledState ?? statusMap!.state;
  const updatedAt = str(legacy.updatedAt) ?? createdAt!;
  // terminalAt is RH-derived; legacy docs that predate it fall back to
  // updatedAt on terminal states so the canonical audit holds.
  const terminalAt = str(legacy.terminalAt)
    ?? (TERMINAL_STATES.has(state) ? updatedAt : undefined);

  // ── origin ───────────────────────────────────────────────────────────
  const origin: StOrderTicket['origin'] = { type: originType! };
  const sigCtx = (legacy.signalContext ?? undefined) as Record<string, unknown> | undefined;
  if (originType === 'signal' && sigCtx) {
    const sigType = str(sigCtx.signalType);
    const barDate = str(sigCtx.barDate);
    if (sigType && barDate) {
      try {
        origin.signalId = stSignalOccurrenceId(symbol!, barDate, sigType);
      } catch {
        warnings.push('signalContext could not mint an occurrence id');
      }
    }
  }
  if (originType === 'management') {
    const sourceRef = legacy.sourceRef as Record<string, unknown> | undefined;
    const groupId = str(sourceRef?.id);
    if (groupId) origin.positionGroupId = groupId;
  }

  // ── state-adjacent fields ────────────────────────────────────────────
  const result = (legacy.result ?? undefined) as Record<string, unknown> | undefined;
  const brokerOrder = (result?.brokerOrder ?? undefined) as Record<string, unknown> | undefined;
  const submittedAt = POST_STAGING_STATES.has(state) ? createdAt! : undefined;
  const filledAt = state === 'filled'
    ? str(brokerOrder?.lastTransactionAt) ?? opts.settledFill?.filledAt ?? terminalAt ?? updatedAt
    : undefined;
  const cancelledAt = state === 'cancelled' ? terminalAt ?? updatedAt : undefined;

  let fillSummary: StTicketFillSummary | undefined;
  if (state === 'filled') {
    const avg = num(result?.fillPrice);
    const qty = num(result?.filledQuantity) ?? quantity;
    if (avg != null && qty != null) {
      fillSummary = { averagePrice: avg, filledQty: qty, filledAt: filledAt ?? updatedAt };
    } else if (opts.settledFill) {
      // Paper settle — the linked trade's entry fill is the order's fill.
      fillSummary = opts.settledFill;
    } else {
      warnings.push("state 'filled' without fill data — fillSummary absent");
    }
  }

  const error = (legacy.error ?? undefined) as Record<string, unknown> | undefined;
  const lastError = state === 'failed'
    ? error
      ? { category: str(error.code) ?? 'legacy', message: str(error.message) ?? 'unknown' }
      : { category: 'legacy-missing', message: 'error details not captured on the legacy doc' }
    : undefined;

  const reviewSnapshot = brokerOrder ? { orderChecks: brokerOrder } : undefined;

  // ── lineage + tracking ───────────────────────────────────────────────
  const signalContext = sigCtx
    ? stripUndefined({
        signalType: str(sigCtx.signalType),
        barDate: str(sigCtx.barDate),
        timeframe: str(sigCtx.timeframe),
        direction: str(sigCtx.direction),
        decisionId: str(sigCtx.decisionId),
        decisionIds: Array.isArray(sigCtx.decisionIds)
          ? (sigCtx.decisionIds as unknown[]).map(String)
          : undefined,
        signalPrice: num(sigCtx.signalPrice),
      })
    : undefined;

  const tracking: OrderTicketTrackingFields = stripUndefined({
    role: legacy.role as OrderTicketTrackingFields['role'],
    linkedPositionId: str(legacy.linkedPositionId),
    signalId: str(legacy.signalId),
    lastSeenState: str(legacy.lastSeenState),
    capturedEvents: legacy.capturedEvents as OrderTicketTrackingFields['capturedEvents'],
  });
  const hasTracking = Object.values(tracking).some((v) => v !== undefined);

  const ticket: StOrderTicket = stripUndefined({
    id: stTicketId(mode, intentId),
    origin,
    auto: originType === 'signal',
    mode,
    terms,
    state,
    refId: refId ?? intentId,
    brokerOrderId: str(result?.orderId),
    reviewSnapshot,
    fillSummary,
    lastError,
    accountTarget: accountTarget!,
    userId: userId!,
    bucketId: str(legacy.bucketId),
    signalContext: signalContext && Object.keys(signalContext).length > 0 ? signalContext : undefined,
    tracking: hasTracking ? tracking : undefined,
    migratedFrom: 'order-intents',
    terminalAt,
    createdAt: createdAt!,
    updatedAt,
    submittedAt,
    filledAt,
    cancelledAt,
  });

  return { ticket, warnings };
}
