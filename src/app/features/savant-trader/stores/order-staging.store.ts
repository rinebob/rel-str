/**
 * Savant Trader Order Staging Store
 *
 * Firestore-backed NgRx signal store for order intents. Mirrors the
 * OccurrenceDecisionStore pattern: optimistic updates with error rollback.
 *
 * Lifecycle: stage → submit → fill (or fail → retry, or cancel).
 * refId is generated at staging and preserved across retries.
 */
import { computed, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';

import { OrderIntentService } from '../services/order-intent.service';
import {
  OrderIntent,
  OrderIntentStatus,
} from '../services/order-intent.types';

export interface OrderStagingState {
  /** Order intents keyed by intent id. */
  intents: Record<string, OrderIntent>;
  /** True while intents are loading from Firestore. */
  loading: boolean;
  /** Error from loading or mutating intents. */
  error: string | null;
}

const initialState: OrderStagingState = {
  intents: {},
  loading: false,
  error: null,
};

export const OrderStagingStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Intents with status STAGED or READY — awaiting user configuration/submission. */
    stagedIntents: computed((): OrderIntent[] =>
      Object.values(state.intents()).filter(
        (i) => i.status === OrderIntentStatus.STAGED || i.status === OrderIntentStatus.READY
      )
    ),

    /** Intents currently being submitted to the broker. */
    submittingIntents: computed((): OrderIntent[] =>
      Object.values(state.intents()).filter(
        (i) => i.status === OrderIntentStatus.SUBMITTING
      )
    ),

    /** Intents submitted and awaiting fill. */
    activeIntents: computed((): OrderIntent[] =>
      Object.values(state.intents()).filter(
        (i) => i.status === OrderIntentStatus.SUBMITTED
      )
    ),

    /** Intents in a terminal state (FILLED, FAILED, CANCELLED). */
    terminalIntents: computed((): OrderIntent[] =>
      Object.values(state.intents()).filter(
        (i) =>
          i.status === OrderIntentStatus.FILLED ||
          i.status === OrderIntentStatus.FAILED ||
          i.status === OrderIntentStatus.CANCELLED
      )
    ),

    /** Intents grouped by symbol. Option intents are grouped under their first leg symbol. */
    intentsBySymbol: computed((): Record<string, OrderIntent[]> => {
      const grouped: Record<string, OrderIntent[]> = {};
      for (const intent of Object.values(state.intents())) {
        const symbol = 'symbol' in intent
          ? intent.symbol
          : intent.legs[0]?.symbol ?? '';
        if (!grouped[symbol]) grouped[symbol] = [];
        grouped[symbol].push(intent);
      }
      return grouped;
    }),
  })),

  withMethods((
    state,
    intentService = inject(OrderIntentService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
  ) => ({
    /** Hydrate all non-terminal intents from Firestore on page load. */
    loadIntents(): void {
      patchState(state, { loading: true, error: null });
      intentService.loadAllIntents()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (intents) => {
            const map: Record<string, OrderIntent> = {};
            for (const i of intents) { map[i.id] = i; }
            patchState(state, { intents: map, loading: false });
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err ?? 'Load failed');
            patchState(state, { loading: false, error: message });
            console.error('[OrderStagingStore] Failed to load intents:', err);
          },
        });
    },

    /** Stage a new order intent. Optimistic + persisted. */
    stageIntent(intent: OrderIntent): void {
      const prev = state.intents();
      patchState(state, { intents: { ...prev, [intent.id]: intent } });
      intentService.createIntent(intent)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            const next = { ...state.intents() };
            delete next[intent.id];
            patchState(state, { intents: next, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to stage order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] stageIntent failed:', err);
          },
        });
    },

    /** Update an existing intent (configuration changes). Optimistic + persisted. */
    updateIntent(id: string, partial: Partial<Omit<OrderIntent, 'instrumentType'>>): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      const updated = { ...existing, ...partial, updatedAt: new Date().toISOString() } as OrderIntent;
      patchState(state, { intents: { ...prev, [id]: updated } });
      intentService.updateIntent(id, partial)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to update order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] updateIntent failed:', err);
          },
        });
    },

    /** Remove an intent (discard). Optimistic + persisted. */
    removeIntent(id: string): void {
      const prev = state.intents();
      const next = { ...prev };
      delete next[id];
      patchState(state, { intents: next });
      intentService.deleteIntent(id)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to remove order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] removeIntent failed:', err);
          },
        });
    },

    /** Submit an intent to the broker. Transitions to SUBMITTING, then SUBMITTED or FAILED. */
    submitIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      const submitting: OrderIntent = {
        ...existing,
        status: OrderIntentStatus.SUBMITTING,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: submitting } });
      intentService.updateIntent(id, { status: OrderIntentStatus.SUBMITTING })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to submit order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] submitIntent failed:', err);
          },
        });
      // The actual broker submission + transition to SUBMITTED/FAILED
      // is handled by the OrderExecutionService (FE-B2, #197).
    },

    /** Retry a failed intent. Re-submits with the same refId. */
    retryIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      if (existing.status !== OrderIntentStatus.FAILED) return;
      const retrying: OrderIntent = {
        ...existing,
        status: OrderIntentStatus.SUBMITTING,
        error: undefined,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: retrying } });
      intentService.updateIntent(id, { status: OrderIntentStatus.SUBMITTING, error: undefined })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to retry order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] retryIntent failed:', err);
          },
        });
    },

    /** Cancel an intent. Transitions to CANCELLED. */
    cancelIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      const cancelled: OrderIntent = {
        ...existing,
        status: OrderIntentStatus.CANCELLED,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: cancelled } });
      intentService.updateIntent(id, { status: OrderIntentStatus.CANCELLED })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to cancel order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] cancelIntent failed:', err);
          },
        });
    },

    /** Reconcile stuck SUBMITTING intents on load. Queries broker for actual state. */
    reconcileStuckIntents(): void {
      const stuck = Object.values(state.intents()).filter(
        (i) => i.status === OrderIntentStatus.SUBMITTING
      );
      if (stuck.length === 0) return;
      // The actual reconciliation queries the broker via OrderExecutionService
      // (FE-B2, #197). For now, mark stuck intents as FAILED so the user can retry.
      const prev = state.intents();
      const next = { ...prev };
      for (const intent of stuck) {
        next[intent.id] = {
          ...intent,
          status: OrderIntentStatus.FAILED,
          error: { message: 'Submission timed out — stuck in SUBMITTING', retryable: true },
          updatedAt: new Date().toISOString(),
        };
      }
      patchState(state, { intents: next });
      // Persist the reconciliation — rollback to prev on failure
      for (const intent of stuck) {
        intentService.updateIntent(intent.id, {
          status: OrderIntentStatus.FAILED,
          error: { message: 'Submission timed out — stuck in SUBMITTING', retryable: true },
        })
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            error: (err: unknown) => {
              patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
              snackBar.open('Failed to reconcile stuck intents — reverted', 'Dismiss', { duration: 4000 });
              console.error('[OrderStagingStore] reconcileStuckIntents persist failed:', err);
            },
          });
      }
    },
  })),
);
