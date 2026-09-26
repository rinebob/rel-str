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
import type { PaperTrade, VariantRun } from '@paper-trading/contracts';

// ── Key parsing ─────────────────────────────────────────────────────────────

export type VariantDef =
  | { family: 'initial-stop'; params: { stopPct: number } }
  | { family: 'trailing-stop'; params: { stopPct: number } }
  | { family: 'time-stop'; params: { days: number } }
  | { family: 'limit-stddev'; params: { sigma: number } };

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
];

/** Parse a variantKey into its family + typed params; null when unknown. */
export function parseVariantKey(variantKey: string): VariantDef | null {
  for (const [re, build] of PATTERNS) {
    const m = variantKey.match(re);
    if (m) return build(m);
  }
  return null;
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
}

export interface VariantEvalResult {
  /** True when the variant's exit condition fired on this mark. */
  trigger: boolean;
  /** Persist on `run.workingState`; undefined = unchanged. */
  workingState?: Record<string, number>;
}

/** Entry fill price for the trade (0 when absent). */
function entryPrice(trade: PaperTrade): number {
  return trade.fills.find((f) => f.role === 'entry')?.price ?? 0;
}

function isShort(trade: PaperTrade): boolean {
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
  }
}
