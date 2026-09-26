/**
 * @topic #553 — Paper Trading Infra (task #565)
 *
 * Generalized paper-wide stats pass — one trade listing fans out to rollup
 * scopes across every dimension field on PaperTrade:
 *
 *   all                    — every trade
 *   inst-{instanceId}      — strategy instance
 *   var-{variantKey}       — per variant run (governing + shadows)
 *   cohort-{cohortId}      — signal cohort group
 *   sig-{signalId}         — originating signal
 *   sym-{SYMBOL}           — underlying symbol
 *
 * Each scope is recomputed from the positions-adapted trades via the shared
 * `recomputeStats` seam (equity-curve point + max drawdown + counts + P&L),
 * and per-scope failures are isolated — a bad scope doesn't lose the rest.
 *
 * This complements the engine's per-instance stats pass, which keeps
 * writing its LEGACY doc ids — `stats-{instanceId}` and `stats-ALL` —
 * because the existing strategy UI reads them. This pass owns the new
 * `stats-{all|inst-*|var-*|cohort-*|sig-*|sym-*}` namespace the paper
 * dashboard enumerates via `listStats`; `stats-ALL` vs `stats-all` and
 * `stats-{id}` vs `stats-inst-{id}` are deliberately distinct docs (same
 * underlying trades, both sides of the migration boundary).
 */

import {
  statsScopeAll,
  statsScopeCohort,
  statsScopeInstance,
  statsScopeSignal,
  statsScopeSymbol,
  statsScopeVariant,
} from '@paper-trading/ids';
import type { PaperTrade } from '@paper-trading/contracts';
import { db } from '../../firebase-admin-init';
import type { Position } from '../engine/types';
import { listTrades } from '../repository';
import { tradeToPosition } from '../engine/trade-adapter';
import {
  defaultStatsDeps,
  recomputeStats,
} from '../engine/stats-repository';
import { createLogger } from '../engine/logging';

const logger = createLogger('PaperStatsPass');

/** Every stats scope a trade rolls up into, keyed off its dimension fields. */
export function tradeScopes(trade: PaperTrade): string[] {
  const scopes = [statsScopeAll(), statsScopeSymbol(trade.symbol)];
  if (trade.strategyInstanceId) scopes.push(statsScopeInstance(trade.strategyInstanceId));
  if (trade.cohortId) scopes.push(statsScopeCohort(trade.cohortId));
  if (trade.signalId) scopes.push(statsScopeSignal(trade.signalId));
  for (const variantKey of trade.variantKeys) {
    scopes.push(statsScopeVariant(variantKey));
  }
  return scopes;
}

// ── Dependencies ──────────────────────────────────────────────────────────

export interface PaperStatsPassDeps {
  listTrades: () => Promise<PaperTrade[]>;
  recomputeStats: (
    scope: string,
    date: string,
    positions: Position[],
  ) => Promise<void>;
}

export interface PaperStatsPassResult {
  scopesWritten: string[];
  errors: string[];
}

/**
 * Recompute every populated scope. `all` is always written (even with zero
 * trades) so the dashboard's default scope doc always exists.
 */
export async function runPaperStatsPass(
  date: string,
  deps: PaperStatsPassDeps,
): Promise<PaperStatsPassResult> {
  const trades = await deps.listTrades();
  const byScope = new Map<string, PaperTrade[]>([[statsScopeAll(), []]]);
  for (const trade of trades) {
    for (const scope of tradeScopes(trade)) {
      const bucket = byScope.get(scope);
      if (bucket) bucket.push(trade);
      else byScope.set(scope, [trade]);
    }
  }

  const scopesWritten: string[] = [];
  const errors: string[] = [];
  for (const [scope, scoped] of byScope) {
    try {
      await deps.recomputeStats(scope, date, scoped.map(tradeToPosition));
      scopesWritten.push(scope);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`stats scope ${scope}: ${msg}`);
      errors.push(`${scope}: ${msg}`);
    }
  }
  return { scopesWritten, errors };
}

/** Production wiring — paper-trading repository + engine stats writer. */
export function createPaperStatsPassDeps(): PaperStatsPassDeps {
  return {
    listTrades: () => listTrades(db),
    recomputeStats: (scope, date, positions) =>
      recomputeStats(scope, date, positions, defaultStatsDeps),
  };
}
