/**
 * Synthetic OHLC generator — deterministic fake data for the flex-chart
 * sandbox (Topic #468 / Task #478).
 *
 * Real symbols rarely exhibit the axis-stressing edge cases on demand
 * (100x ranges, sub-$1 prices, corrupt ≤0 prints). Seeded PRNG output is
 * fully reproducible — same preset + seed produces byte-identical bars,
 * so a rendered bug is replayable.
 */
import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';

export type SyntheticPreset = 'wide-ratio' | 'penny' | 'non-positive';

export const SYNTHETIC_PRESETS: readonly { value: SyntheticPreset; label: string }[] = [
  { value: 'wide-ratio',   label: 'Wide ratio (~100x)' },
  { value: 'penny',        label: 'Penny stock (<$1)' },
  { value: 'non-positive', label: 'Bad ticks (≤0 lows)' },
];

export const SYNTHETIC_BAR_COUNT = 500;
const DEFAULT_SEED = 42;
const START_DATE = new Date(2024, 0, 2); // 2024-01-02, a Tuesday

/** mulberry32 — small deterministic PRNG, returns [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Advance one calendar day, skipping weekends — synthetic bars are
 *  trading days only, matching the real data's cadence. */
function nextTradingDay(d: Date): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  return next;
}

interface WalkParams {
  /** Starting price. */
  start: number;
  /** Per-bar geometric drift (log-space mean step). */
  drift: number;
  /** Per-bar volatility (log-space stdev-ish). */
  vol: number;
  /** Intra-bar wick fraction. */
  wick: number;
  /** Optional mean-reversion pull per bar toward `anchor` (log space). */
  revert?: number;
  /** Mean-reversion anchor price. */
  anchor?: number;
  /** Optional per-bar mutator for edge-case injection. */
  corrupt?: (bar: PriceBar, i: number) => void;
}

function walk(p: WalkParams, count: number, seed: number): PriceBar[] {
  const rand = mulberry32(seed);
  const bars: PriceBar[] = [];
  let day = START_DATE;
  let prevClose = p.start;

  for (let i = 0; i < count; i++) {
    const pull = p.revert && p.anchor ? p.revert * Math.log(p.anchor / prevClose) : 0;
    const ret = p.drift + pull + p.vol * (rand() * 2 - 1);
    const open = prevClose;
    const close = open * Math.exp(ret);
    const wick = p.wick * rand();
    const bar: PriceBar = {
      // Local-part formatting — toISOString would shift the date a day back
      // in UTC+ timezones and disagree with x.
      date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
      x: new Date(day),
      open,
      high: Math.max(open, close) * (1 + wick),
      low: Math.min(open, close) * (1 - wick),
      close,
      volume: Math.round(1e6 * (0.5 + rand())),
    };
    p.corrupt?.(bar, i);
    bars.push(bar);
    // Carry the pre-corruption close — a corrupt bar must not poison the walk.
    prevClose = close;
    day = nextTradingDay(day);
  }
  return bars;
}

const PRESET_WALKS: Record<SyntheticPreset, WalkParams> = {
  // ~1% daily drift → ~150x over 500 bars; early history is a flat smear on
  // linear, readable on log — the canonical demo for this axis.
  'wide-ratio': { start: 3, drift: 0.010, vol: 0.02, wick: 0.01 },

  // Mean-reverting around $0.15 — exercises the sub-$1 end of the tick ladder.
  'penny': { start: 0.15, drift: 0, vol: 0.08, wick: 0.05, revert: 0.05, anchor: 0.15 },

  // Normal $50 walk, but every 40th bar has a 0 low (bad tick) and bar 250 is
  // fully zeroed — exercises the log floor clamp. A ≤0 low drags the viewport
  // down to log10(0.001) = -3 — intentionally visible, that's the test.
  'non-positive': {
    start: 50, drift: 0, vol: 0.02, wick: 0.01,
    corrupt: (bar, i) => {
      if (i === 250) {
        bar.open = 0; bar.high = 0; bar.low = 0; bar.close = 0;
      } else if (i > 0 && i % 40 === 0) {
        bar.low = 0;
      } else if (i > 0 && i % 97 === 0) {
        bar.low = -1.5;
      }
    },
  },
};

/** Generate a deterministic bar series for the given preset. */
export function generateSyntheticBars(
  preset: SyntheticPreset,
  count = SYNTHETIC_BAR_COUNT,
  seed = DEFAULT_SEED,
): PriceBar[] {
  return walk(PRESET_WALKS[preset], count, seed);
}
