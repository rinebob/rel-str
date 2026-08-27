/**
 * Order Ticket Component
 *
 * Right panel of the signal order screen. Full order configuration for the
 * selected intent. All Robinhood parameters editable. Live preview of what
 * will be sent. Submit with confirmation dialog. Execution status feedback
 * with error display and retry. Cancel for submitted orders.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §8 (Signal order screen — ticket)
 */
import {
  Component,
  inject,
  input,
  computed,
  signal,
  WritableSignal,
  ChangeDetectionStrategy,
  effect,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { OrderStagingStore } from '../../stores/order-staging.store';
import { OrderConfirmDialogComponent } from '../order-confirm-dialog/order-confirm-dialog.component';
import { evaluateOrderGuardrails, GuardrailContext } from '../../utils/order-guardrails.util';
import { buildStopLossIntent } from '../../utils/stop-loss-intent.util';
import {
  OrderIntent,
  OrderIntentStatus,
  InstrumentType,
  TradingConfig,
} from '../../services/order-intent.types';
import {
  computePositionSize,
  computeUnits,
  stopPriceFromPercent,
  stopPercentFromPrice,
  DEFAULT_STOP_PERCENT,
} from '../../utils/position-sizing.util';

@Component({
  selector: 'app-order-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './order-ticket.component.html',
  styleUrl: './order-ticket.component.scss',
})
export class OrderTicketComponent {
  private readonly stagingStore = inject(OrderStagingStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** The selected intent to configure. */
  intent = input<OrderIntent | null>(null);

  /** Current price for the intent's symbol (from price service). */
  price = input<number | null>(null);

  /** Trading config (passed from parent page). */
  tradingConfig = input<TradingConfig | null>(null);

  /** Guardrail context from the page (current exposure, units, cash). */
  guardrailContext = input<GuardrailContext | null>(null);

  /** Local editable copy of the intent fields. */
  readonly orderType = signal<'market' | 'limit' | 'stop_market' | 'stop_limit'>('market');
  readonly quantity = signal<string>('');
  readonly limitPrice = signal<string>('');
  readonly stopPrice = signal<string>('');
  readonly timeInForce = signal<'gfd' | 'gtc'>('gfd');
  readonly marketHours = signal<'regular_hours' | 'extended_hours' | 'all_day_hours'>('regular_hours');

  /** Stop loss fields — bidirectionally linked. */
  readonly stopLossPrice = signal<string>('');
  readonly stopLossPercent = signal<string>(String(DEFAULT_STOP_PERCENT));

  /** Expose enum for template. */
  readonly OrderIntentStatus = OrderIntentStatus;

  /** Default dollar amount from config. */
  readonly defaultDollarAmount = computed(() => this.tradingConfig()?.defaultDollarAmount ?? 100);

  /** Current price for the symbol (from input). */
  readonly currentPrice = computed(() => this.price());

  /** Whole-share quantity (non-negative integer) for calculations. */
  private wholeQuantity(): number {
    return Math.max(0, parseInt(this.quantity(), 10) || 0);
  }

  /** Computed units for the current quantity and price. */
  readonly computedUnits = computed(() => {
    const qty = this.wholeQuantity();
    const price = this.currentPrice();
    const dda = this.defaultDollarAmount();
    if (qty <= 0 || price === null || price <= 0 || dda <= 0) return 0;
    return computeUnits(qty, price, dda);
  });

  /** Computed actual cost for the current quantity and price. */
  readonly actualCost = computed(() => {
    const qty = this.wholeQuantity();
    const price = this.currentPrice();
    if (qty <= 0 || price === null || price <= 0) return 0;
    return Math.round(qty * price * 100) / 100;
  });

  /** Display symbol for the intent. */
  readonly symbol = computed(() => {
    const i = this.intent();
    if (!i) return '';
    if (i.instrumentType === InstrumentType.OPTION) return i.legs[0]?.symbol ?? '?';
    return i.symbol;
  });

  /** Whether the intent is in an editable state. */
  readonly isEditable = computed(() => {
    const s = this.intent()?.status;
    return s === OrderIntentStatus.STAGED || s === OrderIntentStatus.READY || s === OrderIntentStatus.FAILED;
  });

  /** Whether the intent is currently being submitted. */
  readonly isSubmitting = computed(() => this.intent()?.status === OrderIntentStatus.SUBMITTING);

  /** Whether the intent is submitted and awaiting fill (or submitting). */
  readonly isSubmitted = computed(() => {
    const s = this.intent()?.status;
    return s === OrderIntentStatus.SUBMITTED || s === OrderIntentStatus.SUBMITTING;
  });

  /** Whether the intent is in a terminal state. */
  readonly isTerminal = computed(() => {
    const s = this.intent()?.status;
    return s === OrderIntentStatus.FILLED || s === OrderIntentStatus.CANCELLED;
  });

  /** Whether the entry order has been filled (enables stop loss placement). */
  readonly isEntryFilled = computed(() => {
    return this.intent()?.status === OrderIntentStatus.FILLED;
  });

  /** Whether to show the stop loss section — only for equity buy orders. */
  readonly showStopLossSection = computed(() => {
    const i = this.intent();
    if (!i) return false;
    if (i.side !== 'buy') return false;
    if (i.instrumentType !== InstrumentType.EQUITY && i.instrumentType !== InstrumentType.ETF) return false;
    return true;
  });

  /** Whether the stop loss can be placed — entry must be filled, qty must be positive, and stop loss price must be valid. */
  readonly canPlaceStopLoss = computed(() => {
    if (!this.isEntryFilled()) return false;
    const i = this.intent();
    const qty = Math.max(0, parseInt(i?.result?.filledQuantity ?? i?.quantity ?? '0', 10) || 0);
    const slPrice = parseFloat(this.stopLossPrice());
    return qty > 0 && !isNaN(slPrice) && slPrice > 0;
  });

  /** The stop loss intent from the store (linked via sourceRef), if any. */
  readonly stopLossIntent = computed<OrderIntent | null>(() => {
    const i = this.intent();
    if (!i) return null;
    const all = this.stagingStore.intents();
    return Object.values(all).find(
      (intent) => intent.sourceRef?.type === 'stop_loss' && intent.sourceRef?.id === i.id,
    ) ?? null;
  });

  /** Whether a stop loss intent exists in the store. */
  readonly stopLossExists = computed(() => this.stopLossIntent() !== null);

  /** Whether the stop loss order has been filled. */
  readonly isStopLossFilled = computed(() =>
    this.stopLossIntent()?.status === OrderIntentStatus.FILLED,
  );

  /** Whether the stop loss is currently submitting. */
  readonly isStopLossSubmitting = computed(() =>
    this.stopLossIntent()?.status === OrderIntentStatus.SUBMITTING,
  );

  /** Whether the stop loss is submitted and awaiting fill. */
  readonly isStopLossSubmitted = computed(() =>
    this.stopLossIntent()?.status === OrderIntentStatus.SUBMITTED,
  );

  /** Preview of the stop loss order object. */
  readonly stopLossPreview = computed(() => {
    const i = this.intent();
    if (!i || !this.showStopLossSection()) return null;
    const qty = (i.result?.filledQuantity ?? i.quantity) || '0';
    return {
      symbol: this.symbol(),
      side: 'sell',
      orderType: 'stop_market',
      quantity: qty,
      stopPrice: this.stopLossPrice() || undefined,
      stopLossPercent: this.stopLossPercent() || undefined,
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
      accountNumber: this.tradingConfig()?.accountNumber ?? i.accountNumber,
      refId: i.refId + '-SL',
    };
  });

  /** Dollar risk = shares × (fill price − stop loss price). Uses fill price after fill, current price before. */
  readonly stopLossRisk = computed(() => {
    const i = this.intent();
    const rawQty = i?.status === OrderIntentStatus.FILLED ? i.result?.filledQuantity : this.quantity();
    const qty = Math.max(0, parseInt(rawQty ?? '0', 10) || 0);
    const slPrice = parseFloat(this.stopLossPrice());
    if (qty <= 0 || isNaN(slPrice) || slPrice <= 0) return 0;
    const refPrice = this.entryFillPrice() ?? this.currentPrice();
    if (!refPrice || refPrice <= 0) return 0;
    return Math.round(qty * (refPrice - slPrice) * 100) / 100;
  });

  /** Fill price from the entry order result, if filled. */
  readonly entryFillPrice = computed<number | null>(() => {
    const i = this.intent();
    if (!i || i.status !== OrderIntentStatus.FILLED) return null;
    const fp = i.result?.fillPrice;
    return fp ? parseFloat(fp) : null;
  });

  /** Compact entry confirmation data for read-only display. */
  readonly entryConfirmation = computed(() => {
    const i = this.intent();
    if (!i) return null;
    return {
      status: i.status,
      orderType: i.orderType,
      side: i.side,
      quantity: i.quantity ?? this.quantity(),
      fillPrice: i.result?.fillPrice ?? null,
      filledQuantity: i.result?.filledQuantity ?? null,
      orderId: i.result?.orderId ?? null,
      timeInForce: i.timeInForce,
      limitPrice: 'limitPrice' in i ? i.limitPrice ?? null : null,
    };
  });

  /** Compact stop loss confirmation data for read-only display. */
  readonly stopLossConfirmation = computed(() => {
    const sl = this.stopLossIntent();
    if (!sl) return null;
    return {
      status: sl.status,
      stopPrice: sl.stopPrice ?? null,
      quantity: sl.quantity ?? null,
      fillPrice: sl.result?.fillPrice ?? null,
      orderId: sl.result?.orderId ?? null,
    };
  });

  /** Error from the intent (if FAILED). */
  readonly intentError = computed(() => this.intent()?.error ?? null);

  /** Whether the error is retryable. */
  readonly isRetryable = computed(() => this.intentError()?.retryable === true);

  /** Whether limit price field should be shown. */
  readonly showLimitPrice = computed(() => {
    const t = this.orderType();
    return t === 'limit' || t === 'stop_limit';
  });

  /** Whether stop price field should be shown. */
  readonly showStopPrice = computed(() => {
    const t = this.orderType();
    return t === 'stop_market' || t === 'stop_limit';
  });

  /** Whether account is configured. */
  readonly hasAccount = computed(() => !!this.tradingConfig()?.accountNumber);

  /** Icon for the current status. */
  readonly statusIcon = computed(() => {
    const s = this.intent()?.status;
    switch (s) {
      case OrderIntentStatus.STAGED: return 'edit_note';
      case OrderIntentStatus.READY: return 'check_circle_outline';
      case OrderIntentStatus.SUBMITTING: return 'hourglass_empty';
      case OrderIntentStatus.SUBMITTED: return 'pending_actions';
      case OrderIntentStatus.FILLED: return 'task_alt';
      case OrderIntentStatus.FAILED: return 'error_outline';
      case OrderIntentStatus.CANCELLED: return 'cancel';
      default: return 'help_outline';
    }
  });

  /** Live preview of the order to be submitted. */
  readonly preview = computed(() => {
    const i = this.intent();
    if (!i) return null;
    return {
      symbol: this.symbol(),
      side: i.side,
      orderType: this.orderType(),
      quantity: this.quantity() || undefined,
      dollarAmount: undefined,
      limitPrice: this.showLimitPrice() ? this.limitPrice() || undefined : undefined,
      stopPrice: this.showStopPrice() ? this.stopPrice() || undefined : undefined,
      timeInForce: this.timeInForce(),
      marketHours: this.marketHours(),
      accountNumber: this.tradingConfig()?.accountNumber ?? i.accountNumber,
      refId: i.refId,
    };
  });

  constructor() {
    // Sync local editable fields when the intent changes
    effect(() => {
      const i = this.intent();
      untracked(() => {
        if (!i) return;
        this.orderType.set(i.orderType);
        this.timeInForce.set(i.timeInForce);
        this.marketHours.set(i.marketHours);
        if (i.instrumentType === InstrumentType.OPTION) {
          this.quantity.set(i.quantity ?? '');
        } else {
          this.quantity.set(i.quantity ?? '');
          this.limitPrice.set(i.limitPrice ?? '');
          this.stopPrice.set(i.stopPrice ?? '');
        }
      });
    });

    // Auto-calc shares when price loads (if quantity is empty)
    effect(() => {
      const price = this.price();
      const i = this.intent();
      untracked(() => {
        if (!price || price <= 0 || !i) return;
        // Only auto-calc if the user hasn't set a quantity yet
        const currentQty = this.wholeQuantity();
        if (currentQty > 0) return;
        const dda = this.defaultDollarAmount();
        const sizing = computePositionSize(price, dda);
        this.quantity.set(String(sizing.shares));
      });
    });

    // Reset stop-loss to the default percent whenever the selected intent changes
    effect(() => {
      const id = this.intent()?.id;
      untracked(() => {
        if (!id) return;
        this.stopLossPercent.set(String(DEFAULT_STOP_PERCENT));
        this.stopLossPrice.set('');
      });
    });

    // Recompute stop price from the current percent whenever the live price changes
    effect(() => {
      const price = this.price();
      const percent = parseFloat(this.stopLossPercent());
      untracked(() => {
        if (price && price > 0 && !isNaN(percent) && percent > 0) {
          this.stopLossPrice.set(stopPriceFromPercent(price, percent).toFixed(2));
        }
      });
    });
  }

  /** Update the intent in the store with the edited fields. */
  saveEdits(): void {
    const i = this.intent();
    if (!i || !this.isEditable()) return;
    const partial: Record<string, unknown> = {
      orderType: this.orderType(),
      timeInForce: this.timeInForce(),
      marketHours: this.marketHours(),
    };
    if (i.instrumentType === InstrumentType.EQUITY || i.instrumentType === InstrumentType.ETF) {
      const q = this.wholeQuantity();
      partial.quantity = q > 0 ? String(q) : undefined;
      partial.dollarAmount = undefined;
      if (this.showLimitPrice()) partial.limitPrice = this.limitPrice() || undefined;
      if (this.showStopPrice()) partial.stopPrice = this.stopPrice() || undefined;
    }
    this.stagingStore.updateIntent(i.id, partial);
  }

  /** Open confirmation dialog, then submit if confirmed. */
  async onSubmit(): Promise<void> {
    const i = this.intent();
    if (!i) return;

    // Check account and quantity before saving edits
    if (!this.hasAccount()) {
      this.snackBar.open('No account number configured. Set one in settings.', 'Dismiss', { duration: 4000 });
      return;
    }
    if (this.wholeQuantity() <= 0) {
      this.snackBar.open('Quantity must be a positive whole number of shares', 'Dismiss', { duration: 4000 });
      return;
    }

    // Save edits first
    this.saveEdits();

    // Build a snapshot with the edited values for the dialog
    const snapshot = this.preview();

    // Compute guardrail warnings
    const warnings = this.computeWarnings();

    // Open confirmation dialog with the edited snapshot
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { intent: { ...i, ...snapshot }, warnings },
          width: '400px',
        })
        .afterClosed(),
    );

    if (confirmed) {
      this.stagingStore.submitIntent(i.id);
    }
  }

  /** Retry a failed intent. */
  onRetry(): void {
    const i = this.intent();
    if (!i || i.status !== OrderIntentStatus.FAILED || !this.isRetryable()) return;
    this.saveEdits();
    this.stagingStore.retryIntent(i.id);
  }

  /** Cancel a submitted or submitting intent. */
  onCancel(): void {
    const i = this.intent();
    if (!i) return;
    if (i.status !== OrderIntentStatus.SUBMITTED && i.status !== OrderIntentStatus.SUBMITTING) return;
    this.stagingStore.cancelIntent(i.id);
  }

  /** Modify a submitted intent — reverts to STAGED so the user can edit and resubmit. */
  onModify(): void {
    const i = this.intent();
    if (!i || i.status !== OrderIntentStatus.SUBMITTED) return;
    this.stagingStore.modifyIntent(i.id);
  }

  /** Cancel a submitted stop loss intent. */
  onCancelStopLoss(): void {
    const sl = this.stopLossIntent();
    if (!sl) return;
    if (sl.status !== OrderIntentStatus.SUBMITTED && sl.status !== OrderIntentStatus.SUBMITTING) return;
    this.stagingStore.cancelIntent(sl.id);
  }

  /** New Manual Order placeholder. */
  onNewManualOrder(): void {
    this.snackBar.open('Manual order creation coming soon', 'Dismiss', { duration: 3000 });
  }

  /** Stage and submit a stop loss order for the current entry. */
  onPlaceStopLoss(): void {
    const i = this.intent();
    if (!i || !this.canPlaceStopLoss()) return;

    const slPrice = parseFloat(this.stopLossPrice());
    if (isNaN(slPrice) || slPrice <= 0) {
      this.snackBar.open('Invalid stop loss price', 'Dismiss', { duration: 4000 });
      return;
    }

    const quantity = (i.result?.filledQuantity ?? i.quantity) || '0';
    const stopLossIntent = buildStopLossIntent(
      i,
      this.symbol(),
      quantity,
      slPrice,
      this.tradingConfig()?.accountNumber ?? i.accountNumber,
    );

    this.stagingStore.stageIntent(stopLossIntent);
    this.snackBar.open('Stop loss order staged — review in queue', 'Dismiss', { duration: 3000 });
  }

  // ========================================
  // Input and stepper methods
  // ========================================

  setInputValue(field: WritableSignal<string>, event: Event): void {
    field.set((event.target as HTMLInputElement).value);
  }

  /** Whole-share quantity input — keep only non-negative integers. */
  onQuantityInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const qty = Math.max(0, parseInt(raw, 10) || 0);
    this.quantity.set(String(qty));
  }

  onStopPriceChange(event: Event): void {
    this.setInputValue(this.stopLossPrice, event);
    this.onStopPriceInput();
  }

  onStopPercentChange(event: Event): void {
    this.setInputValue(this.stopLossPercent, event);
    this.onStopPercentInput();
  }

  qtyUp(): void {
    const current = parseInt(this.quantity(), 10) || 0;
    this.quantity.set(String(current + 1));
  }

  qtyDown(): void {
    const current = parseInt(this.quantity(), 10) || 0;
    this.quantity.set(String(Math.max(0, current - 1)));
  }

  limitUp(): void { this.stepPrice(this.limitPrice, 0.05); }
  limitDown(): void { this.stepPrice(this.limitPrice, -0.05); }
  stopUp(): void { this.stepPrice(this.stopPrice, 0.05); }
  stopDown(): void { this.stepPrice(this.stopPrice, -0.05); }

  /** Stepper for price fields — increment by delta, rounded to 2 decimals. */
  private stepPrice(field: WritableSignal<string>, delta: number): void {
    const current = parseFloat(field()) || 0;
    const next = Math.max(0, Math.round((current + delta) * 100) / 100);
    field.set(next.toFixed(2));
  }

  // ========================================
  // Guardrails
  // ========================================

  /** Compute guardrail warnings for the current order. */
  private computeWarnings() {
    const context = this.guardrailContext();
    const side = this.intent()?.side ?? 'buy';
    return context ? evaluateOrderGuardrails(context, this.actualCost(), this.computedUnits(), side) : [];
  }

  // ========================================
  // Stop loss price/percent bidirectional sync
  // ========================================

  /** User typed in the stop loss price field — update percent. */
  onStopPriceInput(): void {
    const price = this.currentPrice();
    const slPrice = parseFloat(this.stopLossPrice());
    if (price && price > 0 && !isNaN(slPrice)) {
      const pct = stopPercentFromPrice(price, slPrice);
      this.stopLossPercent.set(String(pct));
    }
  }

  /** User typed in the stop loss percent field — update price. */
  onStopPercentInput(): void {
    const price = this.currentPrice();
    const pct = parseFloat(this.stopLossPercent());
    if (price && price > 0 && !isNaN(pct)) {
      const slPrice = stopPriceFromPercent(price, pct);
      this.stopLossPrice.set(slPrice.toFixed(2));
    }
  }

  /** Stepper up on stop loss price — increment by $0.05. */
  stopPriceUp(): void {
    this.stepPrice(this.stopLossPrice, 0.05);
    this.onStopPriceInput();
  }

  /** Stepper down on stop loss price — decrement by $0.05. */
  stopPriceDown(): void {
    this.stepPrice(this.stopLossPrice, -0.05);
    this.onStopPriceInput();
  }

  /** Stepper up on stop loss percent — increment by 0.5%. */
  stopPercentUp(): void {
    this.stepPercent(this.stopLossPercent, 0.5);
    this.onStopPercentInput();
  }

  /** Stepper down on stop loss percent — decrement by 0.5%. */
  stopPercentDown(): void {
    this.stepPercent(this.stopLossPercent, -0.5);
    this.onStopPercentInput();
  }

  /** Stepper for percent fields — increment by delta, rounded to 1 decimal. */
  private stepPercent(field: WritableSignal<string>, delta: number): void {
    const current = parseFloat(field()) || 0;
    const next = Math.max(0, Math.round((current + delta) * 10) / 10);
    field.set(String(next));
  }
}
