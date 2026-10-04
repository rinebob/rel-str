/**
 * Flex-chart axis scale math — shared by the FE flex-chart component and the
 * server-side screenshot renderer (Topic #746). Canonical home moved to
 * shared/ in task #766; the originals in
 * `src/app/features/shared/components/flex-chart/strategies/` re-export this
 * file so existing imports keep working.
 *
 * Contents (verbatim ports):
 *  - log-space transform helpers from `strategies/log-transform.ts` — the
 *    single source of the price↔axis-unit mapping for the manual log scale.
 *  - price formatting from `strategies/price-format.ts` — axis labels,
 *    tooltips, and gutter labels.
 */

// ── Log transform (log-transform.ts) ─────────────────────────────────────────

/** Price floor — log is undefined at or below zero, so non-positive
 *  values clamp here. */
export const LOG_AXIS_FLOOR = 0.001;

/** Price → axis units (log10 with floor clamp). */
export function toLogAxis(price: number): number {
  return Math.log10(Math.max(price, LOG_AXIS_FLOOR));
}

/** Axis units → price. */
export function fromLogAxis(axisValue: number): number {
  return Math.pow(10, axisValue);
}

/** Default number of axis labels to aim for when picking a tick step. */
const DEFAULT_TARGET_TICKS = 10;

/**
 * Pick a "nice" price step — 1, 2, or 5 × 10^n — so roughly `targetCount`
 * ticks cover [priceLo, priceHi]. Returns 1 for degenerate ranges.
 */
export function nicePriceStep(priceLo: number, priceHi: number, targetCount = DEFAULT_TARGET_TICKS): number {
  const raw = (priceHi - priceLo) / targetCount;
  if (raw <= 0 || !Number.isFinite(raw)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) {
    if (raw <= m * mag) return m * mag;
  }
  return 10 * mag;
}

/** Nice round-price ticks covering [priceLo, priceHi] — the values axis
 *  labels should display in log mode.
 *
 *  Sub-decade ranges use a linear 1-2-5 step (TradingView-style). Multi-decade
 *  ranges switch to a decade grid — a linear step over a wide ratio leaves
 *  the low decades unlabeled (0.01→10,000 would tick only at 2k,4k,6k…).
 *  ≤3 decades get 1/2/5 per decade; wider spans collapse to powers of 10. */
export function nicePriceTicks(priceLo: number, priceHi: number, targetCount = DEFAULT_TARGET_TICKS): number[] {
  // Non-finite bounds would infinite-loop the linear-step walk below
  // (NaN comparisons are always false). Shared infra must not hang.
  if (!Number.isFinite(priceLo) || !Number.isFinite(priceHi)) return [];
  const decades = Math.log10(priceHi / Math.max(priceLo, LOG_AXIS_FLOOR));
  if (decades > 1) {
    const perDecade = decades <= 3 ? [1, 2, 5] : [1];
    const loPow = Math.floor(Math.log10(Math.max(priceLo, LOG_AXIS_FLOOR)));
    const hiPow = Math.ceil(Math.log10(priceHi));
    const ticks: number[] = [];
    for (let p = loPow; p <= hiPow; p++) {
      for (const m of perDecade) {
        const t = m * Math.pow(10, p);
        if (t >= priceLo && t <= priceHi) ticks.push(t);
      }
    }
    return ticks;
  }
  const step = nicePriceStep(priceLo, priceHi, targetCount);
  // Never emit non-positive ticks — a floor-pinned viewport can hand us a
  // priceLo <= 0, and every tick below the floor clamps to the same smear.
  const lo = Math.max(priceLo, LOG_AXIS_FLOOR);
  const ticks: number[] = [];
  for (let i = Math.ceil(lo / step); ; i++) {
    const t = Number((i * step).toFixed(10));
    if (t > priceHi + 1e-9) break;
    ticks.push(t);
  }
  return ticks;
}

// ── Price formatting (price-format.ts) ───────────────────────────────────────

/** Format a real price for display (e.g. "$1,234"). Sub-dollar prices get
 *  significant decimals — penny/sub-penny ticks would otherwise all render
 *  "$0". */
export function formatPrice(price: number): string {
  if (price >= 1) return `$${Math.round(price).toLocaleString('en-US')}`;
  return `$${parseFloat(price.toPrecision(4)).toLocaleString('en-US')}`;
}
