/**
 * Options Replay Store
 *
 * NgRx SignalStore for the Selection Replay surface — replay runs,
 * the selected run, and its per-symbol contract lists, all realtime.
 * Deliberately separate from BacktestRunStore: the replay namespace is
 * a different data model (pick-doc selections, not sim trades).
 */
import { inject, computed, DestroyRef } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of, catchError, Subscription, Observable } from 'rxjs';
import { DsToastService } from '../../../../shared/ds/ds-toast.service';

import type { OptionsReplayStartRequest } from '@options-replay/contracts';
import type { AnalysisResultDoc } from '@options-analysis/contracts';
import type {
  OptionsContractListUi,
  OptionsReplayRunUi,
  ReplayListRow,
  ReplaySelection,
  ReplaySortBy,
  ReplaySortDirection,
  ReplayStatusFilter,
} from '../common/options-replay.types';
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';
import { OptionsAnalysisRunsService } from '../services/options-analysis-runs.service';

export interface OptionsReplayState {
  runs: OptionsReplayRunUi[];
  /** One selection object — runId always set, symbol only for row-level
   *  selection. selectedRunId/selectedSymbol derive from it so the pair
   *  can never drift apart. */
  selection: ReplaySelection | null;
  contractLists: OptionsContractListUi[];
  isLoading: boolean;
  runsStreaming: boolean;
  listsStreaming: boolean;
  statusFilter: ReplayStatusFilter;
  templateFilter: string;
  symbolSearch: string;
  sortBy: ReplaySortBy;
  sortDirection: ReplaySortDirection;
  /** Runs with an in-flight optionsReplayRetry call — guards the rerun
   *  action's double-click window; the runs listener prunes it once the
   *  snapshot proves the retry landed (status 'running' or failed
   *  outcomes gone). */
  retryingRunIds: ReadonlySet<string>;
  /** Analysis result docs for the selected run — drives the
   *  Analyze → View Results flip on each contract-list card. */
  analysisResults: AnalysisResultDoc[];
  /** Contract lists with an in-flight optionsAnalysisStart call — the
   *  results listener prunes the flag once a doc for that list exists. */
  analyzingListIds: ReadonlySet<string>;
}

function buildReplayErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const details = (err as { details?: unknown }).details;
    if (details) {
      const detailText = typeof details === 'string' ? details : JSON.stringify(details);
      return `${err.message} — ${detailText}`;
    }
    return err.message;
  }
  return String(err ?? 'Unknown error');
}

/** Filter defaults — single source for initialState and resetFilters;
 *  hasActiveFilters compares against the two 'all' fields and checks
 *  symbolSearch emptiness directly (sort is not a filter). */
const DEFAULT_REPLAY_FILTERS = {
  statusFilter: 'all',
  templateFilter: 'all',
  symbolSearch: '',
} as const;

const initialState: OptionsReplayState = {
  runs: [],
  selection: null,
  contractLists: [],
  isLoading: false,
  runsStreaming: false,
  listsStreaming: false,
  ...DEFAULT_REPLAY_FILTERS,
  sortBy: 'createdAt',
  sortDirection: 'desc',
  retryingRunIds: new Set<string>(),
  analysisResults: [],
  analyzingListIds: new Set<string>(),
};

export const OptionsReplayStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => {
    /** One list row per (runId, symbol) — a run's symbol set fans out into
     *  rows; symbol status comes from listOutcomes with 'pending' when the
     *  run doc hasn't recorded an outcome for that symbol. Local computed so
     *  filteredRows can chain off it (same-block computeds aren't on state). */
    const runRows = computed((): ReplayListRow[] => {
      return state.runs().flatMap((run) =>
        run.symbols.map((symbol) => ({
          runId: run.runId,
          symbol,
          templateId: run.templateId,
          startDate: run.startDate,
          createdAtIso: run.createdAtIso,
          runStatus: run.status,
          symbolStatus: run.listOutcomes?.[symbol] ?? 'pending',
          completedLists: run.completedLists,
          failedLists: run.failedLists,
          totalLists: run.totalLists,
        }))
      );
    });

    return {
      /** Selected run id / symbol — derived views of the single selection
       *  object (see OptionsReplayState.selection). */
      selectedRunId: computed(() => state.selection()?.runId ?? null),
      selectedSymbol: computed(() => state.selection()?.symbol ?? null),

      /** The currently selected run, if any. */
      selectedRun: computed(() => {
        const id = state.selection()?.runId;
        return id ? state.runs().find((r) => r.runId === id) ?? null : null;
      }),

      /** The most recent run (Firestore query is ordered createdAt desc). */
      latestRun: computed(() => state.runs()[0] ?? null),

      runRows,

      /** runRows filtered by symbol status, template, and symbol search
       *  (case-insensitive substring), then sorted. */
      filteredRows: computed((): ReplayListRow[] => {
        const status = state.statusFilter();
        const template = state.templateFilter();
        const symbolSearch = state.symbolSearch().trim().toUpperCase();
        const sortBy = state.sortBy();
        const sortDirection = state.sortDirection();

        const filtered = runRows().filter((row) => {
          if (status !== 'all' && row.symbolStatus !== status) return false;
          if (template !== 'all' && row.templateId !== template) return false;
          if (symbolSearch && !row.symbol.toUpperCase().includes(symbolSearch)) return false;
          return true;
        });

        return filtered.sort((a, b) => {
          let cmp = 0;
          if (sortBy === 'createdAt') {
            // ISO strings compare lexicographically — also NaN-proof for
            // sparse docs whose createdAtIso is ''.
            cmp = a.createdAtIso.localeCompare(b.createdAtIso);
          } else if (sortBy === 'startDate') {
            cmp = a.startDate.localeCompare(b.startDate);
          } else if (sortBy === 'symbol') {
            cmp = a.symbol.localeCompare(b.symbol);
          }
          return sortDirection === 'asc' ? cmp : -cmp;
        });
      }),

      /** Contract-list docIds carrying ≥1 SUCCESS analysis result doc —
       *  flips the card's Analyze button to View Results. Failed docs are
       *  excluded on purpose: a failed analysis has nothing to view, and
       *  leaving Analyze enabled keeps the card's only re-run affordance
       *  (the callable is idempotent). */
      analysisReadyListIds: computed(() =>
        new Set(
          state.analysisResults()
            .filter((d) => d.status === 'success')
            .map((d) => d.contractListDocId)
        )
      ),

      /** True when any non-default filter is active. */
      hasActiveFilters: computed(() => {
        return (
          state.statusFilter() !== DEFAULT_REPLAY_FILTERS.statusFilter ||
          state.templateFilter() !== DEFAULT_REPLAY_FILTERS.templateFilter ||
          state.symbolSearch().trim().length > 0
        );
      }),
    };
  }),

  withMethods((state, runsService = inject(OptionsReplayRunsService), analysisService = inject(OptionsAnalysisRunsService), toast = inject(DsToastService), destroyRef = inject(DestroyRef)) => {
    let runsSubscription: Subscription | null = null;
    let listsSubscription: Subscription | null = null;
    let resultsSubscription: Subscription | null = null;

    function watchStream<T>(
      label: string,
      source: Observable<T[]>,
      onValue: (value: T[]) => void,
      startPatch: Partial<OptionsReplayState>,
      stopPatch: Partial<OptionsReplayState>
    ): Subscription {
      patchState(state, startPatch);

      return source.pipe(
        catchError((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[OptionsReplayStore] Failed to stream ${label}`, err);
          const message = buildReplayErrorMessage(err);
          toast.open(`Failed to stream ${label}: ${message}`, 'Dismiss', { duration: 30000 });
          return of<T[]>([]);
        }),
        takeUntilDestroyed(destroyRef),
      ).subscribe({
        next: (value: T[]) => {
          onValue(value);
          patchState(state, stopPatch);
        },
        error: () => {
          patchState(state, stopPatch);
        },
        complete: () => {
          patchState(state, stopPatch);
        },
      });
    }

    function loadRunStreams(runId: string | null): void {
      listsSubscription?.unsubscribe();
      listsSubscription = null;
      resultsSubscription?.unsubscribe();
      resultsSubscription = null;
      if (!runId) {
        patchState(state, {
          contractLists: [],
          listsStreaming: false,
          analysisResults: [],
          analyzingListIds: new Set<string>(),
        });
        return;
      }

      listsSubscription = watchStream(
        'contract lists',
        runsService.watchContractLists(runId),
        (contractLists) => patchState(state, { contractLists }),
        // Clear up front — otherwise the new run's cards briefly join
        // against the previous run's lists until the first snapshot.
        { contractLists: [], listsStreaming: true },
        { listsStreaming: false }
      );

      resultsSubscription = watchStream(
        'analysis results',
        analysisService.watchResultDocs(runId),
        (analysisResults) => {
          // A delivered doc proves the analysis call landed — prune its
          // in-flight flag so the card's action can flip to View Results.
          const analyzing = state.analyzingListIds();
          if (analyzing.size === 0) {
            patchState(state, { analysisResults });
            return;
          }
          const docIds = new Set(analysisResults.map((d) => d.contractListDocId));
          const next = new Set([...analyzing].filter((id) => !docIds.has(id)));
          patchState(state, next.size === analyzing.size ? { analysisResults } : { analysisResults, analyzingListIds: next });
        },
        // Same run-scoped reset — stale docs from the previous run must
        // not mark its cards ready; in-flight flags belong to the old
        // run's stream and never resolve from the new one.
        { analysisResults: [], analyzingListIds: new Set<string>() },
        {}
      );
    }

    function applyRunSelection(runId: string | null): void {
      patchState(state, { selection: runId ? { runId, symbol: null } : null });
      loadRunStreams(runId);
    }

    return {
      /** Start a realtime listener for replay runs. Idempotent. */
      loadRuns(): void {
        if (runsSubscription) return;

        runsSubscription = watchStream(
          'replay runs',
          runsService.watchRuns(50),
          (runs) => {
            const retrying = state.retryingRunIds();
            if (retrying.size === 0) {
              patchState(state, { runs });
              return;
            }
            // Snapshot is post-retry truth: the retry tx flips
            // status→'running' in the same commit that deletes the failed
            // outcomes, so either signal proves the retry landed even if
            // Firestore coalescing skipped the clean post-tx state — e.g.
            // a retried symbol re-failing fast would otherwise leave every
            // delivered snapshot with a failed outcome and strand the flag
            // forever. A run absent from the snapshot has nothing left to
            // protect. A run still 'completed'/'failed' WITH a failed
            // outcome keeps the flag — that closes the re-click gap while
            // the stale pre-retry doc is still streaming.
            const byId = new Map(runs.map((r) => [r.runId, r] as const));
            const next = new Set(retrying);
            for (const id of retrying) {
              const run = byId.get(id);
              const hasFailedOutcome = run
                ? Object.values(run.listOutcomes ?? {}).some((s) => s === 'failed')
                : false;
              if (!run || run.status === 'running' || !hasFailedOutcome) next.delete(id);
            }
            patchState(state, next.size === retrying.size ? { runs } : { runs, retryingRunIds: next });
          },
          { isLoading: true, runsStreaming: true },
          { isLoading: false, runsStreaming: false }
        );
      },

      /** Select a run for the detail panel and start streaming its
       *  contract lists + analysis result docs. */
      selectRun(runId: string | null): void {
        applyRunSelection(runId);
      },

      /** Select a (runId, symbol) row — the detail panel auto-expands that
       *  symbol's contract-list card. Same-run symbol hops keep the
       *  existing list stream unless it died on an earlier error. */
      selectRow(selection: ReplaySelection): void {
        // Both run-scoped streams restart together — a dead results stream
        // with a live lists stream must still trigger the restart or the
        // cards silently lose View Results updates for the session.
        const streamDead =
          !listsSubscription || listsSubscription.closed ||
          !resultsSubscription || resultsSubscription.closed;
        const isNewRun = state.selection()?.runId !== selection.runId;
        patchState(state, { selection });
        if (isNewRun || streamDead) loadRunStreams(selection.runId);
      },

      setStatusFilter(filter: ReplayStatusFilter): void {
        patchState(state, { statusFilter: filter });
      },
      setTemplateFilter(filter: string): void {
        patchState(state, { templateFilter: filter });
      },
      setSymbolSearch(search: string): void {
        patchState(state, { symbolSearch: search });
      },
      setSortBy(sortBy: ReplaySortBy): void {
        patchState(state, { sortBy });
      },
      setSortDirection(direction: ReplaySortDirection): void {
        patchState(state, { sortDirection: direction });
      },
      resetFilters(): void {
        patchState(state, { ...DEFAULT_REPLAY_FILTERS });
      },

      /** Start a new replay run; on success select it so the detail panel shows progress. */
      startReplay(request: OptionsReplayStartRequest): void {
        patchState(state, { isLoading: true });

        runsService
          .startReplay(request)
          .pipe(
            catchError((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[OptionsReplayStore] startReplay failed', err);
              const message = buildReplayErrorMessage(err);
              toast.open(`Failed to start replay: ${message}`, 'Dismiss', { duration: 30000 });
              patchState(state, { isLoading: false });
              return of(null);
            }),
            takeUntilDestroyed(destroyRef)
          )
          .subscribe((response) => {
            patchState(state, { isLoading: false });
            if (response) {
              toast.open(`Replay started: ${response.runId}`, 'Dismiss', { duration: 30000 });
              applyRunSelection(response.runId);
            }
          });
      },

      /** Re-run a run's failed symbol list docs. The BE is already
       *  idempotent (no-ops on pending/running/cancelled and on empty
       *  failed sets), so the local flag only covers the callable's
       *  in-flight window plus the snapshot lag — the run listener prunes
       *  it once the doc's failed outcomes are gone, which also flips the
       *  doc back to 'running' and hides the row's rerun button. */
      retryRun(runId: string): void {
        if (state.retryingRunIds().has(runId)) return;
        patchState(state, {
          retryingRunIds: new Set(state.retryingRunIds()).add(runId),
        });

        runsService
          .retryRun(runId)
          .pipe(
            catchError((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[OptionsReplayStore] retryRun failed', err);
              const message = buildReplayErrorMessage(err);
              toast.open(`Retry failed: ${message}`, 'Dismiss', { duration: 30000 });
              return of(null);
            }),
            takeUntilDestroyed(destroyRef)
          )
          .subscribe((response) => {
            // Clear here only when no doc change is coming — a call error
            // or a no-op response. On a real retry the flag holds until
            // the runs snapshot confirms the post-retry state, closing
            // the re-click gap (see loadRuns' prune above).
            if (!response || response.retriedSymbols.length === 0) {
              const next = new Set(state.retryingRunIds());
              next.delete(runId);
              patchState(state, { retryingRunIds: next });
            }
            if (response) {
              const retried = response.retriedSymbols;
              toast.open(
                retried.length > 0
                  ? `Retrying ${retried.length} failed symbol${retried.length === 1 ? '' : 's'}: ${retried.join(', ')}`
                  : 'Nothing to retry — no failed symbols',
                'Dismiss', { duration: 30000 }
              );
            }
          });
      },

      /** Kick off analysis of one contract list. The callable is
       *  idempotent (re-invocation re-enqueues and overwrites the same
       *  result docs), so the flag only covers the callable → first-doc
       *  window — the results stream prunes it once a doc for the list
       *  exists, which flips the card's action to View Results. */
      startAnalysis(contractListDocId: string): void {
        if (state.analyzingListIds().has(contractListDocId)) return;
        patchState(state, {
          analyzingListIds: new Set(state.analyzingListIds()).add(contractListDocId),
        });

        analysisService
          .startAnalysis(contractListDocId)
          .pipe(
            catchError((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[OptionsReplayStore] startAnalysis failed', err);
              const message = buildReplayErrorMessage(err);
              toast.open(`Analysis failed to start: ${message}`, 'Dismiss', { duration: 30000 });
              const next = new Set(state.analyzingListIds());
              next.delete(contractListDocId);
              patchState(state, { analyzingListIds: next });
              return of(null);
            }),
            takeUntilDestroyed(destroyRef)
          )
          .subscribe((response) => {
            if (response) {
              toast.open(`Analysis started: ${contractListDocId}`, 'Dismiss', { duration: 30000 });
            }
          });
      },
    };
  })
);
