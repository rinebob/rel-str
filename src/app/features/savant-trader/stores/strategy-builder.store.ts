/**
 * Signal-based store for the Strategy Builder. Manages strategy instances,
 * loading/error state, and selected instance for editing.
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

import { StrategyBuilderService } from '../services/strategy-builder.service';
import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { LifecycleState } from '@options-strategy-engine/contracts';

// ── State ────────────────────────────────────────────────────────────────────

export interface StrategyBuilderState {
  instances: StrategyInstanceConfig[];
  isLoading: boolean;
  error: string | null;
  selectedInstance: StrategyInstanceConfig | null;
}

const initialState: StrategyBuilderState = {
  instances: [],
  isLoading: false,
  error: null,
  selectedInstance: null,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const StrategyBuilderStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    activeInstances: computed(
      () => state.instances().filter((i) => i.lifecycleState === LifecycleState.ACTIVE),
    ),

    pausedInstances: computed(
      () => state.instances().filter((i) => i.lifecycleState === LifecycleState.PAUSED),
    ),

    stoppedInstances: computed(
      () => state.instances().filter((i) => i.lifecycleState === LifecycleState.STOPPED),
    ),
  })),

  withMethods(
    (
      state,
      service = inject(StrategyBuilderService),
      destroyRef = inject(DestroyRef),
    ) => {
      let loadSub: Subscription | null = null;

      return {
        /** Load all instances for the current user. */
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

        /** Create a new instance and refresh the list. */
        async create(config: Omit<StrategyInstanceConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<void> {
          patchState(state, { isLoading: true, error: null });
          try {
            await service.createInstance(config);
            this.load();
          } catch (err) {
            const msg = (err as Error)?.message ?? 'Failed to create instance';
            patchState(state, { error: msg, isLoading: false });
          }
        },

        /** Update an existing instance and refresh the list. */
        async update(id: string, changes: Partial<StrategyInstanceConfig>): Promise<void> {
          patchState(state, { isLoading: true, error: null });
          try {
            await service.updateInstance(id, changes);
            this.load();
          } catch (err) {
            const msg = (err as Error)?.message ?? 'Failed to update instance';
            patchState(state, { error: msg, isLoading: false });
          }
        },

        /** Soft-delete an instance and refresh the list. */
        async remove(id: string): Promise<void> {
          patchState(state, { isLoading: true, error: null });
          try {
            await service.deleteInstance(id);
            this.load();
          } catch (err) {
            const msg = (err as Error)?.message ?? 'Failed to delete instance';
            patchState(state, { error: msg, isLoading: false });
          }
        },

        /** Cycle or set the lifecycle state of an instance and refresh. */
        async toggleLifecycle(id: string, nextState?: LifecycleState): Promise<void> {
          const instance = state.instances().find((i) => i.id === id);
          if (!instance) return;

          const stateOrder = [LifecycleState.ACTIVE, LifecycleState.PAUSED, LifecycleState.STOPPED];
          const target = nextState ?? (() => {
            const currentIndex = stateOrder.indexOf(instance.lifecycleState);
            const nextIndex = (currentIndex + 1) % stateOrder.length;
            return stateOrder[nextIndex];
          })();

          patchState(state, { isLoading: true, error: null });
          try {
            await service.setLifecycleState(id, target);
            this.load();
          } catch (err) {
            const msg = (err as Error)?.message ?? 'Failed to update lifecycle state';
            patchState(state, { error: msg, isLoading: false });
          }
        },

        /** Select an instance for editing. */
        selectForEdit(instance: StrategyInstanceConfig | null): void {
          patchState(state, { selectedInstance: instance });
        },

        /** Clear the selected instance. */
        clearSelection(): void {
          patchState(state, { selectedInstance: null });
        },
      };
    },
  ),
);
