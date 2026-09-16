/**
 * Color mapping utility for the option chain pct change grid.
 *
 * Maps a pctChange value to a CSS color on a diverging red-neutral-green
 * scale, clipped to the [p5, p95] percentile range.
 *
 * Pure function — no Angular dependencies, no side effects.
 */

/** Neutral (white-ish) color for zero change or degenerate ranges. */
const NEUTRAL_COLOR = 'rgb(245, 245, 245)';

/** Max red for the most-negative percentile. */
const RED = { r: 255, g: 0, b: 0 };

/** Max green for the most-positive percentile. */
const GREEN = { r: 0, g: 255, b: 0 };

/** Linearly interpolate a single channel. */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Build an rgb() string from channels. */
function rgb(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Map a pctChange value to a CSS color string.
 *
 * - Clips pctChange to [p5, p95].
 * - When the range straddles 0 (p5 < 0 < p95): three-anchor scale with
 *   p5 → max red, 0 → neutral, p95 → max green.
 * - When the range is one-sided (all positive or all negative): direct
 *   red-to-green interpolation with p5 → max red and p95 → max green.
 * - Interpolates linearly between anchor points.
 *
 * @returns CSS color string, e.g. `rgb(255, 0, 0)`.
 */
export function pctChangeToColor(pctChange: number, p5: number, p95: number): string {
  // Clip to the percentile range.
  const clipped = Math.max(p5, Math.min(p95, pctChange));

  // Handle degenerate ranges.
  if (p5 === p95) {
    return NEUTRAL_COLOR;
  }

  // When 0 is inside [p5, p95], use a three-anchor diverging scale.
  if (p5 < 0 && p95 > 0) {
    if (clipped <= 0) {
      // Red → neutral: t=0 at p5, t=1 at 0.
      const t = (clipped - p5) / (0 - p5);
      return rgb(lerp(RED.r, 245, t), lerp(RED.g, 245, t), lerp(RED.b, 245, t));
    }
    // Neutral → green: t=0 at 0, t=1 at p95.
    const t = clipped / p95;
    return rgb(lerp(245, GREEN.r, t), lerp(245, GREEN.g, t), lerp(245, GREEN.b, t));
  }

  // One-sided range: direct red-to-green interpolation.
  const t = (clipped - p5) / (p95 - p5);
  return rgb(lerp(RED.r, GREEN.r, t), lerp(RED.g, GREEN.g, t), lerp(RED.b, GREEN.b, t));
}
