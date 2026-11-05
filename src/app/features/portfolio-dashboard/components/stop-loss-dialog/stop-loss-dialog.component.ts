/**
 * Stop Loss Dialog — add and update modes.
 *
 * Material dialog for placing a stop-loss order on an equity position.
 * Embeds the shared StopLossFormComponent for stop price/percent input.
 * Add mode builds a ticket via buildPositionStopLossTicket() and calls
 * OrderExecutionService.submitEquityOrder() inline; update mode
 * (data.update) prefills from an existing stop and replaces it through
 * updateEquityStopOrder() with a buildStopLossUpdateTicket() ticket.
 *
 * Retry resubmits the same ticket object (preserving refId idempotency),
 * phase-aware in update mode: cancel-phase retries the whole primitive,
 * place-phase re-places only (never re-cancels); PLACEMENT_DEAD mints a
 * fresh refId since the dead placement likely consumed the original.
 */
import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DS_DIALOG_DATA } from '../../../../shared/ds/ds-dialog';
import { DsDialogRef } from '../../../../shared/ds/ds-dialog';


import {
  OrderExecutionService,
  ExecutionResult,
  UpdateStopResult,
  asUpdatePlaceFailure,
  PLACEMENT_DEAD_CODE,
} from '../../../savant-trader/services/order-execution.service';
import { BrokerOrder, EquityPosition } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import {
  buildPositionStopLossTicket,
  buildStopLossUpdateTicket,
} from '../../../savant-trader/utils/stop-loss-ticket.util';
import { toEquityTimeInForce, toEquityMarketHours } from '../../../savant-trader/utils/broker-order.util';
import {
  EquityMarketHours,
  EquityOrderTicket,
  EquityTimeInForce,
} from '../../../savant-trader/services/order-ticket.types';
import { StopLossFormComponent, StopLossSubmit } from '../../../../shared/components/stop-loss-form/stop-loss-form.component';

export interface StopLossDialogData {
  position: EquityPosition;
  currentPrice: number;
  accountNumber: string;
  /** Update mode (#888): replace an existing protective stop. `candidates`
   *  drives the picker when > 1 and no `target` is preselected. */
  update?: {
    candidates: BrokerOrder[];
    target?: BrokerOrder;
  };
}

type DialogState = 'picking' | 'editing' | 'submitting' | 'success' | 'error';

@Component({
  selector: 'app-stop-loss-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    StopLossFormComponent],
  templateUrl: './stop-loss-dialog.component.html',
  styleUrl: './stop-loss-dialog.component.scss',
})
export class StopLossDialogComponent {
  private readonly dialogRef = inject(DsDialogRef<StopLossDialogComponent, boolean>);
  private readonly orderExecution = inject(OrderExecutionService);
  private readonly data = inject(DS_DIALOG_DATA) as StopLossDialogData;

  // Static dialog-data projections — plain fields, not signals; DS_DIALOG_DATA
  // never changes over the dialog's lifetime.
  readonly symbol = this.data.position.symbol;
  /** Whole-share quantity (truncated) — stop-loss orders require whole shares. */
  readonly quantity = String(Math.trunc(this.data.position.quantity ?? 0));
  readonly currentPrice = this.data.currentPrice;
  readonly accountNumber = this.data.accountNumber;
  readonly candidates = this.data.update?.candidates ?? [];

  /** Update mode (#888): the order being replaced. Preselected `target` or a
   *  single candidate skips the picker; multiple candidates open `picking`. */
  readonly isUpdate = !!this.data.update;
  readonly targetOrder = signal<BrokerOrder | null>(
    this.data.update?.target ??
      (this.data.update?.candidates.length === 1 ? this.data.update.candidates[0] : null),
  );

  /** Form-bound order params, seeded from the target order in update mode. */
  readonly formTimeInForce = signal<EquityTimeInForce>('gtc');
  readonly formMarketHours = signal<EquityMarketHours>('regular_hours');

  readonly state = signal<DialogState>(
    this.isUpdate && !this.targetOrder() ? 'picking' : 'editing',
  );

  constructor() {
    this.seedOrderParams(this.targetOrder());
  }
  readonly result = signal<UpdateStopResult | null>(null);
  /** Last stop price submitted, for display in the success view. */
  readonly lastStopPrice = signal<number>(0);
  /** Last built ticket, retained for retry to preserve refId idempotency. */
  private lastTicket: EquityOrderTicket | null = null;

  readonly error = computed(() =>
    this.state() === 'error' ? this.result()?.error?.message ?? 'Unknown error' : null,
  );
  readonly canRetry = computed(() => {
    const res = this.result();
    if (!this.isUpdate) return res?.error?.retryable ?? true;
    // Update mode follows the primitive's caller contract: cancel-phase
    // retries only while the cancel error is retryable; place-phase retries
    // whenever unprotected — the old stop is gone and nothing landed, so
    // re-placing is the designed recovery even when error.retryable is false
    // (PLACEMENT_DEAD mints a fresh refId in onRetry). unprotected !== true
    // means a ref-id conflict / unconfirmed ack — the replacement likely
    // exists already; reconcile via close-and-refresh, never re-place.
    if (res?.phase === 'cancel') return res.error?.retryable ?? true;
    if (res?.phase === 'place') return res.unprotected === true;
    // Phase-less update results shouldn't occur — submitTicket stamps place
    // phase and the catch stamps the fallback — but honor non-retryable
    // defensively so a slipped-through result can't arm a doomed retry.
    return res?.error?.retryable ?? true;
  });
  /** The old stop was cancelled but no replacement landed — the position is
   *  unprotected. Retry re-places the retained ticket; it must not re-cancel. */
  readonly unprotectedWarning = computed(
    () =>
      this.isUpdate &&
      this.result()?.phase === 'place' &&
      this.result()?.unprotected === true,
  );

  selectCandidate(order: BrokerOrder): void {
    this.targetOrder.set(order);
    this.seedOrderParams(order);
    this.state.set('editing');
  }

  /** Seed the form's order params from the selected stop (or defaults). */
  private seedOrderParams(order: BrokerOrder | null): void {
    this.formTimeInForce.set(toEquityTimeInForce(order?.timeInForce) ?? 'gtc');
    this.formMarketHours.set(toEquityMarketHours(order?.marketHours) ?? 'regular_hours');
  }

  async onSubmit(event: StopLossSubmit): Promise<void> {
    if (this.state() === 'submitting') return;
    this.lastStopPrice.set(event.stopPrice);
    // marketHours is pinned, not forwarded: RH rejects stop orders outside
    // regular hours — a bound extended/all-day prefill (update mode) would
    // 400 the order the same way it would a fresh stop (#886).
    const params = { timeInForce: event.timeInForce, marketHours: 'regular_hours' as const };
    const target = this.targetOrder();
    // Update mode without a target must not fall through to placing a NEW
    // stop under an Update title (guarded upstream; belt-and-suspenders).
    if (this.isUpdate) {
      if (!target) return;
      this.lastTicket = buildStopLossUpdateTicket(
        this.symbol,
        this.quantity,
        event.stopPrice,
        this.accountNumber,
        target.orderId,
        params,
      );
      await this.submitUpdate(target.orderId);
      return;
    }
    this.lastTicket = buildPositionStopLossTicket(
      this.symbol,
      this.quantity,
      event.stopPrice,
      this.accountNumber,
      params,
    );
    await this.submitTicket();
  }

  async onRetry(): Promise<void> {
    if (this.state() === 'submitting' || !this.lastTicket) return;
    // A cancel-phase failure means the old order may still be live — retry the
    // whole primitive on the same ticket. A place-phase failure means the old
    // order is gone — re-place the retained ticket via submitEquityOrder;
    // re-cancelling would fail (nothing left to cancel).
    const target = this.targetOrder();
    if (this.isUpdate && this.result()?.phase === 'cancel' && target) {
      await this.submitUpdate(target.orderId);
      return;
    }
    // PLACEMENT_DEAD (update mode): the dead placement likely consumed the
    // refId — mint a fresh one or the broker dedups the retry onto the dead
    // order instead of placing anew.
    if (this.isUpdate && this.result()?.error?.code === PLACEMENT_DEAD_CODE) {
      this.lastTicket = { ...this.lastTicket, refId: crypto.randomUUID() };
    }
    await this.submitTicket();
  }

  /** Submit the last built ticket to the broker and transition to success/error state. */
  private async submitTicket(): Promise<void> {
    await this.runSubmission(
      () => this.orderExecution.submitEquityOrder(this.lastTicket!),
      'place',
    );
  }

  /** Update mode: cancel the target stop and place the retained ticket via
   *  the guarded primitive (cancel → confirm-poll → bounded replacement). */
  private async submitUpdate(orderId: string): Promise<void> {
    await this.runSubmission(
      () => this.orderExecution.updateEquityStopOrder(this.accountNumber, orderId, this.lastTicket!),
      'cancel',
    );
  }

  /** Shared submit wrapper: transitions state, sets disableClose, captures
   *  tool-level and thrown errors into `result`. `updateFallbackPhase` stamps
   *  the phase contract onto update-mode failures that arrive without it —
   *  'place' for bare re-places, 'cancel' for the primitive (unknown throw
   *  point → re-running cancel-first can never create a duplicate). */
  private async runSubmission(
    submit: () => Promise<ExecutionResult>,
    updateFallbackPhase: 'cancel' | 'place',
  ): Promise<void> {
    if (!this.lastTicket) return;
    this.state.set('submitting');
    // Once a submission runs, ESC/backdrop must stay disabled — a dismiss
    // resolves afterClosed with undefined (no refresh) while the attempt may
    // have registered broker-side. Cancel/Done close true and stay available.
    this.dialogRef.disableClose = true;
    try {
      const res = await submit();
      this.result.set(
        this.isUpdate && updateFallbackPhase === 'place' && !res.success
          ? asUpdatePlaceFailure(res)
          : res,
      );
      this.state.set(res.success ? 'success' : 'error');
    } catch (e) {
      this.result.set({
        success: false,
        error: { message: e instanceof Error ? e.message : String(e), retryable: true },
        ...(this.isUpdate
          ? { phase: updateFallbackPhase, unprotected: updateFallbackPhase === 'place' }
          : {}),
      });
      this.state.set('error');
    }
  }

  onDone(): void {
    this.dialogRef.close(true);
  }

  onCancel(): void {
    // Once a submission ran, the outcome may have registered broker-side
    // (success, lost-ack, ref-id conflict) — close true so the dashboard
    // refreshes rather than reopening a stale position view.
    this.dialogRef.close(this.lastTicket !== null);
  }
}
