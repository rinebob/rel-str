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
import { forkJoin, Subscription } from 'rxjs';
import { patchState, WritableStateSource } from '@ngrx/signals';
import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';

import type { OptionsContractService } from '../../services/options-contract.service';
import type { StSignalItem } from '../../services/types';
import type { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type { SwingAnalysisDoc } from '../../swing-analysis/swing-analysis.types';
import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';
import { chainContracts, closestPriorCloses, newId } from './utils/pct-change.utils';
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
  frameSetId(): string | null;
  frameSwing(): Swing | null;
  runs(): SwingCompareRun[];
  savedAnalyses(): SwingAnalysisDoc[];
  signals(): StSignalItem[];
  snapshotCache(): Record<string, HistoricalOptionContract[]>;
  underlyingPrices(): Record<string, number>;
  dateList(): SwingCompareDateItem[];
}

/** Minimal view of the store's state signals for the computeds. */
interface SwingCompareComputedInput {
  frameSetId(): string | null;
  extremesSetId(): string | null;
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

/** Computeds to spread into a `withComputed` block. */
export function swingCompareComputedBlock(state: SwingCompareComputedInput) {
  return {
    /** Swings of the selected frame set — the pickable frame choices. */
    frameSwings: computed((): Swing[] => {
      const id = state.frameSetId();
      if (!id) return [];
      return state.savedAnalyses().find((d) => d.id === id)?.swings ?? [];
    }),

    /**
     * Merged, sorted, labeled candidate dates: confirmed pivots from the
     * extremes set + signal barDates inside the selected frame swing's
     * [start, end], plus the frame start itself. Empty until a frame
     * swing is picked.
     */
    dateList: computed((): SwingCompareDateItem[] => {
      const swing = state.frameSwing();
      if (!swing) return [];
      const extremesDoc = state.savedAnalyses().find((d) => d.id === state.extremesSetId());
      return mergeDateList(
        extremesDoc?.pivots ?? [],
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
    /** Pick the set that supplies frame swings. Clears the selected
     *  swing and all runs — they were built against the old frame. */
    selectFrameSet(id: string | null): void {
      patchState(store, { frameSetId: id, frameSwing: null, runs: [] });
    },

    /** Pick the set that supplies target-date pivots. */
    selectExtremesSet(id: string | null): void {
      patchState(store, { extremesSetId: id });
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

      const sorted = [...missing].sort();
      const reqs = missing.map((d) =>
        deps.optionsContractService.getHistoricalOptionsChain$(symbol, d),
      );
      const bars$ = deps.barReadService.getDailyBarsForRange$(
        symbol,
        sorted[0],
        sorted[sorted.length - 1],
      );

      // Pre-create the container: mocks that emit synchronously fire `next`
      // during .subscribe(), so the sub must exist before then.
      const sub = new Subscription();
      deps.subs.add(sub);
      sub.add(
        forkJoin({ chains: forkJoin(reqs), bars: bars$ }).subscribe({
          next: ({ chains, bars }) => {
            deps.subs.delete(sub);
          missing.forEach((d) => deps.pending.delete(d));
          if (store.symbol().trim().toUpperCase() !== symbol) return;

            const snapshotCache = { ...store.snapshotCache() };
            missing.forEach((d, i) => {
              snapshotCache[d] = chainContracts(chains[i]);
            });
            const underlyingPrices = {
              ...store.underlyingPrices(),
              ...closestPriorCloses(bars, missing),
            };
            patchState(store, { snapshotCache, underlyingPrices });
          },
          error: (err: unknown) => {
            deps.subs.delete(sub);
            missing.forEach((d) => deps.pending.delete(d));
            console.error(`[PctChangeStore] ensureSnapshots failed for ${symbol}:`, err);
          },
        }),
      );
    },
  };
}
