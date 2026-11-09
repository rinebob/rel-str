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
import { Component, inject, signal, computed, viewChild, ChangeDetectionStrategy } from '@angular/core';
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
import { PeakPoint, PositionPeak } from '../../utils/position-peak.util';
import { DEFAULT_STOP_PERCENT, stopPercentFromPrice } from '../../../../shared/utils/stop-loss-math.util';

export interface StopLossDialogData {
  position: EquityPosition;
  currentPrice: number;
  accountNumber: string;
  /** Decision context (#1415): the symbol's derived peak record. Undefined
   *  while the derive hasn't landed — pair with `peaksPending`. */
  peak?: PositionPeak | null;
  /** True while the symbol's peak is still being derived — chain shows '…'. */
  peaksPending?: boolean;
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

  // ========================================
  // Decision context (#1415)
  // ========================================

  /** The embedded form — resolves only while state() is 'editing'. */
  private readonly form = viewChild(StopLossFormComponent);

  /** Exposed for the template's "8% below peak" suggestion copy. */
  readonly DEFAULT_STOP_PERCENT = DEFAULT_STOP_PERCENT;

  /** Live proposed stop — tracks the form's price field as the user types. */
  readonly proposedStop = computed((): number | null => {
    const raw = this.form()?.stopLossPrice();
    if (!raw) return null;
    const price = parseFloat(raw);
    return Number.isFinite(price) && price > 0 ? price : null;
  });

  // --- Story chain anchors ---
  readonly entryPrice = computed((): number | null => this.data.position.averageBuyPrice);
  /** Holding-period entry date — annotates the Entry node so "Peak Since
   *  Entry" carries its anchor. */
  readonly entryDate = computed((): string | null => this.data.peak?.entryDate ?? null);
  /** currentPrice of 0 = no quote — every metric must settle to '—',
   *  never compute a fabricated 100% retracement or total loss. */
  private get quotedPrice(): number | null {
    return this.data.currentPrice > 0 ? this.data.currentPrice : null;
  }
  readonly peakPoint = computed((): PeakPoint | null => this.data.peak?.lifetime ?? null);
  readonly sinceLastFillPeak = computed((): PeakPoint | null => this.data.peak?.sinceLastFill ?? null);
  /** Both peaks surface when they differ — the add-on-ratchet case. */
  readonly showBothPeaks = computed((): boolean => {
    const life = this.peakPoint();
    const last = this.sinceLastFillPeak();
    return life !== null && last !== null && life.price !== last.price;
  });
  readonly currentStopPrice = computed((): number | null => this.targetOrder()?.stopPrice ?? null);
  readonly peakPending = computed((): boolean => this.data.peaksPending === true);

  // --- Metrics ---
  /** % pulled back from the lifetime peak — table parity (positive = drawdown). */
  readonly retracedPct = computed((): number | null => {
    const peak = this.peakPoint()?.price;
    const cur = this.quotedPrice;
    if (peak == null || peak === 0 || cur === null) return null;
    return ((peak - cur) / peak) * 100;
  });
  readonly proposedVsCurrent = computed((): { dollars: number; percent: number } | null => {
    const p = this.proposedStop();
    const cur = this.quotedPrice;
    if (p === null || cur === null) return null;
    return { dollars: p - cur, percent: ((p - cur) / cur) * 100 };
  });
  readonly proposedVsPeak = computed((): { dollars: number; percent: number } | null => {
    const p = this.proposedStop();
    const peak = this.peakPoint()?.price;
    if (p === null || peak == null || peak === 0) return null;
    return { dollars: p - peak, percent: ((p - peak) / peak) * 100 };
  });
  /** Gain/loss locked in if the proposed stop fills vs cost basis. Uses the
   *  stop ORDER's qty in update mode (a partial stop locks only that many
   *  shares); add mode uses the whole-share position qty. */
  readonly lockedIn = computed((): { dollars: number; percent: number } | null => {
    const p = this.proposedStop();
    const avg = this.data.position.averageBuyPrice;
    const qty = this.targetOrder()?.quantity ?? Math.trunc(this.data.position.quantity ?? 0);
    if (p === null || avg == null || avg === 0 || qty === 0) return null;
    return { dollars: (p - avg) * qty, percent: ((p - avg) / avg) * 100 };
  });

  // --- Position context ---
  readonly positionQty = computed((): number | null => this.data.position.quantity);
  readonly costBasis = computed((): number | null => {
    const qty = this.data.position.quantity;
    const avg = this.data.position.averageBuyPrice;
    return qty != null && avg != null ? qty * avg : null;
  });
  readonly marketValue = computed((): number | null => {
    const qty = this.data.position.quantity;
    const cur = this.quotedPrice;
    return qty != null && cur !== null ? qty * cur : null;
  });
  readonly unrealizedPnl = computed((): { dollars: number; percent: number } | null => {
    const qty = this.data.position.quantity;
    const avg = this.data.position.averageBuyPrice;
    const cur = this.quotedPrice;
    if (qty == null || avg == null || avg === 0 || cur === null) return null;
    return { dollars: (cur - avg) * qty, percent: ((cur - avg) / avg) * 100 };
  });

  /** Strategy suggestion — DEFAULT_STOP_PERCENT below the lifetime peak
   *  (the #890 ratchet candidate). Null when no peak is derivable. */
  readonly suggestedStop = computed((): number | null => {
    const peak = this.peakPoint()?.price;
    if (peak == null) return null;
    return peak * (1 - DEFAULT_STOP_PERCENT / 100);
  });
  /** Current price is already below the suggested level — a sell stop at
   *  the suggestion would trigger immediately; the honest recommendation
   *  is to close the position (the user's stated rule). */
  readonly belowRatchetLevel = computed((): boolean => {
    const s = this.suggestedStop();
    const cur = this.quotedPrice;
    return s !== null && cur !== null && cur < s;
  });

  /** Update-mode prefill (#1415, user's rule): the proposed stop defaults
   *  to the ratchet candidate — max(current stop, 8%-below-peak) — so a
   *  reflexive Update tightens to strategy level but can never loosen.
   *  Below-ratchet (suggestion above market) keeps the current stop: the
   *  honest proposal there is close-the-position, shown as the warning. */
  readonly initialStopPrice = computed((): number | null => {
    if (!this.isUpdate) return null;
    const cur = this.targetOrder()?.stopPrice ?? null;
    const s = this.suggestedStop();
    if (s === null || this.belowRatchetLevel()) return cur;
    return cur === null ? s : Math.max(cur, s);
  });

  /** Show the Use button only when the proposed value has drifted from the
   *  suggestion — when they already agree the button does nothing, and the
   *  row is just the anchor rationale. Half-cent tolerance: suggested is
   *  unrounded float, proposed is the form's 2-decimal string. */
  readonly showUseSuggested = computed((): boolean => {
    const s = this.suggestedStop();
    const p = this.proposedStop();
    return s !== null && p !== null && Math.abs(p - s) >= 0.005;
  });

  /** Seed the form's price + percent to the suggestion. The percent stays
   *  consistent with the form's bidirectional linking convention. */
  useSuggested(): void {
    const f = this.form();
    const s = this.suggestedStop();
    if (!f || s === null) return;
    f.stopLossPrice.set(s.toFixed(2));
    const ref = this.quotedPrice;
    if (ref !== null) {
      const pct = stopPercentFromPrice(ref, s);
      if (Number.isFinite(pct) && pct >= 0) {
        f.stopLossPercent.set(String(Math.round(pct * 10) / 10));
      }
    }
  }

  /** Live order params on the target stop — update mode only. */
  readonly orderContext = computed((): {
    quantity: number | null;
    timeInForce: string | null;
    createdAt: string | null;
  } | null => {
    const order = this.targetOrder();
    if (!order) return null;
    return {
      quantity: order.quantity ?? null,
      timeInForce: order.timeInForce ?? null,
      createdAt: order.createdAt ?? null,
    };
  });

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

  // --- Formatting helpers (context section) ---
  private readonly usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });
  fmtUsd(v: number | null | undefined): string {
    return v == null ? '—' : this.usd.format(v);
  }
  fmtSignedUsd(v: number | null | undefined): string {
    if (v == null) return '—';
    const s = this.usd.format(Math.abs(v));
    return v < 0 ? `−${s}` : `+${s}`;
  }
  fmtPct(v: number | null | undefined): string {
    return v == null ? '—' : `${v.toFixed(1)}%`;
  }
  fmtSignedDist(d: { dollars: number; percent: number } | null): string {
    if (!d) return '—';
    return `${this.fmtSignedUsd(d.dollars)} (${d.percent.toFixed(1)}%)`;
  }
  /** Directional distance — "$10.00 (5.7%) below" / "$4.00 (2.1%) above". */
  fmtDistWord(d: { dollars: number; percent: number } | null): string {
    if (!d) return '—';
    const dir = d.dollars <= 0 ? 'below' : 'above';
    return `${this.fmtUsd(Math.abs(d.dollars))} (${Math.abs(d.percent).toFixed(1)}%) ${dir}`;
  }
  fmtDay(iso: string | null | undefined): string {
    return iso ? iso.slice(0, 10) : '—';
  }
  /** ISO date with weekday — "Mon, 2026-09-28". Parses at local noon so
   *  bare YYYY-MM-DD strings don't shift a day behind in US timezones. */
  fmtDayDow(iso: string | null | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
    if (isNaN(d.getTime())) return this.fmtDay(iso);
    const dow = d.toLocaleDateString('en-US', { weekday: 'short' });
    return `${dow}, ${this.fmtDay(iso)}`;
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
