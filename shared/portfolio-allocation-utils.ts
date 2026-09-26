/**
 * Portfolio-allocation rollup utils (Blueprint #581 / task #584).
 *
 * Pure functions over normalized domain inputs — the service layer maps MCP
 * shapes (EquityPosition/OptionPosition/BrokerOrder) into
 * AllocationPositionInput / AllocationFillInput, so this file has zero MCP
 * or Firestore coupling. `instrumentId` here is the same string as
 * PositionAttribution.instrumentId — the RH instrument UUID for options,
 * the symbol for equities (the MCP surface exposes no instrument id for
 * equities). See `shared/portfolio-allocation-contracts.ts`.
 */

import type { EquityCurvePoint } from './common';
import type { AllocationBucket, BucketStats, PositionAttribution } from './portfolio-allocation-contracts';

/** An open position reduced to what the rollup needs (signed values). */
export interface AllocationPositionInput {
  instrumentId: string;
  /** Signed quantity (negative for shorts). */
  quantity: number;
  /** Signed current market value (negative for short liabilities). */
  marketValue: number;
  /** Signed cost basis. */
  costBasis: number;
}

/** One fill, normalized. The service layer expands the raw order's
 *  legs[] (multi-instrument option orders) and executions[] into one
 *  input per instrument per fill. `multiplier` is 1 for equities,
 *  100 for option contracts.
 *
 *  `positionEffect` mirrors the option leg's open/close flag (equities may
 *  omit it). It guards against truncated order history: a `close` fill
 *  whose opening fill fell outside the returned window would otherwise
 *  fabricate a phantom lot of the opposite sign. When `close` and no
 *  opposing lot remains, the leftover quantity is dropped — its cost basis
 *  is unknowable, so realizing "P&L" on it would be fiction.
 *
 *  OMITTED flag = assumed open-capable: an un-flagged sell that outruns the
 *  book opens a SHORT lot (sell-to-open is legitimate). The service layer
 *  should therefore populate `close` whenever it can infer it — e.g. an
 *  equity sell bounded by the position's `sharesHeldForSells`. Without the
 *  flag, a truncated-history sell silently becomes a phantom short and
 *  poisons subsequent matches; that is a documented fidelity bound of
 *  omitted flags, not a bug in the matcher. */
export interface AllocationFillInput {
  instrumentId: string;
  side: 'buy' | 'sell';
  positionEffect?: 'open' | 'close';
  quantity: number;
  price: number;
  multiplier: number;
  /** ISO timestamp of the fill (execution time, or order time as fallback). */
  filledAt: string;
}

/** Result of joining a position to its bucket. */
export interface PositionBucketResult {
  position: AllocationPositionInput;
  /** Owning bucket id, or null when the position is Unassigned
   *  (no attribution doc — Unassigned is the absence of a record). */
  bucketId: string | null;
}

/** One FIFO match between an open lot and a closing fill. */
export interface RealizedMatch {
  instrumentId: string;
  /** ISO timestamp of the closing fill. */
  closedAt: string;
  quantity: number;
  /** Realized dollars for the matched quantity (signed). */
  pnl: number;
}

export interface InstrumentRealized {
  realizedPnl: number;
  matches: RealizedMatch[];
}

/** targetPct of the allocation basis → dollars. The basis is the caller's
 *  choice — the allocation model uses RH-reported cash (you allocate
 *  strategies FROM the cash pool), so the service passes the account's
 *  broker cash figure here. */
export function targetDollars(allocationBasis: number, targetPct: number): number {
  return allocationBasis * (targetPct / 100);
}

/** Positive = over target. */
export function drift(exposure: number, targetDollarAmount: number): number {
  return exposure - targetDollarAmount;
}

/** Warn-not-block predicate: would adding orderCost push the bucket over
 *  its target? Mirrors the order-guardrails warn-only convention. Fails
 *  CLOSED — a guardrail that can't compute still warns (non-finite input
 *  means the caller's data is suspect; silence is the wrong default). */
export function wouldExceedTarget(currentExposure: number, orderCost: number, targetDollarAmount: number): boolean {
  if (!Number.isFinite(currentExposure) || !Number.isFinite(orderCost) || !Number.isFinite(targetDollarAmount)) {
    return true;
  }
  return currentExposure + orderCost > targetDollarAmount;
}

/**
 * Join open positions to their attribution docs. `accountNumber` scopes the
 * join — attributions from other accounts never leak in. Positions with no
 * attribution doc get `bucketId: null` (Unassigned — see contracts).
 */
export function attributePositions(
  positions: AllocationPositionInput[],
  attributions: PositionAttribution[],
  accountNumber: string,
): PositionBucketResult[] {
  const byInstrument = new Map<string, string>();
  for (const a of attributions) {
    if (a.accountNumber === accountNumber) byInstrument.set(a.instrumentId, a.bucketId);
  }
  // Last-write-wins on duplicate instrumentIds — unreachable in practice
  // (attribution doc ids are `{account}_{instrumentId}` composites, so the
  // collection can't hold two); documented for hand-built callers.
  return positions.map((position) => ({ position, bucketId: byInstrument.get(position.instrumentId) ?? null }));
}

function isWellFormedPosition(p: AllocationPositionInput): boolean {
  return Number.isFinite(p.quantity) && p.quantity !== 0
    && Number.isFinite(p.marketValue)
    && Number.isFinite(p.costBasis);
}

interface OpenLot {
  /** Signed quantity — positive for open longs, negative for open shorts. */
  qty: number;
  price: number;
  multiplier: number;
}

function isWellFormed(f: AllocationFillInput): boolean {
  return Number.isFinite(f.quantity) && f.quantity > 0
    && Number.isFinite(f.price)
    && Number.isFinite(f.multiplier) && f.multiplier > 0
    && !Number.isNaN(Date.parse(f.filledAt));
}

/**
 * FIFO realized-P&L matching per instrument. Buys and sells net into signed
 * open lots; a fill closing against the front lot realizes
 * `(fillPrice − lotPrice) × sign(lotQty) × qty × multiplier` — that works for
 * both long-close (sell after buy) and short-cover (buy after sell).
 *
 * Fidelity bound: broker order history depth limits this — RH may not return
 * the full history, so realizedPnl is a lower bound. Malformed fills are
 * skipped rather than failing the rollup.
 */
export function matchRealizedPnl(fills: AllocationFillInput[]): Map<string, InstrumentRealized> {
  const byInstrument = new Map<string, AllocationFillInput[]>();
  for (const f of fills) {
    if (!isWellFormed(f)) continue;
    const list = byInstrument.get(f.instrumentId) ?? [];
    list.push(f);
    byInstrument.set(f.instrumentId, list);
  }

  const out = new Map<string, InstrumentRealized>();
  for (const [instrumentId, list] of byInstrument) {
    // Sort by parsed time — ISO strings sort correctly under localeCompare
    // only when canonical; Date.parse is format-agnostic.
    list.sort((a, b) => Date.parse(a.filledAt) - Date.parse(b.filledAt));
    const lots: OpenLot[] = [];
    const matches: RealizedMatch[] = [];
    let realizedPnl = 0;

    for (const f of list) {
      const sign = f.side === 'buy' ? 1 : -1;
      let remaining = f.quantity;
      while (remaining > 0 && lots.length > 0 && Math.sign(lots[0].qty) !== sign) {
        const lot = lots[0];
        const matched = Math.min(Math.abs(lot.qty), remaining);
        const pnl = (f.price - lot.price) * Math.sign(lot.qty) * matched * lot.multiplier;
        realizedPnl += pnl;
        matches.push({ instrumentId, closedAt: f.filledAt, quantity: matched, pnl });
        lot.qty -= Math.sign(lot.qty) * matched;
        remaining -= matched;
        if (lot.qty === 0) lots.shift();
      }
      // A close with nothing left to close can't be realized — the opening
      // fills are outside the history window. Drop it rather than opening
      // a phantom lot that would poison every subsequent match.
      if (remaining > 0 && f.positionEffect !== 'close') {
        lots.push({ qty: sign * remaining, price: f.price, multiplier: f.multiplier });
      }
    }
    out.set(instrumentId, { realizedPnl, matches });
  }
  return out;
}

/**
 * The single rollup seam (PRD "Seam for testing"). Inputs are the account's
 * full position/fill/attribution sets; the function keeps only the bucket's
 * share. A bucket owns its instruments' FULL activity — order history is
 * not split at attribution-change boundaries.
 *
 * Exposure is GROSS (Σ |marketValue|) — how much capital the strategy
 * deploys, so short positions count toward the target rather than netting
 * against it. Cash = accountValue − Σ gross exposures (see cashExposure).
 *
 * equityCurve is cumulative realized P&L per market date; when the bucket
 * has open positions the last point folds in current unrealized P&L — the
 * approximation the PRD sanctions (no historical marks exist).
 */
export function computeBucketStats(
  bucket: AllocationBucket,
  /** Allocation basis for target math — RH-reported cash (see targetDollars). */
  allocationBasis: number,
  positions: AllocationPositionInput[],
  fills: AllocationFillInput[],
  attributions: PositionAttribution[],
  asOf: string,
): BucketStats {
  const owned = new Set(
    attributions
      .filter((a) => a.accountNumber === bucket.accountNumber && a.bucketId === bucket.id)
      .map((a) => a.instrumentId),
  );

  const bucketPositions = positions.filter((p) => owned.has(p.instrumentId) && isWellFormedPosition(p));
  const exposure = bucketPositions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0);
  const netValue = bucketPositions.reduce((sum, p) => sum + p.marketValue, 0);
  const target = targetDollars(allocationBasis, bucket.targetPct);
  const unrealizedPnl = bucketPositions.reduce((sum, p) => sum + (p.marketValue - p.costBasis), 0);

  const realized = matchRealizedPnl(fills);
  const bucketMatches: RealizedMatch[] = [];
  let realizedPnl = 0;
  let hasAnyFill = false;
  for (const instrumentId of owned) {
    const r = realized.get(instrumentId);
    if (!r) continue;
    if (r.matches.length > 0 || fills.some((f) => f.instrumentId === instrumentId && isWellFormed(f))) hasAnyFill = true;
    realizedPnl += r.realizedPnl;
    bucketMatches.push(...r.matches);
  }

  // "Closed" = attributed instrument that was traded (well-formed fill
  // history) but is currently flat. Attributed-but-never-traded instruments
  // land in neither count — there is nothing to count.
  const openIds = new Set(bucketPositions.map((p) => p.instrumentId));
  const closedCount = [...owned].filter((id) => !openIds.has(id) && fills.some((f) => f.instrumentId === id && isWellFormed(f))).length;

  // Cumulative realized P&L per market date (day buckets fold same-day
  // matches across instruments, dates sorted).
  const perDay = new Map<string, number>();
  for (const m of bucketMatches) {
    const day = new Date(m.closedAt).toISOString().slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + m.pnl);
  }
  const equityCurve: EquityCurvePoint[] = [];
  let cumulative = 0;
  for (const day of [...perDay.keys()].sort()) {
    cumulative += perDay.get(day) as number;
    equityCurve.push({ date: day, cumulativePnl: cumulative });
  }
  // Approximation: fold current unrealized into the as-of point so the
  // curve lands on the bucket's real current P&L. If asOf predates the
  // last realized day (stale snapshot/clock skew), merge into that point
  // rather than emitting a backwards-dated point — the curve stays
  // monotone in date order.
  if (bucketPositions.length > 0 || hasAnyFill) {
    const parsedAsOf = Date.parse(asOf);
    const asOfDay = Number.isNaN(parsedAsOf) ? '' : new Date(parsedAsOf).toISOString().slice(0, 10);
    const withUnrealized = cumulative + unrealizedPnl;
    const last = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : undefined;
    if (last && last.date >= asOfDay) {
      equityCurve[equityCurve.length - 1] = { date: last.date, cumulativePnl: withUnrealized };
    } else {
      equityCurve.push({ date: asOfDay, cumulativePnl: withUnrealized });
    }
  }

  return {
    bucketId: bucket.id,
    exposure,
    netValue,
    targetDollars: target,
    drift: drift(exposure, target),
    realizedPnl,
    unrealizedPnl,
    openCount: bucketPositions.length,
    closedCount,
    asOf,
    equityCurve,
  };
}

/**
 * Derived Cash residual — `accountValue − Σ signed position market values`
 * over the account's FULL position set (bucketed and Unassigned alike).
 * Account value already nets short liabilities, so the residual is the
 * positions-attributable cash figure. Compare against the broker-reported
 * cash via `cashCheck` — the residual is a forecast, not the reported
 * number.
 */
export function cashExposure(accountValue: number, positions: AllocationPositionInput[]): number {
  return positions
    .filter(isWellFormedPosition)
    .reduce((residual, p) => residual - p.marketValue, accountValue);
}

/** Result of comparing broker-reported cash against the derived residual. */
export interface CashCheck {
  /** Cash as reported by the broker (actual). */
  actual: number;
  /** Residual derived from account value minus positions (forecast). */
  derived: number;
  /** actual − derived. Positive = broker holds more cash than positions imply. */
  discrepancy: number;
  /** True when |discrepancy| exceeds tolerance — data is stale, unsettled,
   *  or fills are pending; surfaces a warning, never blocks. */
  diverged: boolean;
}

/**
 * Actual-vs-forecast cash reconciliation. The Cash row reports the
 * broker's number; the derived residual is the cross-check — divergence
 * beyond `tolerance` means the position/account snapshots are out of sync
 * (pending orders, settle lag, stale positions) and the page should flag
 * the row rather than silently trust either figure.
 */
export function cashCheck(rhCash: number, accountValue: number, positions: AllocationPositionInput[], tolerance = 1): CashCheck {
  const derived = cashExposure(accountValue, positions);
  const discrepancy = rhCash - derived;
  return { actual: rhCash, derived, discrepancy, diverged: Math.abs(discrepancy) > tolerance };
}
