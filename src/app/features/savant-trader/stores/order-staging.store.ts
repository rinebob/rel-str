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
import { from } from 'rxjs';

import { OrderIntentService } from '../services/order-intent.service';
import { OrderExecutionService } from '../services/order-execution.service';
import {
  OrderIntent,
  OrderIntentStatus,
  InstrumentType,
  EquityOrderIntent,
  OrderIntentError,
} from '../services/order-intent.types';
import { ExecutionResult, ReconciliationResult } from '../services/order-execution.service';

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
    orderExecution = inject(OrderExecutionService),
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
            this.reconcileStuckIntents();
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

    /** Submit an intent to the broker. Transitions to SUBMITTING, then SUBMITTED/FAILED/FILLED. */
    submitIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      this.transitionAndExecute(id, existing, prev, existing.status);
    },

    /**
     * Set SUBMITTING optimistically, persist the status, then call the broker execution service.
     * On success, status is derived from the broker's returned state.
     */
    transitionAndExecute(
      id: string,
      existing: OrderIntent,
      prev: Record<string, OrderIntent>,
      previousStatus: OrderIntentStatus,
    ): void {
      if (existing.instrumentType === InstrumentType.OPTION) {
        this.markFailed(id, prev, { message: 'Option orders are not yet supported', retryable: false });
        return;
      }

      const submitting: OrderIntent = {
        ...existing,
        status: OrderIntentStatus.SUBMITTING,
        error: undefined,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: submitting } });
      intentService.updateIntent(id, { status: OrderIntentStatus.SUBMITTING })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to submit order intent', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] submitIntent status update failed:', err);
          },
        });

      from(orderExecution.submitEquityOrder(existing as EquityOrderIntent))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => this.applyExecutionResult(id, prev, result, previousStatus),
          error: (err: unknown) => {
            this.markFailed(id, prev, {
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            });
          },
        });
    },

    /** Apply the broker's result, mapping the returned state to an OrderIntentStatus. */
    applyExecutionResult(
      id: string,
      prev: Record<string, OrderIntent>,
      result: ExecutionResult,
      previousStatus: OrderIntentStatus,
    ): void {
      const existing = state.intents()[id];
      if (!existing) return;

      if (!result.success) {
        const error = result.error ?? { message: 'Broker rejected order', retryable: false };
        this.markFailed(id, prev, error);
        return;
      }

      const brokerState = (result.result?.state ?? '').toLowerCase();
      let nextStatus: OrderIntentStatus;
      if (brokerState === 'filled') {
        nextStatus = OrderIntentStatus.FILLED;
      } else if (brokerState === 'cancelled' || brokerState === 'canceled') {
        nextStatus = OrderIntentStatus.CANCELLED;
      } else if (brokerState === 'failed') {
        nextStatus = OrderIntentStatus.FAILED;
      } else {
        nextStatus = OrderIntentStatus.SUBMITTED;
      }

      const next: OrderIntent = {
        ...existing,
        status: nextStatus,
        result: result.result
          ? {
              orderId: result.result.orderId,
              state: result.result.state,
              fillPrice: result.result.fillPrice,
              filledQuantity: result.result.filledQuantity,
            }
          : existing.result,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: next } });
      intentService.updateIntent(id, {
        status: nextStatus,
        result: next.result,
        updatedAt: next.updatedAt,
      })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to persist broker result', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] applyExecutionResult persist failed:', err);
          },
        });
    },

    /** Mark an intent as FAILED and persist. */
    markFailed(
      id: string,
      prev: Record<string, OrderIntent>,
      error: OrderIntentError,
    ): void {
      const existing = state.intents()[id];
      if (!existing) return;
      const failed: OrderIntent = {
        ...existing,
        status: OrderIntentStatus.FAILED,
        error,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: failed } });
      intentService.updateIntent(id, { status: OrderIntentStatus.FAILED, error })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to persist order failure', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] markFailed persist failed:', err);
          },
        });
    },

    /** Retry a failed intent. Re-submits with the same refId. */
    retryIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      if (existing.status !== OrderIntentStatus.FAILED) return;
      this.transitionAndExecute(id, existing, prev, existing.status);
    },

    /** Modify a submitted intent — cancels broker order and reverts to STAGED for editing. */
    modifyIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      if (existing.status !== OrderIntentStatus.SUBMITTED) return;

      const persistModification = () => {
        const modified: OrderIntent = {
          ...existing,
          status: OrderIntentStatus.STAGED,
          result: undefined,
          error: undefined,
          updatedAt: new Date().toISOString(),
        };
        patchState(state, { intents: { ...prev, [id]: modified } });
        intentService.updateIntent(id, { status: OrderIntentStatus.STAGED, result: undefined, error: undefined, updatedAt: modified.updatedAt })
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            error: (err: unknown) => {
              patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
              snackBar.open('Failed to modify order intent', 'Dismiss', { duration: 4000 });
              console.error('[OrderStagingStore] modifyIntent persist failed:', err);
            },
          });
      };

      const orderId = existing.result?.orderId;
      if (!orderId) {
        persistModification();
        return;
      }

      from(orderExecution.cancelEquityOrder(existing.accountNumber, orderId))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            if (result.success) {
              persistModification();
            } else {
              this.markFailed(id, prev, result.error ?? { message: 'Broker modify/cancel failed', retryable: false });
            }
          },
          error: (err: unknown) => {
            this.markFailed(id, prev, {
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            });
          },
        });
    },

    /** Cancel an intent. Cancels the broker order when an orderId is present, then transitions to CANCELLED. */
    cancelIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;

      const persistCancel = (next: OrderIntent) => {
        patchState(state, { intents: { ...prev, [id]: next } });
        intentService.updateIntent(id, { status: next.status, error: next.error, updatedAt: next.updatedAt })
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            error: (err: unknown) => {
              patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
              snackBar.open('Failed to cancel order intent', 'Dismiss', { duration: 4000 });
              console.error('[OrderStagingStore] cancelIntent persist failed:', err);
            },
          });
      };

      const orderId = existing.result?.orderId;
      if (!orderId) {
        persistCancel({
          ...existing,
          status: OrderIntentStatus.CANCELLED,
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      from(orderExecution.cancelEquityOrder(existing.accountNumber, orderId))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result) => {
            if (result.success) {
              persistCancel({
                ...existing,
                status: OrderIntentStatus.CANCELLED,
                updatedAt: new Date().toISOString(),
              });
            } else {
              this.markFailed(id, prev, result.error ?? { message: 'Broker cancel failed', retryable: false });
            }
          },
          error: (err: unknown) => {
            this.markFailed(id, prev, {
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            });
          },
        });
    },

    /** Reconcile stuck SUBMITTING intents on load. Queries broker for actual state. */
    reconcileStuckIntents(): void {
      const stuck = Object.values(state.intents()).filter(
        (i) => i.status === OrderIntentStatus.SUBMITTING
      );
      if (stuck.length === 0) return;

      for (const intent of stuck) {
        from(orderExecution.reconcileOrder(intent.accountNumber, intent.refId))
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (recon) => this.applyReconciliationResult(intent.id, state.intents(), recon),
            error: (err: unknown) => {
              this.markFailed(intent.id, state.intents(), {
                message: err instanceof Error ? err.message : String(err),
                retryable: true,
              });
            },
          });
      }
    },

    /** Map a ReconciliationResult to the appropriate OrderIntentStatus. */
    applyReconciliationResult(
      id: string,
      prev: Record<string, OrderIntent>,
      recon: ReconciliationResult,
    ): void {
      const existing = state.intents()[id];
      if (!existing) return;

      if (!recon.found || !recon.state) {
        this.markFailed(id, prev, { message: 'Order not found at broker — assume submission failed', retryable: true });
        return;
      }

      const stateLower = recon.state.toLowerCase();
      let nextStatus: OrderIntentStatus;
      if (stateLower === 'filled') {
        nextStatus = OrderIntentStatus.FILLED;
      } else if (stateLower === 'cancelled' || stateLower === 'canceled') {
        nextStatus = OrderIntentStatus.CANCELLED;
      } else if (stateLower === 'failed') {
        nextStatus = OrderIntentStatus.FAILED;
      } else {
        nextStatus = OrderIntentStatus.SUBMITTED;
      }

      const next: OrderIntent = {
        ...existing,
        status: nextStatus,
        result: {
          ...existing.result,
          orderId: recon.orderId,
          state: recon.state,
          fillPrice: recon.fillPrice,
          filledQuantity: recon.filledQuantity,
        },
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { intents: { ...prev, [id]: next } });
      intentService.updateIntent(id, { status: nextStatus, result: next.result, updatedAt: next.updatedAt })
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            console.error('[OrderStagingStore] applyReconciliationResult persist failed:', err);
          },
        });
    },
  })),
);
