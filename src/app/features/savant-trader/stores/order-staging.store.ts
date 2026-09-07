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
import { BrokerPosition } from '../services/portfolio.service';
import {
  OrderIntent,
  OrderIntentStatus,
  InstrumentType,
  OrderSource,
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

function statusFromBrokerState(intent: OrderIntent, brokerState: string): OrderIntentStatus {
  switch (brokerState.toLowerCase()) {
    case 'filled': return OrderIntentStatus.FILLED;
    case 'cancelled':
    case 'canceled': return OrderIntentStatus.CANCELLED;
    case 'failed':
    case 'rejected':
    case 'voided': return OrderIntentStatus.FAILED;
    case 'queued': return OrderIntentStatus.QUEUED;
    case 'confirmed':
    case 'partially_filled':
      return intent.sourceRef?.type === 'stop_loss' || intent.orderType !== 'market'
        ? OrderIntentStatus.RESTING
        : OrderIntentStatus.SUBMITTED;
    default: return OrderIntentStatus.SUBMITTED;
  }
}

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
        (i) => i.status === OrderIntentStatus.SUBMITTED ||
          i.status === OrderIntentStatus.QUEUED || i.status === OrderIntentStatus.RESTING
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

    /**
     * Add whole-share broker positions as selectable filled rows.
     * These are session projections, not new Firestore order intents.
     */
    hydrateBrokerPositions(accountNumber: string, positions: BrokerPosition[]): void {
      const current = state.intents();
      const now = new Date().toISOString();
      const additions: Record<string, OrderIntent> = {};
      const updates: Record<string, OrderIntent> = {};
      const removals = new Set<string>();

      for (const position of positions) {
        const quantity = Number(position.quantity);
        const fillPrice = Number(position.averageBuyPrice);
        if (!position.symbol || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(fillPrice) || fillPrice <= 0) {
          continue;
        }
        const sharesHeldForSells = Number(position.sharesHeldForSells);
        const linkedStopLosses = Object.values(current).filter((intent) =>
          intent.sourceRef?.type === 'stop_loss' && 'symbol' in intent &&
          intent.symbol === position.symbol && intent.status === OrderIntentStatus.FAILED &&
          intent.error?.message.includes('Order not found at broker'),
        );
        for (const stopLoss of linkedStopLosses) {
          const requestedQuantity = Number(stopLoss.quantity ?? '0');
          if (Number.isFinite(sharesHeldForSells) && sharesHeldForSells >= requestedQuantity && requestedQuantity > 0) {
            updates[stopLoss.id] = {
              ...stopLoss,
              status: OrderIntentStatus.RESTING,
              error: undefined,
              result: {
                ...stopLoss.result,
                state: 'confirmed',
                filledQuantity: stopLoss.quantity,
              },
              updatedAt: now,
            };
          }
        }

        const entries = Object.values(current).filter((intent) =>
          'symbol' in intent && intent.symbol === position.symbol && intent.side === 'buy' &&
          intent.status !== OrderIntentStatus.CANCELLED,
        );
        // The broker position is authoritative for a matching failed buy intent.
        // This also handles older persisted failures whose error serialization
        // differs from the original reconciliation message.
        const falseFailure = entries.find((intent) => intent.status === OrderIntentStatus.FAILED);
        const existingEntry = falseFailure ?? entries.find((intent) =>
          intent.sourceRef?.type !== 'broker_position',
        );
        if (existingEntry?.status === OrderIntentStatus.FILLED) {
          const existingFilledQuantity = existingEntry.result?.filledQuantity ?? existingEntry.quantity;
          if (existingFilledQuantity !== position.quantity) {
            updates[existingEntry.id] = {
              ...existingEntry,
              quantity: position.quantity,
              result: {
                ...existingEntry.result,
                state: 'filled',
                fillPrice: position.averageBuyPrice,
                filledQuantity: position.quantity,
              },
              updatedAt: now,
            };
          }
          continue;
        }

        if (existingEntry?.status === OrderIntentStatus.SUBMITTED ||
            existingEntry?.status === OrderIntentStatus.SUBMITTING ||
            existingEntry?.status === OrderIntentStatus.FAILED) {
          const reconciled: OrderIntent = {
            ...existingEntry,
            status: OrderIntentStatus.FILLED,
            error: undefined,
            result: {
              ...existingEntry.result,
              state: 'filled',
              fillPrice: position.averageBuyPrice,
              filledQuantity: position.quantity,
            },
            updatedAt: now,
          };
          updates[existingEntry.id] = reconciled;
          const projection = current[`broker-position-${position.symbol}`];
          if (projection) removals.add(projection.id);
          continue;
        }

        const id = `broker-position-${position.symbol}`;
        additions[id] = {
          id,
          refId: `broker-position-${position.symbol}`,
          source: OrderSource.POSITION_MANAGEMENT,
          sourceRef: { type: 'broker_position', id: position.symbol },
          status: OrderIntentStatus.FILLED,
          accountNumber,
          side: 'buy',
          orderType: 'market',
          timeInForce: 'gtc',
          marketHours: 'regular_hours',
          instrumentType: InstrumentType.EQUITY,
          symbol: position.symbol,
          quantity: position.quantity,
          result: {
            state: 'filled',
            fillPrice: position.averageBuyPrice,
            filledQuantity: position.quantity,
          },
          createdAt: now,
          updatedAt: now,
        };
      }

      const reconciledIntents = { ...current, ...updates, ...additions };
      for (const id of removals) delete reconciledIntents[id];
      if (Object.keys(updates).length > 0 || Object.keys(additions).length > 0 || removals.size > 0) {
        patchState(state, { intents: reconciledIntents });
      }

      for (const intent of Object.values(updates)) {
        intentService.updateIntent(intent.id, {
          status: intent.status,
          error: undefined,
          result: intent.result,
          updatedAt: intent.updatedAt,
        })
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            error: (err: unknown) => console.error('[OrderStagingStore] broker position reconciliation persist failed:', err),
          });
      }
    },

    /** Archive failed fractional-close attempts before creating a replacement. */
    archiveFailedFractionalCloseIntents(parentId: string): void {
      const prev = state.intents();
      for (const intent of Object.values(prev)) {
        if (intent.sourceRef?.type !== 'fractional_close' || intent.sourceRef.id !== parentId || intent.status !== OrderIntentStatus.FAILED) continue;
        const archived = { ...intent, status: OrderIntentStatus.CANCELLED, error: undefined, updatedAt: new Date().toISOString() } as OrderIntent;
        patchState(state, { intents: { ...state.intents(), [intent.id]: archived } });
        intentService.updateIntent(intent.id, { status: archived.status, error: undefined, updatedAt: archived.updatedAt })
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({ error: (err: unknown) => console.error('[OrderStagingStore] failed fractional-close archive failed:', err) });
      }
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

    /** Persist a new intent, then submit it after the create write succeeds. */
    stageAndSubmitIntent(intent: OrderIntent): void {
      const prev = state.intents();
      patchState(state, { intents: { ...prev, [intent.id]: intent } });
      intentService.createIntent(intent)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: () => {
            const current = state.intents()[intent.id];
            if (current) this.transitionAndExecute(intent.id, current, state.intents(), intent.status);
          },
          error: (err: unknown) => {
            const next = { ...state.intents() };
            delete next[intent.id];
            patchState(state, { intents: next, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to stage stop loss', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] stageAndSubmitIntent failed:', err);
          },
        });
    },

    /** Persist edits to a staged intent, then submit it after the update succeeds. */
    updateAndSubmitIntent(id: string, partial: Partial<Omit<OrderIntent, 'instrumentType'>>): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing || existing.status !== OrderIntentStatus.STAGED) return;
      const updated = { ...existing, ...partial, updatedAt: new Date().toISOString() } as OrderIntent;
      patchState(state, { intents: { ...prev, [id]: updated } });
      intentService.updateIntent(id, partial)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: () => this.transitionAndExecute(id, state.intents()[id]!, state.intents(), existing.status),
          error: (err: unknown) => {
            patchState(state, { intents: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to save stop-loss changes', 'Dismiss', { duration: 4000 });
            console.error('[OrderStagingStore] updateAndSubmitIntent failed:', err);
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
      const nextStatus = statusFromBrokerState(existing, brokerState);

      const next: OrderIntent = {
        ...existing,
        status: nextStatus,
        result: result.result
          ? {
              ...(result.result.orderId !== undefined && { orderId: result.result.orderId }),
              ...(result.result.state !== undefined && { state: result.result.state }),
              ...(result.result.fillPrice !== undefined && { fillPrice: result.result.fillPrice }),
              ...(result.result.filledQuantity !== undefined && { filledQuantity: result.result.filledQuantity }),
              ...(result.result.brokerOrder !== undefined && { brokerOrder: result.result.brokerOrder }),
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
      if (existing.status !== OrderIntentStatus.SUBMITTED && existing.status !== OrderIntentStatus.RESTING) return;

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

    /** Reconcile stuck SUBMITTING or SUBMITTED intents on load. Queries broker for actual state. */
    reconcileStuckIntents(): void {
      const stuck = Object.values(state.intents()).filter(
        (i) => i.status === OrderIntentStatus.SUBMITTING ||
          i.status === OrderIntentStatus.SUBMITTED || i.status === OrderIntentStatus.QUEUED ||
          i.status === OrderIntentStatus.RESTING
      );
      if (stuck.length === 0) return;

      for (const intent of stuck) {
        this.reconcileIntent(intent.id);
      }
    },

    /** Reconcile a single intent by querying the broker for its actual state. */
    reconcileIntent(id: string): void {
      const prev = state.intents();
      const existing = prev[id];
      if (!existing) return;
      if (existing.instrumentType === InstrumentType.OPTION) return;

      from(orderExecution.reconcileOrder(existing.accountNumber, existing.refId, existing.result?.orderId))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (recon) => {
            // A submitted order remains broker-authoritative if a later list query
            // cannot match it; do not turn a known submission into a false failure.
            if (!recon.found && (existing.status === OrderIntentStatus.SUBMITTED || existing.status === OrderIntentStatus.QUEUED || existing.status === OrderIntentStatus.RESTING)) return;
            this.applyReconciliationResult(id, prev, recon);
          },
          error: (err: unknown) => {
            this.markFailed(id, prev, {
              message: err instanceof Error ? err.message : String(err),
              retryable: true,
            });
          },
        });
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
        if (existing.status === OrderIntentStatus.SUBMITTED || existing.status === OrderIntentStatus.QUEUED || existing.status === OrderIntentStatus.RESTING) return;
        this.markFailed(id, prev, { message: 'Order not found at broker — assume submission failed', retryable: true });
        return;
      }

      const nextStatus = statusFromBrokerState(existing, recon.state);

      const next: OrderIntent = {
        ...existing,
        status: nextStatus,
        result: {
          ...existing.result,
          ...(recon.orderId !== undefined && { orderId: recon.orderId }),
          ...(recon.state !== undefined && { state: recon.state }),
          ...(recon.fillPrice !== undefined && { fillPrice: recon.fillPrice }),
          ...(recon.filledQuantity !== undefined && { filledQuantity: recon.filledQuantity }),
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
