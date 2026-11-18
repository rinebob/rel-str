/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 * @task #1546 — FE: Instance table — openPositions join + toggleRunState
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
import { OptionsStrategyService } from '../services/options-strategy.service';
import type { ManageInstance } from '@manage/instance-contracts';
import type { Position } from '../services/options-strategy.types';

// ── State ────────────────────────────────────────────────────────────────────

export interface StrategyManageState {
  instances: ManageInstance[];
  /** Open positions across all instances (the join source for the
   *  table's open-position column). One-shot fetch — position writes are
   *  engine-owned. */
  openPositions: Position[];
  isLoading: boolean;
  error: string | null;
}

const initialState: StrategyManageState = {
  instances: [],
  openPositions: [],
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

    /** Open positions grouped by instanceId — the row-level join for the
     *  table's open-position column. */
    openPositionsByInstance: computed(() => {
      const map: Record<string, Position[]> = {};
      for (const p of state.openPositions()) {
        (map[p.instanceId] ??= []).push(p);
      }
      return map;
    }),
  })),

  withMethods(
    (
      state,
      service = inject(StrategyManageService),
      optionsService = inject(OptionsStrategyService),
      destroyRef = inject(DestroyRef),
    ) => {
      let loadSub: Subscription | null = null;

      const loadOpenPositions = (): void => {
        optionsService
          .listStrategyPositions$()
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (res) => patchState(state, { openPositions: res.openPositions }),
            error: () => {
              /* position join is advisory — the instance table still renders */
            },
          });
      };

      return {
        /** Open the instance stream for the current user and fetch the
         *  open-position join. */
        load(): void {
          loadSub?.unsubscribe();
          patchState(state, { isLoading: true, error: null });

          loadSub = service
            .loadInstances$()
            .pipe(
              catchError((err) => {
                const msg = err?.code === 'unauthenticated' ||
                  err?.message === 'Authentication required'
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

          loadOpenPositions();
        },

        /** Start/stop: UNSTARTED→ACTIVE, ACTIVE→STOPPED, STOPPED→ACTIVE
         *  (restartable — an instance never returns to UNSTARTED). Real
         *  rows are disabled in v1 — the UI disables the action and this
         *  guard keeps it a no-op. */
        async toggleRunState(instance: ManageInstance): Promise<void> {
          if (instance.mode === 'real') return;
          patchState(state, { error: null });
          const next = instance.runState === 'ACTIVE' ? 'STOPPED' : 'ACTIVE';
          try {
            await service.setRunState(instance.id, next);
          } catch {
            patchState(state, { error: 'Failed to update run state' });
          }
        },

        /** Manual dismiss — the banner's ✕. Action failures skip the
         *  reload that would clear `error` (paper-trading #1229). */
        clearError(): void {
          patchState(state, { error: null });
        },
      };
    },
  ),
);
