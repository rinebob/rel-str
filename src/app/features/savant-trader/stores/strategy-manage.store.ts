/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 * @task #1546 — FE: Instance table — openPositions join + toggleRunState
 * @task #1547 — FE: Create New Instance dialog — sessionVariants + createInstances
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

import {
  StrategyManageService,
  type CreateInstancesResult,
  type CreateManageInstanceInput,
} from '../services/strategy-manage.service';
import { OptionsStrategyService } from '../services/options-strategy.service';
import type { ManageInstance } from '@manage/instance-contracts';
import type { ManageVariant } from '@manage/variant-contracts';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { Position } from '../services/options-strategy.types';

// ── State ────────────────────────────────────────────────────────────────────

export interface StrategyManageState {
  instances: ManageInstance[];
  /** Open positions across all instances (the join source for the
   *  table's open-position column). One-shot fetch — position writes are
   *  engine-owned. */
  openPositions: Position[];
  /** Ad hoc variants composed this session by Create New Strategy (F4) —
   *  ephemeral by design (US-2); the create pickers merge them after the
   *  catalog. */
  sessionVariants: ManageVariant[];
  isLoading: boolean;
  error: string | null;
}

const initialState: StrategyManageState = {
  instances: [],
  openPositions: [],
  sessionVariants: [],
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

    /** The variant picker list — seeded catalog first, then this session's
     *  ad hoc variants. A session variant whose id collides with the
     *  catalog is dropped (the catalog entry wins): a duplicate `track`
     *  key in the picker's @for crashes the dialog, and .find() would
     *  silently substitute the catalog variant for the user's ad hoc one. */
    variants: computed(() => {
      const catalogIds = new Set(MANAGE_VARIANTS.map((v) => v.id));
      return [
        ...MANAGE_VARIANTS,
        ...state.sessionVariants().filter((v) => !catalogIds.has(v.id)),
      ];
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

        /** Filter-submit create (#1605): returns the {created, skipped}
         *  split on success or the failure message on error — the only
         *  caller today is the create dialog, so errors return dialog-
         *  scoped rather than landing in the page banner behind the
         *  overlay. Real create is disabled in v1 — same guard as
         *  toggleRunState. The stream delivers the new docs. */
        async createInstances(
          inputs: CreateManageInstanceInput[],
        ): Promise<CreateInstancesResult | string> {
          if (inputs.some((i) => i.mode === 'real')) {
            return 'Real-mode instances are disabled in v1';
          }
          try {
            return await service.createInstances(inputs);
          } catch (err) {
            return err instanceof Error && err.message
              ? err.message
              : 'Failed to create strategy instances';
          }
        },

        /** Register an ad hoc variant for this session (F4 Create New
         *  Strategy pushes here; the picker merge is live immediately).
         *  A re-push of the same id replaces the earlier entry — session
         *  variants are editable compositions, not an append log. */
        addSessionVariant(variant: ManageVariant): void {
          patchState(state, {
            sessionVariants: [
              ...state.sessionVariants().filter((v) => v.id !== variant.id),
              variant,
            ],
          });
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
