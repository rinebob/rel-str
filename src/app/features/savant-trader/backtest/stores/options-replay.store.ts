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
import { MatSnackBar } from '@angular/material/snack-bar';

import type { OptionsReplayStartRequest } from '@options-replay/contracts';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../common/options-replay.types';
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';

export interface OptionsReplayState {
  runs: OptionsReplayRunUi[];
  selectedRunId: string | null;
  contractLists: OptionsContractListUi[];
  isLoading: boolean;
  runsStreaming: boolean;
  listsStreaming: boolean;
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

const initialState: OptionsReplayState = {
  runs: [],
  selectedRunId: null,
  contractLists: [],
  isLoading: false,
  runsStreaming: false,
  listsStreaming: false,
};

export const OptionsReplayStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    /** The currently selected run, if any. */
    selectedRun: computed(() => {
      const id = state.selectedRunId();
      return id ? state.runs().find((r) => r.runId === id) ?? null : null;
    }),

    /** The most recent run (Firestore query is ordered createdAt desc). */
    latestRun: computed(() => state.runs()[0] ?? null),
  })),

  withMethods((state, runsService = inject(OptionsReplayRunsService), snackBar = inject(MatSnackBar), destroyRef = inject(DestroyRef)) => {
    let runsSubscription: Subscription | null = null;
    let listsSubscription: Subscription | null = null;

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
          snackBar.open(`Failed to stream ${label}: ${message}`, 'Dismiss', { duration: 30000 });
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

    function loadContractLists(runId: string | null): void {
      listsSubscription?.unsubscribe();
      listsSubscription = null;
      if (!runId) {
        patchState(state, { contractLists: [], listsStreaming: false });
        return;
      }

      listsSubscription = watchStream(
        'contract lists',
        runsService.watchContractLists(runId),
        (contractLists) => patchState(state, { contractLists }),
        { listsStreaming: true },
        { listsStreaming: false }
      );
    }

    return {
      /** Start a realtime listener for replay runs. Idempotent. */
      loadRuns(): void {
        if (runsSubscription) return;

        runsSubscription = watchStream(
          'replay runs',
          runsService.watchRuns(50),
          (runs) => patchState(state, { runs }),
          { isLoading: true, runsStreaming: true },
          { isLoading: false, runsStreaming: false }
        );
      },

      /** Select a run for the detail panel and start streaming its contract lists. */
      selectRun(runId: string | null): void {
        patchState(state, { selectedRunId: runId });
        loadContractLists(runId);
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
              snackBar.open(`Failed to start replay: ${message}`, 'Dismiss', { duration: 30000 });
              patchState(state, { isLoading: false });
              return of(null);
            }),
            takeUntilDestroyed(destroyRef)
          )
          .subscribe((response) => {
            patchState(state, { isLoading: false });
            if (response) {
              snackBar.open(`Replay started: ${response.runId}`, 'Dismiss', { duration: 30000 });
              patchState(state, { selectedRunId: response.runId });
              loadContractLists(response.runId);
            }
          });
      },
    };
  })
);
