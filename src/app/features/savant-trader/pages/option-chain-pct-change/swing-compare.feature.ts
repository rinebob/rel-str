/**
 * Swing-compare feature slice for OptionChainPctChangeStore — state
 * fragments live on the main store; this file owns the swing-compare
 * computeds and methods so the store file stays under the size guideline.
 *
 * The store spreads `swingCompareComputedBlock(state)` into a
 * `withComputed` and `swingCompareMethods(store, deps)` into
 * `withMethods`. `deps.pending`/`deps.subs` are shared with the main store
 * so `setSymbol`/`reset` can cancel in-flight snapshot fetches.
 */
import { computed } from '@angular/core';
import { catchError, forkJoin, from, map, mergeMap, of, Subscription, toArray } from 'rxjs';
import { patchState, WritableStateSource } from '@ngrx/signals';
import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';

import type { OptionsContractService } from '../../services/options-contract.service';
import type { StSignalItem } from '../../services/types';
import type { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type { SwingAnalysisDoc } from '../../swing-analysis/swing-analysis.types';
import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';
import { chainContracts, closestPriorCloses, newId, SNAPSHOT_FETCH_CONCURRENCY } from './utils/pct-change.utils';
import {
  mergeDateList,
  toUtcDateString,
  type SwingCompareDateItem,
  type SwingCompareRun,
} from './utils/swing-compare.utils';
import type { OptionChainPctChangeState } from './option-chain-pct-change.store';

/** The slice of store API the swing-compare block reads/writes. */
export interface SwingCompareStoreApi
  extends WritableStateSource<OptionChainPctChangeState> {
  symbol(): string;
  baselineSetId(): string | null;
  targetSetId(): string | null;
  frameSwing(): Swing | null;
  runs(): SwingCompareRun[];
  savedAnalyses(): SwingAnalysisDoc[];
  signals(): StSignalItem[];
  snapshotCache(): Record<string, HistoricalOptionContract[]>;
  snapshotErrors(): Record<string, string>;
  underlyingPrices(): Record<string, number>;
  dateList(): SwingCompareDateItem[];
}

/** Minimal view of the store's state signals for the computeds. */
interface SwingCompareComputedInput {
  baselineSetId(): string | null;
  targetSetId(): string | null;
  frameSwing(): Swing | null;
  savedAnalyses(): SwingAnalysisDoc[];
  signals(): StSignalItem[];
}

export interface SwingCompareDeps {
  optionsContractService: OptionsContractService;
  barReadService: LocalBarReadService;
  /** Dates with an in-flight fetch — cleared by setSymbol/reset. */
  pending: Set<string>;
  /** In-flight fetch subscriptions — cancelled by setSymbol/reset. */
  subs: Set<Subscription>;
}

/** Id→doc lookup helper for the computeds. */
function findDoc(
  docs: SwingAnalysisDoc[],
  id: string | null,
): SwingAnalysisDoc | null {
  return docs.find((d) => d.id === id) ?? null;
}

/** Computeds to spread into a `withComputed` block. */
export function swingCompareComputedBlock(state: SwingCompareComputedInput) {
  return {
    /** Baseline doc — the user-picked set whose large swings bound the
     *  frame (chosen in the frame-swing dialog). */
    baselineDoc: computed((): SwingAnalysisDoc | null =>
      findDoc(state.savedAnalyses(), state.baselineSetId()),
    ),

    /** Target doc — the user-picked set whose confirmed pivots become
     *  date-list items. */
    targetDoc: computed((): SwingAnalysisDoc | null =>
      findDoc(state.savedAnalyses(), state.targetSetId()),
    ),

    /** Target-set choices: saved analyses with a smaller devThreshold
     *  than the baseline. When nothing is finer (or no baseline picked),
     *  the baseline itself is the only choice — a single analysis can
     *  supply both roles (PRD US-1/US-2). */
    targetSetChoices: computed((): SwingAnalysisDoc[] => {
      const baseline = findDoc(state.savedAnalyses(), state.baselineSetId());
      if (!baseline) return [];
      const finer = state.savedAnalyses().filter(
        (d) => d.config.devThreshold < baseline.config.devThreshold,
      );
      return finer.length > 0 ? finer : [baseline];
    }),

    /** Swings of the baseline doc — the pickable frame choices. */
    frameSwings: computed((): Swing[] =>
      findDoc(state.savedAnalyses(), state.baselineSetId())?.swings ?? [],
    ),

    /**
     * Merged, sorted, labeled candidate dates: confirmed pivots from the
     * extremes set + signal barDates inside the selected frame swing's
     * [start, end], plus the frame start itself. Empty until a frame
     * swing is picked.
     */
    dateList: computed((): SwingCompareDateItem[] => {
      const swing = state.frameSwing();
      if (!swing) return [];
      const targetDoc = findDoc(state.savedAnalyses(), state.targetSetId());
      return mergeDateList(
        targetDoc?.pivots ?? [],
        state.signals(),
        toUtcDateString(swing.start.time),
        toUtcDateString(swing.end.time),
      );
    }),
  };
}

/** Methods to spread into the store's `withMethods` block. */
export function swingCompareMethods(store: SwingCompareStoreApi, deps: SwingCompareDeps) {
  return {
    /** Pick the baseline set (the dialog's 'Baseline Set' dropdown).
     *  Clears the selected swing and runs — they were built against the
     *  old frame. Also defaults the target set to the finest finer set,
     *  or the baseline itself when nothing is finer. */
    selectBaselineSet(id: string | null): void {
      const docs = store.savedAnalyses();
      const baseline = docs.find((d) => d.id === id) ?? null;
      const finer = baseline
        ? docs.filter((d) => d.config.devThreshold < baseline.config.devThreshold)
        : [];
      const target = finer.reduce(
        (min, d) => (d.config.devThreshold < min.config.devThreshold ? d : min),
        finer[0] ?? baseline,
      );
      patchState(store, {
        baselineSetId: id,
        frameSwing: null,
        runs: [],
        targetSetId: target?.id ?? null,
      });
    },

    /** Pick the target set (the results-side 'Target Set' dropdown) —
     *  its confirmed pivots feed the date list. */
    selectTargetSet(id: string | null): void {
      patchState(store, { targetSetId: id });
    },

    /** Pick the frame swing — its [start,end] bounds the date list.
     *  Clears runs built against the previous frame bounds. */
    selectFrameSwing(swing: Swing | null): void {
      patchState(store, { frameSwing: swing, runs: [] });
    },

    /** Candidate target dates strictly after the chosen start. */
    targetCandidates(startDate: string): SwingCompareDateItem[] {
      return store.dateList().filter((d) => d.date > startDate);
    },

    /** Save a run definition (start + targets + type). */
    addRun(startDate: string, targetDates: string[], type: OptionType): void {
      patchState(store, {
        runs: [...store.runs(), { id: newId(), startDate, targetDates: [...targetDates], type }],
      });
    },

    /** Remove a run by id. */
    removeRun(id: string): void {
      patchState(store, { runs: store.runs().filter((r) => r.id !== id) });
    },

    /**
     * Fill the shared snapshot cache for the given dates — fetches only
     * dates not already cached or in flight, then patches chain
     * snapshots + underlying closes in one shot. Tracked in `deps.subs`
     * so reset/symbol-change can cancel; late results are also dropped
     * when the symbol changed mid-flight. Failures only log — the date
     * stays missing and retries on the next call.
     */
    ensureSnapshots(dates: string[]): void {
      const symbol = store.symbol().trim().toUpperCase();
      if (!symbol) return;
      const cache = store.snapshotCache();
      const missing = dates
        .map((d) => String(d || '').trim())
        .filter((d) => d && !(d in cache) && !deps.pending.has(d));
      if (missing.length === 0) return;
      missing.forEach((d) => deps.pending.add(d));

      // Clear stale errors for the dates being (re)fetched — a retry
      // should flip the date back to a loading state, not sit on the old
      // message looking dead.
      if (missing.some((d) => d in store.snapshotErrors())) {
        const snapshotErrors = { ...store.snapshotErrors() };
        missing.forEach((d) => delete snapshotErrors[d]);
        patchState(store, { snapshotErrors });
      }

      const sorted = [...missing].sort();
      // Per-date catch — one upstream failure (a partner 502 on a date
      // with no vendor data) must not sink the batch. Results carry an
      // error string; failures land in `snapshotErrors` so the UI can
      // show "unavailable" instead of loading forever.
      //
      // Concurrency is capped (SNAPSHOT_FETCH_CONCURRENCY) — every call
      // is a live Alpha Vantage fetch upstream; 8 was fine for the 75
      // req/min rate limit but the partner rejects concurrent bursts
      // with fast 502s, so the window stays small.
      // Callable errors carry a `functions/<code>` — keep it in the
      // message so the UI can distinguish rate-limit (resource-exhausted)
      // from upstream gaps (unavailable) vs generic failures. The
      // partner's own {"code":"..."} gets extracted when present — the
      // raw JSON body is too noisy to render inline.
      const describeError = (err: unknown): string => {
        const code = (err as { code?: string })?.code?.replace('functions/', '');
        const msg = err instanceof Error ? err.message : String(err);
        const partnerCode = /"code"\s*:\s*"([^"]+)"/.exec(msg)?.[1];
        const detail = partnerCode ?? (msg.length > 120 ? `${msg.slice(0, 120)}…` : msg);
        return code ? `${code}: ${detail}` : detail;
      };
      const fetchOne = (d: string) =>
        deps.optionsContractService.getHistoricalOptionsChain$(symbol, d).pipe(
          map((r) => ({ date: d, contracts: chainContracts(r), error: null as string | null })),
          catchError((err: unknown) =>
            of({
              date: d,
              contracts: [] as HistoricalOptionContract[],
              error: describeError(err),
            }),
          ),
        );
      const results$ = from(missing).pipe(mergeMap(fetchOne, SNAPSHOT_FETCH_CONCURRENCY), toArray());
      // Bars are auxiliary (atm-diff display) — never sink the batch.
      const bars$ = deps.barReadService
        .getDailyBarsForRange$(symbol, sorted[0], sorted[sorted.length - 1])
        .pipe(catchError(() => of([])));

      // Pre-create the container: mocks that emit synchronously fire `next`
      // during .subscribe(), so the sub must exist before then.
      const sub = new Subscription();
      deps.subs.add(sub);
      sub.add(
        forkJoin({ results: results$, bars: bars$ }).subscribe({
          next: ({ results, bars }) => {
            deps.subs.delete(sub);
          missing.forEach((d) => deps.pending.delete(d));
          if (store.symbol().trim().toUpperCase() !== symbol) return;

            const snapshotCache = { ...store.snapshotCache() };
            const snapshotErrors = { ...store.snapshotErrors() };
            const okDates: string[] = [];
            for (const r of results) {
              if (r.error === null) {
                snapshotCache[r.date] = r.contracts;
                delete snapshotErrors[r.date];
                okDates.push(r.date);
              } else {
                snapshotErrors[r.date] = r.error;
              }
            }
            const underlyingPrices = {
              ...store.underlyingPrices(),
              ...closestPriorCloses(bars, okDates),
            };
            patchState(store, { snapshotCache, underlyingPrices, snapshotErrors });
          },
          error: (err: unknown) => {
            // Defensive — every inner stream is caught above, so this only
            // fires on a forkJoin-level failure (e.g. subscription bug).
            deps.subs.delete(sub);
            missing.forEach((d) => deps.pending.delete(d));
            const snapshotErrors = { ...store.snapshotErrors() };
            missing.forEach((d) => {
              snapshotErrors[d] = 'batch fetch failed';
            });
            patchState(store, { snapshotErrors });
            console.error(`[PctChangeStore] ensureSnapshots failed for ${symbol}:`, err);
          },
        }),
      );
    },
  };
}
