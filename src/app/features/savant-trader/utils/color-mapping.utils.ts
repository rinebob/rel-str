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

/** Brighter endpoints — dark text stays readable at full saturation. */
const BRIGHT_GREEN = { r: 0, g: 200, b: 80 };
const BRIGHT_RED = { r: 244, g: 67, b: 54 }; // Material Red 500

/** How cell text is kept legible on dark backgrounds. */
export type CellTextMode = 'adaptive' | 'bright' | 'halo';

/** Default contrast mode — single source for the page signal and the
 *  grid's standalone input default. */
export const DEFAULT_CELL_TEXT_MODE: CellTextMode = 'bright';

/** Resolved colors for a cell. */
export interface CellColors {
  bg: string;
  /** Text color override, or 'inherit' to keep the default dark text. */
  fg: string;
  /** Text shadow, or 'none'. */
  shadow: string;
}

/** Intensity at/above which the deep ramp is too dark for black text. */
const DARK_CUTOFF = 0.55;

/** Light halo behind dark glyphs — improves edge contrast on dark cells. */
const HALO_SHADOW =
  '0 0 2px rgba(255,255,255,0.9), 0 0 3px rgba(255,255,255,0.6)';

/** Linearly interpolate a single channel. */
function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Build an rgb() string from channels. */
function rgb(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Map a pctChange value to background + text colors for a given text
 * contrast mode.
 *
 * - 'adaptive': deep ramp; white text once the background darkens past
 *   `DARK_CUTOFF`.
 * - 'bright': brighter ramp endpoints; default dark text stays readable
 *   even at full saturation.
 * - 'halo': deep ramp; a light halo behind the default dark text on dark
 *   backgrounds.
 */
export function pctChangeToCellColors(
  pctChange: number,
  p5: number,
  p95: number,
  mode: CellTextMode,
): CellColors {
  if (mode === 'bright') {
    return { ...rampColor(pctChange, p5, p95, BRIGHT_GREEN, BRIGHT_RED), fg: 'inherit', shadow: 'none' };
  }
  const { bg, intensity } = rampColor(pctChange, p5, p95, GREEN, RED);
  const dark = intensity >= DARK_CUTOFF;
  if (mode === 'adaptive') {
    return { bg, fg: dark ? '#fff' : 'inherit', shadow: 'none' };
  }
  return { bg, fg: 'inherit', shadow: dark ? HALO_SHADOW : 'none' };
}

/** Shared ramp: white → endpoint scaled by |pctChange| relative to the
 *  larger of |p5|/|p95|. Returns the color and clamped intensity. */
function rampColor(
  pctChange: number,
  p5: number,
  p95: number,
  green: { r: number; g: number; b: number },
  red: { r: number; g: number; b: number },
): { bg: string; intensity: number } {
  const scale = Math.max(Math.abs(p5), Math.abs(p95));
  if (scale === 0) {
    return { bg: NEUTRAL_COLOR, intensity: 0 };
  }

  const intensity = Math.min(Math.abs(pctChange) / scale, 1);

  if (pctChange > 0) {
    return {
      bg: rgb(
        lerp(255, green.r, intensity),
        lerp(255, green.g, intensity),
        lerp(255, green.b, intensity),
      ),
      intensity,
    };
  }
  if (pctChange < 0) {
    return {
      bg: rgb(
        lerp(255, red.r, intensity),
        lerp(255, red.g, intensity),
        lerp(255, red.b, intensity),
      ),
      intensity,
    };
  }
  return { bg: NEUTRAL_COLOR, intensity };
}
