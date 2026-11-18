/**
 * @topic #553 — Paper Trading Infra (task #563)
 *
 * Exit-variant registry: named variant families, each with a typed param
 * shape parsed from the `variantKey` and a pure `evaluate` rule.
 *
 * Keys: `initial-stop-{pct}` (e.g. `initial-stop-10` = stop at 10% adverse
 * move off entry), `trailing-{pct}` (`trailing-20` = 20% reversal off the
 * favorable water mark), `time-{N}d` (`time-30d` = close after N days),
 * `limit-sd{n}` (`limit-sd1` = underlying crosses an N-sigma StdDevLines
 * level — STUBBED until the StdDevLines algo lands; registered but never
 * fires).
 *
 * Direction: `order.side` decides which mark move is adverse. SHORT legs
 * lose when the mark rises (liability grows); LONG legs lose when it falls.
 */

import { TradeSide } from '@common';
import {
  isGoverningEligiblePct,
  TERMINAL_VARIANT_FAMILIES,
} from '@paper-trading/contracts';
import type {
  ExitVariantConfig,
  PaperTrade,
  VariantRun,
} from '@paper-trading/contracts';

// ── Key parsing ─────────────────────────────────────────────────────────────

export type VariantDef =
  | { family: 'initial-stop'; params: { stopPct: number } }
  | { family: 'trailing-stop'; params: { stopPct: number } }
  | { family: 'time-stop'; params: { days: number } }
  | { family: 'limit-stddev'; params: { sigma: number } }
  | { family: 'ma-close'; params: { period: number } }
  | { family: 'target'; params: { pct: number } };

const PATTERNS: [RegExp, (m: RegExpMatchArray) => VariantDef][] = [
  [
    /^initial-stop-(\d+(?:\.\d+)?)$/,
    (m) => ({ family: 'initial-stop', params: { stopPct: Number(m[1]) / 100 } }),
  ],
  [
    /^trailing-(\d+(?:\.\d+)?)$/,
    (m) => ({ family: 'trailing-stop', params: { stopPct: Number(m[1]) / 100 } }),
  ],
  [
    /^time-(\d+)d$/,
    (m) => ({ family: 'time-stop', params: { days: Number(m[1]) } }),
  ],
  [
    /^limit-sd(\d+(?:\.\d+)?)$/,
    (m) => ({ family: 'limit-stddev', params: { sigma: Number(m[1]) } }),
  ],
  [
    /^ma-close-(\d+)$/,
    (m) => ({ family: 'ma-close', params: { period: Number(m[1]) } }),
  ],
  [
    /^target-(\d+(?:\.\d+)?)$/,
    (m) => ({ family: 'target', params: { pct: Number(m[1]) / 100 } }),
  ],
];

/**
 * Registry of shippable variant configurations — the dashboard picker list
 * (`listExitVariants`). `params.pct`/`sdMultiplier` carry the human number
 * matching the key suffix (10 = 10%), not the registry's internal fraction.
 */
export const EXIT_VARIANT_CONFIGS: readonly ExitVariantConfig[] = [
  {
    key: 'initial-stop-10',
    label: 'Initial stop — 10% adverse move off entry',
    params: { type: 'initial-stop', pct: 10 },
  },
  {
    key: 'trailing-20',
    label: 'Trailing stop — 20% reversal off the water mark',
    params: { type: 'trailing-stop', pct: 20 },
  },
  {
    key: 'time-9d',
    label: 'Time stop — close after 9 days',
    params: { type: 'time-stop', days: 9 },
  },
  {
    key: 'time-30d',
    label: 'Time stop — close after 30 days',
    params: { type: 'time-stop', days: 30 },
  },
  {
    key: 'limit-sd1',
    label: 'StdDev level cross — 1σ (stub, never fires yet)',
    params: { type: 'limit-stddev', sdMultiplier: 1 },
  },
];

export function listExitVariantConfigs(): ExitVariantConfig[] {
  return [...EXIT_VARIANT_CONFIGS];
}

/** Parse a variantKey into its family + typed params; null when unknown. */
export function parseVariantKey(variantKey: string): VariantDef | null {
  for (const [re, build] of PATTERNS) {
    const m = variantKey.match(re);
    if (m) return build(m);
  }
  return null;
}

/** True when the key parses to a governing-eligible family (the US4
 *  product gate: trailing stops only) with a sane param — `trailing-0`
 *  would fire on the first mark, `trailing-100+` never triggers
 *  realistically. (`seedVariantRuns` refuses non-terminal governing
 *  keys; legacy `'none'` docs are written by positionToTrade directly
 *  and never traverse seeding.) */
export function isTerminalVariantKey(key: string): boolean {
  const def = parseVariantKey(key);
  if (!def || !TERMINAL_VARIANT_FAMILIES.includes(def.family)) return false;
  // Pct-param families additionally need a sane bound; a non-pct family
  // added later is governed by membership alone.
  if ('stopPct' in def.params) {
    return isGoverningEligiblePct(def.params.stopPct);
  }
  return true;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

export interface VariantEvalCtx {
  trade: PaperTrade;
  /** Order-level per-contract mark for the eval date. */
  mark: number;
  /** Underlying close for the eval date (missing marks may omit it). */
  underlyingClose?: number;
  /** 'YYYY-MM-DD' eval date. */
  date: string;
  /** Calendar days since the entry fill. */
  daysHeld: number;
  run: VariantRun;
  /** Indicator snapshot for `ma-close-*` runs — `sma[N]` = the N-day
   *  simple moving average on the eval date. Supplied by the eval pass
   *  (bars dep) or the backfill walk (precomputed). Absent → the
   *  evaluator skips rather than firing blind. */
  indicators?: { sma?: Record<number, number> };
}

export interface VariantEvalResult {
  /** True when the variant's exit condition fired on this mark. */
  trigger: boolean;
  /** Persist on `run.workingState`; undefined = unchanged. */
  workingState?: Record<string, number>;
}

/** Entry fill price for the trade (0 when absent). Exported for the
 *  governing policy's below-entry fallback check. */
export function entryPrice(trade: PaperTrade): number {
  return trade.fills.find((f) => f.role === 'entry')?.price ?? 0;
}

export function isShort(trade: PaperTrade): boolean {
  return trade.order.side === TradeSide.SHORT;
}

/** Evaluate the run's variant against today's mark. Pure — no I/O. */
export function evaluateVariant(ctx: VariantEvalCtx): VariantEvalResult {
  const def = parseVariantKey(ctx.run.variantKey);
  if (!def) return { trigger: false };
  switch (def.family) {
    case 'initial-stop': {
      const entry = entryPrice(ctx.trade);
      const breach = isShort(ctx.trade)
        ? ctx.mark >= entry * (1 + def.params.stopPct)
        : ctx.mark <= entry * (1 - def.params.stopPct);
      return { trigger: breach };
    }
    case 'trailing-stop': {
      if (isShort(ctx.trade)) {
        // Favorable extreme is the lowest mark seen (cheapest buyback).
        const low = Math.min(
          ctx.run.workingState.lowWaterMark ?? entryPrice(ctx.trade),
          ctx.mark,
        );
        return {
          trigger: ctx.mark >= low * (1 + def.params.stopPct),
          workingState: { lowWaterMark: low },
        };
      }
      const high = Math.max(
        ctx.run.workingState.highWaterMark ?? entryPrice(ctx.trade),
        ctx.mark,
      );
      return {
        trigger: ctx.mark <= high * (1 - def.params.stopPct),
        workingState: { highWaterMark: high },
      };
    }
    case 'time-stop':
      return { trigger: ctx.daysHeld >= def.params.days };
    case 'limit-stddev':
      // Stubbed until StdDevLines lands: no level source → never fires.
      return { trigger: false };
    case 'ma-close': {
      const sma = ctx.indicators?.sma?.[def.params.period];
      // Never fire blind — absent indicator data skips the run.
      if (sma === undefined) return { trigger: false };
      return { trigger: isShort(ctx.trade) ? ctx.mark > sma : ctx.mark < sma };
    }
    case 'target': {
      const entry = entryPrice(ctx.trade);
      return {
        trigger: isShort(ctx.trade)
          ? ctx.mark <= entry * (1 - def.params.pct)
          : ctx.mark >= entry * (1 + def.params.pct),
      };
    }
  }
}

// ── Levels + closer classification (#1574) ──────────────────────────────────

/** Context shared by `variantLevel` and the governing selector — the
 *  subset of `VariantEvalCtx` a level computation needs. */
export interface VariantLevelCtx {
  trade: PaperTrade;
  mark: number;
  indicators?: { sma?: Record<number, number> };
}

/**
 * The rule's current stop/target price level — what the governing
 * selector compares across runs. Trailing levels ride the watermark
 * INCLUDING today's mark (same ratchet math as `evaluateVariant`).
 * `undefined` for non-price rules (time, stub, unparseable keys) — those
 * can never be governing candidates.
 */
export function variantLevel(
  run: VariantRun,
  ctx: VariantLevelCtx,
): number | undefined {
  const def = parseVariantKey(run.variantKey);
  if (!def) return undefined;
  const short = isShort(ctx.trade);
  const entry = entryPrice(ctx.trade);
  switch (def.family) {
    case 'initial-stop':
      return short
        ? entry * (1 + def.params.stopPct)
        : entry * (1 - def.params.stopPct);
    case 'trailing-stop': {
      if (short) {
        const low = Math.min(
          run.workingState.lowWaterMark ?? entry,
          ctx.mark,
        );
        return low * (1 + def.params.stopPct);
      }
      const high = Math.max(
        run.workingState.highWaterMark ?? entry,
        ctx.mark,
      );
      return high * (1 - def.params.stopPct);
    }
    case 'ma-close':
      return ctx.indicators?.sma?.[def.params.period];
    case 'target':
      return short
        ? entry * (1 - def.params.pct)
        : entry * (1 + def.params.pct);
    case 'time-stop':
    case 'limit-stddev':
      return undefined;
  }
}

/**
 * Families that close the trade independently of governing — `target-*`
 * (profit target) and `time-*` (days-held cap). Honored only on trades
 * carrying `governingPolicy`; unmarked trades keep the static
 * governing-only close rule (existing-trade regression pin).
 */
export function isIndependentCloser(variantKey: string): boolean {
  const def = parseVariantKey(variantKey);
  return def !== null && (def.family === 'target' || def.family === 'time-stop');
}
