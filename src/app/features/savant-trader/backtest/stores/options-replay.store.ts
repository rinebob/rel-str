/**
 * Options Replay Store
 *
 * NgRx SignalStore for the Selection Replay surface — replay runs,
 * their contract lists (1:1 per run, #1430), and analysis results, all
 * realtime and collection-scoped (row actions replace the selected-run
 * detail panel, #1471).
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
  ReplaySortBy,
  ReplaySortDirection,
  ReplayStatusFilter,
} from '../common/options-replay.types';
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';
import { OptionsAnalysisRunsService } from '../services/options-analysis-runs.service';

export interface OptionsReplayState {
  runs: OptionsReplayRunUi[];
  /** Every contract-list doc (1:1 with runs, #1430) — row actions
   *  (Analyze, View Contracts) read per-run state from the collection
   *  watch, no selection required (#1471 detail-panel removal). */
  contractLists: OptionsContractListUi[];
  isLoading: boolean;
  runsStreaming: boolean;
  statusFilter: ReplayStatusFilter;
  templateFilter: string;
  symbolSearch: string;
  sortBy: ReplaySortBy;
  sortDirection: ReplaySortDirection;
  /** Runs with an in-flight optionsReplayRetry call — runId → the
   *  pre-retry fingerprint `${status}|${updatedAtIso}` of the run doc.
   *  The runs listener prunes an entry once a snapshot shows a different
   *  fingerprint (or drops the run): that proves the retry landed while
   *  distinguishing a stale pre-retry 'failed' doc from a post-retry
   *  re-failure (which carries a fresh updatedAt). */
  retryingRuns: ReadonlyMap<string, string>;
  /** RunIds with an in-flight optionsReplayDelete call. The flag holds
   *  until the runs snapshot drops the doc (same snapshot-lag posture
   *  as retryingRuns) — a run still in the snapshot can be re-clicked. */
  deletingRunIds: ReadonlySet<string>;
  /** Analysis result docs across ALL runs — drives each row's
   *  Analyze → View Results flip (#1471 detail-panel removal). */
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
  contractLists: [],
  isLoading: false,
  runsStreaming: false,
  ...DEFAULT_REPLAY_FILTERS,
  sortBy: 'createdAt',
  sortDirection: 'desc',
  retryingRuns: new Map<string, string>(),
  deletingRunIds: new Set<string>(),
  analysisResults: [],
  analyzingListIds: new Set<string>(),
};

export const OptionsReplayStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => {
    /** One list row per run — runs are single-symbol (#1430) so a row IS
     *  a run; 'completed' maps to 'success' (the contract-list vocabulary
     *  the row presents). Local computed so filteredRows can chain off it
     *  (same-block computeds aren't on state). */
    const runRows = computed((): ReplayListRow[] => {
      return state.runs().map((run) => ({
        runId: run.runId,
        symbol: run.symbol,
        templateId: run.templateId,
        startDate: run.startDate,
        createdAtIso: run.createdAtIso,
        status: run.status === 'completed' ? 'success' : run.status,
      }));
    });

    return {
      /** The most recent run (Firestore query is ordered createdAt desc). */
      latestRun: computed(() => state.runs()[0] ?? null),

      /** listId → list doc — rows resolve their Analyze/View Contracts
       *  state through this (listId IS the runId, #1430). */
      contractListById: computed(
        () => new Map(state.contractLists().map((l) => [l.listId, l] as const)),
      ),

      runRows,

      /** runRows filtered by row status, template, and symbol search
       *  (case-insensitive substring), then sorted. */
      filteredRows: computed((): ReplayListRow[] => {
        const status = state.statusFilter();
        const template = state.templateFilter();
        const symbolSearch = state.symbolSearch().trim().toUpperCase();
        const sortBy = state.sortBy();
        const sortDirection = state.sortDirection();

        const filtered = runRows().filter((row) => {
          if (status !== 'all' && row.status !== status) return false;
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

      /** RunIds with an in-flight retry — the public Set view of the
       *  internal fingerprint map (component contract unchanged). */
      retryingRunIds: computed(() => new Set(state.retryingRuns().keys())),

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
      source: Observable<T>,
      onValue: (value: T) => void,
      fallback: T,
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
          return of<T>(fallback);
        }),
        takeUntilDestroyed(destroyRef),
      ).subscribe({
        next: (value: T) => {
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

    /** One-shot start of the collection-wide list + results streams —
     *  row actions read per-run state for EVERY row, so the watches are
     *  collection-scoped, not selection-scoped (#1471 detail-panel
     *  removal). Idempotent for live streams; a dead subscription
     *  (a stream error completes it via watchStream's catchError) is
     *  replaced, so the next loadRuns() revives row-action state after
     *  a transient listener failure. */
    function loadAuxStreams(): void {
      if (!listsSubscription || listsSubscription.closed) {
        listsSubscription = watchStream(
          'contract lists',
          runsService.watchContractLists(),
          (contractLists) => patchState(state, { contractLists }),
          [],
          {},
          {}
        );
      }

      if (!resultsSubscription || resultsSubscription.closed) {
        resultsSubscription = watchStream(
          'analysis results',
          analysisService.watchAllResultDocs(),
          (analysisResults) => {
            // A delivered doc proves the analysis call landed — prune
            // its in-flight flag so the row's action can flip to
            // View Results.
            const analyzing = state.analyzingListIds();
            if (analyzing.size === 0) {
              patchState(state, { analysisResults });
              return;
            }
            const docIds = new Set(analysisResults.map((d) => d.contractListDocId));
            const next = new Set([...analyzing].filter((id) => !docIds.has(id)));
            patchState(state, next.size === analyzing.size ? { analysisResults } : { analysisResults, analyzingListIds: next });
          },
          [],
          {},
          {}
        );
      }
    }

    return {
      /** Start a realtime listener for replay runs. Idempotent — but
       *  NOT a no-op when a stream died: aux streams run first so a
       *  closed lists/results subscription revives on re-entry (the
       *  runs guard below would otherwise skip the restart forever,
       *  leaving row actions frozen at the [] fallback), and a dead
       *  runs stream re-subscribes the same way. */
      loadRuns(): void {
        loadAuxStreams();
        if (runsSubscription && !runsSubscription.closed) return;

        runsSubscription = watchStream(
          'replay runs',
          runsService.watchRuns(50),
          (runs) => {
            const retrying = state.retryingRuns();
            const deleting = state.deletingRunIds();
            if (retrying.size === 0 && deleting.size === 0) {
              patchState(state, { runs });
              return;
            }
            // Snapshot is post-retry truth when the run's fingerprint
            // changed — the retry tx flips status→'running' and stamps a
            // fresh updatedAt, so ANY fingerprint change proves the retry
            // landed: a still-'failed' re-failure carries a new updatedAt
            // and prunes, while a stale pre-retry snapshot keeps the old
            // fingerprint and holds the flag (closing the re-click gap).
            // A run absent from the snapshot has nothing left to protect
            // — which is also the delete prune: the doc is gone.
            const byId = new Map(runs.map((r) => [r.runId, r] as const));
            const patch: Partial<OptionsReplayState> = { runs };
            if (retrying.size > 0) {
              const next = new Map(retrying);
              for (const [id, fingerprint] of retrying) {
                const run = byId.get(id);
                if (!run || `${run.status}|${run.updatedAtIso ?? ''}` !== fingerprint) {
                  next.delete(id);
                }
              }
              if (next.size !== retrying.size) patch.retryingRuns = next;
            }
            if (deleting.size > 0) {
              const next = new Set([...deleting].filter((id) => byId.has(id)));
              if (next.size !== deleting.size) patch.deletingRunIds = next;
            }
            patchState(state, patch);
          },
          [],
          { isLoading: true, runsStreaming: true },
          { isLoading: false, runsStreaming: false }
        );
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

      /** Start a new replay run — its row surfaces progress via the
       *  collection streams (no selection surface remains, #1471). */
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
              const count = response.runIds.length;
              toast.open(
                `Replay started: ${count} run${count === 1 ? '' : 's'}`,
                'Dismiss', { duration: 30000 }
              );
            }
          });
      },

      /** Re-run a failed run's contract list. The BE is already
       *  idempotent (no-ops on anything but 'failed'), so the local flag
       *  only covers the callable's in-flight window plus the snapshot
       *  lag — the run listener prunes it once the doc's fingerprint
       *  proves the retry landed. */
      retryRun(runId: string): void {
        if (state.retryingRuns().has(runId)) return;
        const run = state.runs().find((r) => r.runId === runId);
        const fingerprint = `${run?.status ?? ''}|${run?.updatedAtIso ?? ''}`;
        patchState(state, {
          retryingRuns: new Map(state.retryingRuns()).set(runId, fingerprint),
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
            if (!response || response.retriedSymbol === null) {
              const next = new Map(state.retryingRuns());
              next.delete(runId);
              patchState(state, { retryingRuns: next });
            }
            if (response) {
              toast.open(
                response.retriedSymbol !== null
                  ? `Retrying failed run for ${response.retriedSymbol}`
                  : 'Nothing to retry — the run is not failed',
                'Dismiss', { duration: 30000 }
              );
            }
          });
      },

      /** Cascade-delete a run + its contract list + analysis results.
       *  The callable is idempotent (missing docs count as deleted), so
       *  the flag only covers the call → snapshot window: it clears on
       *  error here, or when the runs listener sees the doc gone. */
      deleteRun(runId: string): void {
        if (state.deletingRunIds().has(runId)) return;
        const symbol = state.runs().find((r) => r.runId === runId)?.symbol;
        patchState(state, {
          deletingRunIds: new Set(state.deletingRunIds()).add(runId),
        });

        runsService
          .deleteRun(runId)
          .pipe(
            catchError((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error('[OptionsReplayStore] deleteRun failed', err);
              const message = buildReplayErrorMessage(err);
              toast.open(`Delete failed: ${message}`, 'Dismiss', { duration: 30000 });
              const next = new Set(state.deletingRunIds());
              next.delete(runId);
              patchState(state, { deletingRunIds: next });
              return of(null);
            }),
            takeUntilDestroyed(destroyRef)
          )
          .subscribe((response) => {
            if (!response) return;
            const cleaned = response.deletedLists + response.deletedResults;
            toast.open(
              response.deletedRun
                ? `Deleted run${symbol ? ` for ${symbol}` : ''}`
                : cleaned > 0
                  ? `Removed ${cleaned} leftover doc${cleaned === 1 ? '' : 's'} — the run was already gone`
                  : 'Nothing to delete — the run is already gone',
              'Dismiss', { duration: 30000 }
            );
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
