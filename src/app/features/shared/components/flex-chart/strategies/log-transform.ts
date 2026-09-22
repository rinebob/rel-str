/**
 * Log-space transform helpers — the single source of the price↔axis-unit
 * mapping for the manual log scale. Pure functions so both the strategy
 * (viewport/pixels/labels) and the data adapter (series dataSources) share
 * one mapping.
 */

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
 *  labels should display in log mode (TradingView-style 1-2-5 steps). */
export function nicePriceTicks(priceLo: number, priceHi: number, targetCount = DEFAULT_TARGET_TICKS): number[] {
  const step = nicePriceStep(priceLo, priceHi, targetCount);
  const ticks: number[] = [];
  for (let t = Math.ceil(priceLo / step) * step; t <= priceHi + 1e-9; t += step) {
    ticks.push(t);
  }
  return ticks;
}
