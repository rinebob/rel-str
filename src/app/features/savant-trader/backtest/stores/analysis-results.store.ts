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
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';
import {
  EXIT_REGISTRY_VERSION,
  EXIT_STRATEGIES,
  getExitStrategy,
} from '@options-analysis/registry';
import { getReplayTemplate } from '@options-replay/templates';
import { winLossOf, tradeRowMetrics } from '../utils/analysis-results-metrics.util';
import type { TradeRowMetrics } from '../utils/analysis-results-metrics.util';
import type {
  AnalysisOutcome,
  AnalysisResultDoc,
  AnalysisResultStatus,
  AnalysisTradeRecord,
  ExitTypeAggregate,
} from '@options-analysis/contracts';
import type { OptionsReplayRunUi } from '../common/options-replay.types';

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
  /** Wins/losses over resolved records under the doc's template side —
   *  null when the template is unregistered or the doc isn't success. */
  winsLosses: { wins: number; losses: number } | null;
}

/** One event-table row — a trade record + the exit it was evaluated
 *  under, with display metrics derived once in the store (the component
 *  stays a dumb view; no per-cell outcome narrowing in the template). */
export interface EventRow extends TradeRowMetrics {
  key: string;
  exitId: string;
  exitLabel: string;
  record: AnalysisTradeRecord;
  /** Doc written under a different EXIT_REGISTRY_VERSION. */
  stale: boolean;
}

export type ExitFilter = 'all' | string;
export type OutcomeFilter = 'all' | AnalysisOutcome;

interface AnalysisResultsState {
  docs: AnalysisResultDoc[];
  /** First emission received — separates loading from empty. */
  loaded: boolean;
  streamError: string | null;
  exitFilter: ExitFilter;
  /** #1431 item 9 — outcome chips (Exit / Expired / Open / Error) AND'd
   *  with the exit-type filter. */
  outcomeFilter: OutcomeFilter;
  /** The run doc (same docId as the list under #1430) — supplies the
   *  header's startDate; null while unloaded or when the doc is absent. */
  runDoc: OptionsReplayRunUi | null;
}

const initialState: AnalysisResultsState = {
  docs: [],
  loaded: false,
  streamError: null,
  exitFilter: 'all',
  outcomeFilter: 'all',
  runDoc: null,
};

const exitLabel = (exitId: string): string => getExitStrategy(exitId)?.label ?? exitId;

/** Registry order is static — sort once, not per recompute. */
const SORTED_STRATEGIES = [...EXIT_STRATEGIES].sort((a, b) => a.order - b.order);

export const AnalysisResultsStore = signalStore(
  withState(initialState),

  withComputed(({ docs, loaded, streamError, exitFilter, outcomeFilter, runDoc }) => ({
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
          winsLosses:
            doc?.status === 'success'
              ? winLossOf(doc.trades, getReplayTemplate(doc.templateId)?.side)
              : null,
        };
      });
    }),

    /** Header fields (#1431 items 4–5) — contractCount is uniform across
     *  docs; the template name + startDate resolve via the registry and
     *  the run doc (same docId under #1430). */
    positionCount: computed(
      () =>
        docs().find((d) => d.status === 'success')?.aggregate.contractCount ??
        null,
    ),
    templateName: computed(() => {
      const id = docs()[0]?.templateId;
      return id ? (getReplayTemplate(id)?.name ?? id) : '';
    }),
    startDate: computed(() => runDoc()?.startDate ?? ''),

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
          winsLosses: null,
        })),
    ),

    eventRows: computed<EventRow[]>(() => {
      const filter = exitFilter();
      const outcome = outcomeFilter();
      const rows: EventRow[] = [];
      for (const doc of docs()) {
        if (doc.status !== 'success') continue;
        if (filter !== 'all' && doc.exitId !== filter) continue;
        // Unregistered exitIds (removed strategies) have no aggregate row
        // or filter chip — exclude them rather than render orphan events.
        if (!getExitStrategy(doc.exitId)) continue;
        const side = getReplayTemplate(doc.templateId)?.side;
        for (const record of doc.trades) {
          if (outcome !== 'all' && record.outcome !== outcome) continue;
          rows.push({
            key: `${doc.exitId}|${record.pickDate}|${record.contractId}`,
            exitId: doc.exitId,
            exitLabel: exitLabel(doc.exitId),
            record,
            stale: doc.registryVersion !== EXIT_REGISTRY_VERSION,
            ...tradeRowMetrics(record, side),
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

  withMethods((store, service = inject(OptionsAnalysisRunsService), runsService = inject(OptionsReplayRunsService)) => {
    const destroyRef = inject(DestroyRef);
    // takeUntilDestroyed covers teardown; docsSub/runSub track the live
    // subscriptions so watchList can swap them before re-subscribing.
    let docsSub: Subscription | null = null;
    let runSub: Subscription | null = null;

    return {
      /** (Re)bind the stream to a listDocId — resets state so a stale
       *  emission from the prior list can't leak into the new view. The
       *  run doc shares the list's docId under #1430 (startDate header). */
      watchList(contractListDocId: string): void {
        docsSub?.unsubscribe();
        runSub?.unsubscribe();
        patchState(store, {
          docs: [],
          loaded: false,
          streamError: null,
          exitFilter: 'all',
          outcomeFilter: 'all',
          runDoc: null,
        });
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
        runSub = runsService
          .watchRunDoc(contractListDocId)
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (runDoc) => patchState(store, { runDoc }),
            // A missing/failed run-doc read never blocks the page —
            // startDate just stays empty.
            error: () => patchState(store, { runDoc: null }),
          });
      },

      setExitFilter(filter: ExitFilter): void {
        patchState(store, { exitFilter: filter });
      },

      setOutcomeFilter(filter: OutcomeFilter): void {
        patchState(store, { outcomeFilter: filter });
      },
    };
  }),
);
