/**
 * Color mapping utility for the option chain pct change grid.
 *
 * Maps a pctChange value to a CSS color on a diverging red-neutral-green
 * scale anchored at zero. Positive values go from white → green (brighter
 * with magnitude). Negative values go from white → red (brighter with
 * magnitude). No red-green mixing.
 *
 * Pure function — no Angular dependencies, no side effects.
 */

/** Neutral (white) color for zero change. */
const NEUTRAL_COLOR = 'rgb(255, 255, 255)';

/** Max green for the most positive value. */
const GREEN = { r: 0, g: 140, b: 60 };

/** Max red for the most negative value. */
const RED = { r: 200, g: 0, b: 0 };

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
 * - Zero → white (neutral).
 * - Positive → white to green, intensity scaled by magnitude.
 * - Negative → white to red, intensity scaled by magnitude.
 * - `scale` controls how fast the color saturates: at `scale`, the
 *   color reaches full saturation. Values beyond `scale` stay saturated.
 *
 * @returns CSS color string, e.g. `rgb(200, 0, 0)`.
 */
export function pctChangeToColor(pctChange: number, p5: number, p95: number): string {
  // Use the larger of |p5| and |p95| as the saturation scale, so the
  // most extreme values in the grid reach full color.
  const scale = Math.max(Math.abs(p5), Math.abs(p95));
  if (scale === 0) {
    return NEUTRAL_COLOR;
  }

  // Clamp intensity to [0, 1].
  const intensity = Math.min(Math.abs(pctChange) / scale, 1);

  if (pctChange > 0) {
    return rgb(
      lerp(255, GREEN.r, intensity),
      lerp(255, GREEN.g, intensity),
      lerp(255, GREEN.b, intensity),
    );
  }
  if (pctChange < 0) {
    return rgb(
      lerp(255, RED.r, intensity),
      lerp(255, RED.g, intensity),
      lerp(255, RED.b, intensity),
    );
  }
  return NEUTRAL_COLOR;
}
