/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 *
 * Signal store for the Strategy Manage page (`options/strategy/manage`).
 * Streams the user's ManageInstance docs via StrategyManageService and
 * partitions them by execution mode for the Paper | Real tabs.
 */

import { computed, inject, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, of, Subscription } from 'rxjs';

import { StrategyManageService } from '../services/strategy-manage.service';
import type { ManageInstance } from '@manage/instance-contracts';

// ── State ────────────────────────────────────────────────────────────────────

export interface StrategyManageState {
  instances: ManageInstance[];
  isLoading: boolean;
  error: string | null;
}

const initialState: StrategyManageState = {
  instances: [],
  isLoading: false,
  error: null,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const StrategyManageStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    paperInstances: computed(
      () => state.instances().filter((i) => i.mode === 'paper'),
    ),

    realInstances: computed(
      () => state.instances().filter((i) => i.mode === 'real'),
    ),
  })),

  withMethods(
    (
      state,
      service = inject(StrategyManageService),
      destroyRef = inject(DestroyRef),
    ) => {
      let loadSub: Subscription | null = null;

      return {
        /** Open the instance stream for the current user. */
        load(): void {
          loadSub?.unsubscribe();
          patchState(state, { isLoading: true, error: null });

          loadSub = service
            .loadInstances$()
            .pipe(
              catchError((err) => {
                const msg = err?.code === 'unauthenticated'
                  ? 'Authentication required'
                  : 'Failed to load strategy instances';
                patchState(state, { error: msg, isLoading: false });
                return of([]);
              }),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (instances) => patchState(state, { instances, isLoading: false }),
            });
        },
      };
    },
  ),
);
