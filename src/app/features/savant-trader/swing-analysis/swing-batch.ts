/**
 * Swing batch sweep — the per-symbol pipeline for SwingAnalysisStore.runBatch.
 *
 * Extracted so the store method stays state plumbing: this module owns the
 * observable flow (bars → recompute → serial saves → per-symbol result).
 */

import { Observable, from, of, forkJoin } from 'rxjs';
import { concatMap, map, catchError, take, toArray } from 'rxjs/operators';

import type { ChartService } from '../services/chart.service';
import type { SwingAnalysisService } from './swing-analysis.service';
import { deriveParamsId } from './swing-analysis.types';
import type { SwingAnalysisInput } from './swing-analysis.types';
import type { ZigZagConfig, PriceBar, Pivot, Swing, SwingStats } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import {
  computeZigZagPivots,
  deriveSwings,
  computeSwingStats,
} from '../../shared/components/flex-chart/indicators/st-zigzag.engine';

/** Outcome for one swept symbol. `error` present only when ok is false —
 *  "failed" means at least one save failed; sibling saves may have landed. */
export interface BatchSymbolResult {
  symbol: string;
  ok: boolean;
  error?: string;
}

/** Parse a symbol list from free text — split on commas/whitespace/newlines,
 *  trim, uppercase, dedupe preserving order. */
export function parseSymbols(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[,\s]+/)) {
    const sym = raw.trim().toUpperCase();
    if (sym) seen.add(sym);
  }
  return [...seen];
}

interface RecomputedSet {
  config: ZigZagConfig;
  pivots: Pivot[];
  projection: Pivot | null;
  swings: Swing[];
  stats: SwingStats;
}

function recomputeForSave(bars: PriceBar[], config: ZigZagConfig): RecomputedSet | null {
  const { pivots, projection } = computeZigZagPivots(bars, config);
  const swings = deriveSwings(pivots, bars, projection);
  const stats = swings.length > 0 ? computeSwingStats(swings) : null;
  if (!stats) return null;
  return { config, pivots, projection: projection ?? null, swings, stats };
}

/**
 * Build the serial sweep: one emission per symbol with its result. Symbols
 * are processed via concatMap (strictly serial); per-symbol saves are also
 * serialized (concatMap + toArray) so configs land in order — a mid-symbol
 * save failure still leaves earlier docs persisted, reflected in the
 * result's error field.
 */
export function buildBatchSweep(
  chartService: ChartService,
  service: SwingAnalysisService,
  configs: ZigZagConfig[],
  symbols: string[],
): Observable<BatchSymbolResult> {
  return from(symbols).pipe(
    concatMap((symbol) =>
      chartService.loadBars$(symbol).pipe(
        take(1),
        concatMap((result) => {
          const bars = result.daily.bars;
          if (!bars || bars.length === 0) {
            throw new Error('no bars returned');
          }
          const savable = configs
            .map((config) => recomputeForSave(bars, config))
            .filter((r): r is RecomputedSet => r != null);
          if (savable.length === 0) {
            throw new Error('no swings detected');
          }
          const savedAt = new Date().toISOString();
          return from(savable).pipe(
            concatMap((s) => {
              const input: SwingAnalysisInput = {
                symbol,
                paramsId: deriveParamsId(s.config),
                config: s.config,
                pivots: s.pivots,
                projection: s.projection,
                swings: s.swings,
                stats: s.stats,
                savedAt,
              };
              return service.saveAnalysis(input);
            }),
            toArray(),
          );
        }),
        map(() => ({ symbol, ok: true as const })),
        catchError((err: unknown) =>
          of({
            symbol,
            ok: false as const,
            error: err instanceof Error ? err.message : String(err),
          }),
        ),
      ),
    ),
  );
}
