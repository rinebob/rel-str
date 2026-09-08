/**
 * Savant Trader Signal Entry Store
 *
 * Firestore-backed NgRx signal store for Signal Entry Records.
 *
 * Per ADR-008, each record is written once at staging, updated once to
 * record the RH order ID after submission, then never touched again.
 * RH is authoritative for all order lifecycle state. The UI reads RH
 * directly for order state, positions, fills, and stops.
 *
 * Methods:
 *   loadTickets  — hydrate all records from Firestore
 *   stageTicket  — create a new record (optimistic + persisted)
 *   submitTicket — submit to RH, record rhOrderId, done
 *   updateTicket — edit staged terms before submission
 *   removeTicket — discard a staged record
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

import { OrderTicketService } from '../services/order-ticket.service';
import { OrderExecutionService } from '../services/order-execution.service';
import {
  OrderTicket,
  OrderTicketStatus,
  InstrumentType,
  EquityOrderTicket,
} from '../services/order-ticket.types';
import { ExecutionResult } from '../services/order-execution.service';

export interface OrderTicketState {
  /** Signal Entry Records keyed by id. */
  tickets: Record<string, OrderTicket>;
  /** True while records are loading from Firestore. */
  loading: boolean;
  /** Error from loading or mutating records. */
  error: string | null;
}

const initialState: OrderTicketState = {
  tickets: {},
  loading: false,
  error: null,
};

export const OrderTicketStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Records grouped by symbol. */
    ticketsBySymbol: computed((): Record<string, OrderTicket[]> => {
      const grouped: Record<string, OrderTicket[]> = {};
      for (const ticket of Object.values(state.tickets())) {
        const symbol = 'symbol' in ticket
          ? ticket.symbol
          : ticket.legs[0]?.symbol ?? '';
        if (!grouped[symbol]) grouped[symbol] = [];
        grouped[symbol].push(ticket);
      }
      return grouped;
    }),
  })),

  withMethods((
    state,
    ticketService = inject(OrderTicketService),
    orderExecution = inject(OrderExecutionService),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
  ) => ({

    /** Hydrate all records from Firestore on page load. */
    loadTickets(): void {
      patchState(state, { loading: true, error: null });
      ticketService.loadAllTickets()
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (tickets) => {
            const map: Record<string, OrderTicket> = {};
            for (const i of tickets) { map[i.id] = i; }
            patchState(state, { tickets: map, loading: false });
          },
          error: (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err ?? 'Load failed');
            patchState(state, { loading: false, error: message });
            console.error('[OrderTicketStore] Failed to load tickets:', err);
          },
        });
    },

    /** Stage a new Signal Entry Record. Optimistic + persisted. */
    stageTicket(ticket: OrderTicket): void {
      const prev = state.tickets();
      patchState(state, { tickets: { ...prev, [ticket.id]: ticket } });
      ticketService.createTicket(ticket)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            const next = { ...state.tickets() };
            delete next[ticket.id];
            patchState(state, { tickets: next, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to stage signal entry', 'Dismiss', { duration: 4000 });
            console.error('[OrderTicketStore] stageTicket failed:', err);
          },
        });
    },

    /** Update an existing record (configuration changes before submission).
     *  Any field with value `undefined` in the partial is removed from the
     *  local ticket (matching the service's `deleteField()` behavior). */
    updateTicket(id: string, partial: Partial<Omit<OrderTicket, 'instrumentType'>>): void {
      const prev = state.tickets();
      const existing = prev[id];
      if (!existing) return;
      // Object spread does not overwrite with `undefined`, so explicitly
      // delete any key the caller set to `undefined` before merging.
      const updated = { ...existing, updatedAt: new Date().toISOString() } as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(partial)) {
        if (value === undefined) {
          delete updated[key];
        } else {
          updated[key] = value;
        }
      }
      patchState(state, { tickets: { ...prev, [id]: updated as unknown as OrderTicket } });
      ticketService.updateTicket(id, partial)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { tickets: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to update signal entry', 'Dismiss', { duration: 4000 });
            console.error('[OrderTicketStore] updateTicket failed:', err);
          },
        });
    },

    /**
     * Submit a staged record to Robinhood.
     *
     * Sets SUBMITTING locally for UI feedback, submits to RH, then records
     * the RH order ID. After that, the record is never updated again — RH
     * is authoritative for all subsequent order state.
     *
     * On failure, reverts to STAGED so the user can retry.
     */
    submitTicket(id: string): void {
      const prev = state.tickets();
      const existing = prev[id];
      if (!existing) return;
      // Concurrency guard: reject double-submit while a submission is in flight.
      if (existing.status === OrderTicketStatus.SUBMITTING) return;
      if (existing.instrumentType === InstrumentType.OPTION) {
        snackBar.open('Option orders are not yet supported', 'Dismiss', { duration: 4000 });
        return;
      }

      // Set SUBMITTING locally for UI feedback (not persisted — it's transient)
      const submitting: OrderTicket = {
        ...existing,
        status: OrderTicketStatus.SUBMITTING,
        error: undefined,
        updatedAt: new Date().toISOString(),
      };
      patchState(state, { tickets: { ...prev, [id]: submitting } });

      from(orderExecution.submitEquityOrder(existing as EquityOrderTicket))
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          next: (result: ExecutionResult) => {
            const current = state.tickets()[id];
            if (!current) return;

            if (!result.success) {
              // Revert to STAGED so the user can retry. Don't persist failure.
              const reverted: OrderTicket = {
                ...existing,
                status: OrderTicketStatus.STAGED,
                error: result.error,
                updatedAt: new Date().toISOString(),
              };
              patchState(state, { tickets: { ...state.tickets(), [id]: reverted } });
              return;
            }

            // Success — record rhOrderId and set SUBMITTED. This is the
            // second and final write to this record.
            const submitted: OrderTicket = {
              ...current,
              status: OrderTicketStatus.SUBMITTED,
              error: undefined,
              result: result.result
                ? {
                    orderId: result.result.orderId,
                    state: result.result.state,
                  }
                : current.result,
              updatedAt: new Date().toISOString(),
            };
            patchState(state, { tickets: { ...state.tickets(), [id]: submitted } });
            ticketService.updateTicket(id, {
              status: OrderTicketStatus.SUBMITTED,
              result: submitted.result,
              updatedAt: submitted.updatedAt,
            })
              .pipe(takeUntilDestroyed(destroyRef))
              .subscribe({
                error: (err: unknown) => {
                  console.error('[OrderTicketStore] Failed to persist rhOrderId:', err);
                },
              });
          },
          error: (err: unknown) => {
            // Revert to STAGED so the user can retry.
            const reverted: OrderTicket = {
              ...existing,
              status: OrderTicketStatus.STAGED,
              error: {
                message: err instanceof Error ? err.message : String(err),
                retryable: true,
              },
              updatedAt: new Date().toISOString(),
            };
            patchState(state, { tickets: { ...state.tickets(), [id]: reverted } });
          },
        });
    },

    /** Remove a record (discard). Optimistic + persisted. */
    removeTicket(id: string): void {
      const prev = state.tickets();
      const next = { ...prev };
      delete next[id];
      patchState(state, { tickets: next });
      ticketService.deleteTicket(id)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe({
          error: (err: unknown) => {
            patchState(state, { tickets: prev, error: err instanceof Error ? err.message : String(err) });
            snackBar.open('Failed to remove signal entry', 'Dismiss', { duration: 4000 });
            console.error('[OrderTicketStore] removeTicket failed:', err);
          },
        });
    },
  })),
);
