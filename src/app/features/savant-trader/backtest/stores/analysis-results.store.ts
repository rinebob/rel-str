/**
 * Analysis results store (Topic #1238, task #1377).
 *
 * Page-scoped lifecycle for the backtest-analysis-results route: streams
 * `st-options-analysis-results` docs for one `contractListDocId` (one doc
 * per exit type) and derives the two render surfaces —
 *
 * - `aggregateRows`: one row per registered exit strategy, in registry
 *   `order`, joined to its result doc (missing docs → 'missing' status so
 *   the table always shows the full comparison matrix),
 * - `eventRows`: per-contract trade records flattened across docs with a
 *   registry label, narrowed by the exit-type filter chip.
 *
 * Page-scoped (not `providedIn: 'root'`) because the lifecycle is keyed on
 * the route param — the replay store's run-scoped stream can't serve a
 * deep link that has no selected run.
 */
import { computed, inject, DestroyRef } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';

import { OptionsAnalysisRunsService } from '../services/options-analysis-runs.service';
import {
  EXIT_REGISTRY_VERSION,
  EXIT_STRATEGIES,
  getExitStrategy,
} from '@options-analysis/registry';
import type {
  AnalysisResultDoc,
  AnalysisResultStatus,
  AnalysisTradeRecord,
  ExitTypeAggregate,
} from '@options-analysis/contracts';

/** One aggregate-table row — registry strategy joined to its result doc. */
export interface AggregateRow {
  exitId: string;
  label: string;
  status: AnalysisResultStatus | 'missing';
  aggregate: ExitTypeAggregate | null;
  /** Worker failure reason on status 'failed'. */
  error?: string;
  /** Doc was written under a different EXIT_REGISTRY_VERSION — results
   *  predate a registry change; re-run Analyze to refresh. */
  stale: boolean;
}

/** One event-table row — a trade record + the exit it was evaluated under. */
export interface EventRow {
  key: string;
  exitId: string;
  exitLabel: string;
  record: AnalysisTradeRecord;
  /** Doc written under a different EXIT_REGISTRY_VERSION. */
  stale: boolean;
}

export type ExitFilter = 'all' | string;

interface AnalysisResultsState {
  docs: AnalysisResultDoc[];
  /** First emission received — separates loading from empty. */
  loaded: boolean;
  streamError: string | null;
  exitFilter: ExitFilter;
}

const initialState: AnalysisResultsState = {
  docs: [],
  loaded: false,
  streamError: null,
  exitFilter: 'all',
};

const exitLabel = (exitId: string): string => getExitStrategy(exitId)?.label ?? exitId;

/** Registry order is static — sort once, not per recompute. */
const SORTED_STRATEGIES = [...EXIT_STRATEGIES].sort((a, b) => a.order - b.order);

export const AnalysisResultsStore = signalStore(
  withState(initialState),

  withComputed(({ docs, loaded, streamError, exitFilter }) => ({
    loading: computed(() => !loaded() && !streamError()),
    empty: computed(() => loaded() && docs().length === 0),

    /** Latest generatedAt across docs — the header's "Analyzed" stamp.
     *  ISO timestamps sort lexicographically. */
    analyzedAt: computed(() =>
      docs()
        .map((d) => d.generatedAt)
        .filter(Boolean)
        .sort()
        .pop() ?? '',
    ),

    /** Registry order → table order; docs join by exitId. */
    aggregateRows: computed<AggregateRow[]>(() => {
      const byExit = new Map(docs().map((d) => [d.exitId, d]));
      return SORTED_STRATEGIES.map((s) => {
        const doc = byExit.get(s.exitId);
        return {
          exitId: s.exitId,
          label: s.label,
          status: doc?.status ?? 'missing',
          aggregate: doc?.status === 'success' ? doc.aggregate : null,
          error: doc?.status === 'failed' ? doc.error : undefined,
          stale: !!doc && doc.registryVersion !== EXIT_REGISTRY_VERSION,
        };
      });
    }),

    /** Docs that failed — the banner names them; siblings still render.
     *  Deliberately derived from docs() (not aggregateRows) so a failed
     *  doc whose exitId is no longer registered still surfaces. */
    failedRows: computed<AggregateRow[]>(() =>
      docs()
        .filter((d) => d.status === 'failed')
        .map((d) => ({
          exitId: d.exitId,
          label: exitLabel(d.exitId),
          status: 'failed' as const,
          aggregate: null,
          error: d.error,
          stale: d.registryVersion !== EXIT_REGISTRY_VERSION,
        })),
    ),

    eventRows: computed<EventRow[]>(() => {
      const filter = exitFilter();
      const rows: EventRow[] = [];
      for (const doc of docs()) {
        if (doc.status !== 'success') continue;
        if (filter !== 'all' && doc.exitId !== filter) continue;
        // Unregistered exitIds (removed strategies) have no aggregate row
        // or filter chip — exclude them rather than render orphan events.
        if (!getExitStrategy(doc.exitId)) continue;
        for (const record of doc.trades) {
          rows.push({
            key: `${doc.exitId}|${record.pickDate}|${record.contractId}`,
            exitId: doc.exitId,
            exitLabel: exitLabel(doc.exitId),
            record,
            stale: doc.registryVersion !== EXIT_REGISTRY_VERSION,
          });
        }
      }
      return rows.sort(
        (a, b) =>
          a.record.pickDate.localeCompare(b.record.pickDate) ||
          a.record.contractId.localeCompare(b.record.contractId),
      );
    }),
  })),

  withMethods((store, service = inject(OptionsAnalysisRunsService)) => {
    const destroyRef = inject(DestroyRef);
    // takeUntilDestroyed covers teardown; docsSub tracks the live
    // subscription so watchList can swap it before re-subscribing.
    let docsSub: Subscription | null = null;

    return {
      /** (Re)bind the stream to a listDocId — resets state so a stale
       *  emission from the prior list can't leak into the new view. */
      watchList(contractListDocId: string): void {
        docsSub?.unsubscribe();
        patchState(store, { docs: [], loaded: false, streamError: null, exitFilter: 'all' });
        docsSub = service
          .watchListResultDocs(contractListDocId)
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (docs) => patchState(store, { docs, loaded: true }),
            error: (err: unknown) =>
              patchState(store, {
                streamError: err instanceof Error ? err.message : String(err),
              }),
          });
      },

      setExitFilter(filter: ExitFilter): void {
        patchState(store, { exitFilter: filter });
      },
    };
  }),
);
