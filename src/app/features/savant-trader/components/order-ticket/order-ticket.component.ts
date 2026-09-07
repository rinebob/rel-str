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
  output,
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
import {
  buildFractionalCloseIntent,
  buildStopLossIntent,
} from '../../utils/stop-loss-intent.util';
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

  /** Emitted when a new position-management intent is staged for ticket editing. */
  readonly intentStaged = output<string>();

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

  /** Tracks which intent the stop loss was last initialized for. */
  private lastStopLossIntentId: string | null = null;

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

  /** Whether the selected intent is a linked stop-loss order. */
  readonly isStopLossIntent = computed(() => this.intent()?.sourceRef?.type === 'stop_loss');

  /** Whether the selected intent closes a fractional remainder. */
  readonly isFractionalCloseIntent = computed(() => this.intent()?.sourceRef?.type === 'fractional_close');

  /** Stop price for the selected stop-loss intent. */
  readonly selectedStopPrice = computed(() => {
    const i = this.intent();
    return i && 'stopPrice' in i ? i.stopPrice ?? null : null;
  });

  /** Price used to calculate the stop-loss percentage. */
  readonly stopLossReferencePrice = computed<number | null>(() =>
    this.entryFillPrice() ?? (() => {
      const fill = this.protectedEntry()?.result?.fillPrice;
      const parsed = fill ? parseFloat(fill) : NaN;
      return Number.isFinite(parsed) ? parsed : this.currentPrice();
    })(),
  );

  /** Whether the selected staged stop-loss has valid controls for submission. */
  readonly canSubmitStopLossIntent = computed(() => {
    const i = this.intent();
    return this.isStopLossIntent() && i?.status === OrderIntentStatus.STAGED &&
      this.wholeQuantity() > 0 && parseFloat(this.stopLossPrice()) > 0;
  });

  /** The entry/position protected by the selected stop-loss intent. */
  readonly protectedEntry = computed<OrderIntent | null>(() => {
    const parentId = this.intent()?.sourceRef?.id;
    if (!parentId) return null;
    return this.stagingStore.intents()[parentId] ?? null;
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
    return s === OrderIntentStatus.SUBMITTED || s === OrderIntentStatus.QUEUED || s === OrderIntentStatus.RESTING || s === OrderIntentStatus.SUBMITTING;
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

  /** Fractional positions cannot use Robinhood equity stop-loss orders. */
  readonly isFractionalEntry = computed(() => {
    const i = this.intent();
    const rawQuantity = i?.result?.filledQuantity ?? i?.quantity;
    const quantity = rawQuantity ? Number(rawQuantity) : 0;
    return quantity > 0 && Number.isFinite(quantity) && !Number.isInteger(quantity);
  });

  /** Fractional remainder to sell to leave an integer-share position. */
  readonly fractionalQuantity = computed(() => {
    const i = this.intent();
    const rawQuantity = i?.result?.filledQuantity ?? i?.quantity;
    const quantity = rawQuantity ? Number(rawQuantity) : 0;
    if (!Number.isFinite(quantity) || quantity <= 0 || Number.isInteger(quantity)) return '0';
    return (quantity - Math.floor(quantity)).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  });

  /** Whether to show the stop loss section — only for whole-share equity buys that have been filled. */
  readonly showStopLossSection = computed(() => {
    const i = this.intent();
    if (!i) return false;
    if (i.side !== 'buy') return false;
    if (i.instrumentType !== InstrumentType.EQUITY && i.instrumentType !== InstrumentType.ETF) return false;
    return this.isEntryFilled() && !this.isFractionalEntry() && !this.stopLossExists();
  });

  /** Whether the stop loss can be placed — entry must be filled, qty must be positive, and stop loss price must be valid. */
  readonly canPlaceStopLoss = computed(() => {
    if (!this.isEntryFilled()) return false;
    const i = this.intent();
    const rawQuantity = i?.result?.filledQuantity ?? i?.quantity ?? '0';
    const quantity = Number(rawQuantity);
    const slPrice = parseFloat(this.stopLossPrice());
    return Number.isInteger(quantity) && quantity > 0 && !isNaN(slPrice) && slPrice > 0;
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

  /** Stop price from the linked stop-loss intent. */
  readonly protectedStopPrice = computed(() => {
    const stopLoss = this.stopLossIntent();
    return stopLoss && 'stopPrice' in stopLoss ? stopLoss.stopPrice ?? null : null;
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
    this.stopLossIntent()?.status === OrderIntentStatus.SUBMITTED ||
    this.stopLossIntent()?.status === OrderIntentStatus.QUEUED ||
    this.stopLossIntent()?.status === OrderIntentStatus.RESTING,
  );

  /** Preview of the stop loss order object (shows real account number — what will actually be sent). */
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
      case OrderIntentStatus.QUEUED: return 'schedule';
      case OrderIntentStatus.FILLED: return 'task_alt';
      case OrderIntentStatus.FAILED: return 'error_outline';
      case OrderIntentStatus.CANCELLED: return 'cancel';
      default: return 'help_outline';
    }
  });

  /** Live preview of the order to be submitted (shows real account number — what will actually be sent). */
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
        this.orderType.set(i.orderType === 'stop_loss' ? 'stop_market' : i.orderType);
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
        if (!price || price <= 0 || !i || this.isFractionalCloseIntent()) return;
        // Only auto-calc if the user hasn't set a quantity yet
        const currentQty = this.wholeQuantity();
        if (currentQty > 0) return;
        const dda = this.defaultDollarAmount();
        const sizing = computePositionSize(price, dda);
        this.quantity.set(String(sizing.shares));
      });
    });

    // Default limit/stop price to current price when the field becomes visible and is empty
    effect(() => {
      const price = this.price();
      const showLimit = this.showLimitPrice();
      const showStop = this.showStopPrice();
      untracked(() => {
        if (!price || price <= 0) return;
        if (showLimit && !this.limitPrice()) {
          this.limitPrice.set(price.toFixed(2));
        }
        if (showStop && !this.stopPrice()) {
          this.stopPrice.set(price.toFixed(2));
        }
      });
    });

    // When entry fills or selection changes to a filled intent, initialize stop loss
    // from the fill price and default percent. Recalculates directly on intent change.
    effect(() => {
      const i = this.intent();
      const fillPrice = this.entryFillPrice();
      untracked(() => {
        if (!i || !fillPrice || fillPrice <= 0) return;
        // Only initialize when the intent changes — preserve user edits otherwise
        if (this.lastStopLossIntentId === i.id) return;
        this.lastStopLossIntentId = i.id;
        this.stopLossPercent.set(String(DEFAULT_STOP_PERCENT));
        this.stopLossPrice.set(stopPriceFromPercent(fillPrice, DEFAULT_STOP_PERCENT).toFixed(2));
      });
    });

    // Recompute the entry stop price from percent when the user edits an entry ticket.
    // A selected stop-loss ticket owns its persisted stop price and initializes below.
    effect(() => {
      const percent = parseFloat(this.stopLossPercent());
      const refPrice = this.stopLossReferencePrice();
      const isStopLoss = this.isStopLossIntent();
      untracked(() => {
        if (!isStopLoss && refPrice && refPrice > 0 && !isNaN(percent) && percent > 0) {
          this.stopLossPrice.set(stopPriceFromPercent(refPrice, percent).toFixed(2));
        }
      });
    });

    // Initialize the dedicated stop-loss controls from the persisted stop price.
    effect(() => {
      const i = this.intent();
      const refPrice = this.stopLossReferencePrice();
      untracked(() => {
        if (!i || !this.isStopLossIntent() || !refPrice || refPrice <= 0) return;
        const persistedStop = 'stopPrice' in i ? i.stopPrice : undefined;
        if (persistedStop) this.stopLossPrice.set(persistedStop);
        const percent = persistedStop ? stopPercentFromPrice(refPrice, parseFloat(persistedStop)) : DEFAULT_STOP_PERCENT;
        if (Number.isFinite(percent) && percent > 0) this.stopLossPercent.set(String(percent));
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
      partial.quantity = this.isFractionalCloseIntent() ? this.quantity() : q > 0 ? String(q) : undefined;
      // Clear dollarAmount with null (not undefined) so Firestore actually removes it.
      // undefined gets stripped by stripUndefined, leaving the stale value in Firestore.
      partial.dollarAmount = null;
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
    if (this.isFractionalCloseIntent() && this.marketHours() !== 'regular_hours') {
      this.snackBar.open('Fractional orders are only allowed during regular hours', 'Dismiss', { duration: 5000 });
      return;
    }

    const numericQuantity = Number(this.quantity());
    const quantityValid = this.isFractionalCloseIntent()
      ? Number.isFinite(numericQuantity) && numericQuantity > 0
      : this.wholeQuantity() > 0;
    if (!quantityValid) {
      this.snackBar.open(
        this.isFractionalCloseIntent() ? 'Quantity must be positive' : 'Quantity must be a positive whole number of shares',
        'Dismiss',
        { duration: 4000 },
      );
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

  /** Confirm and submit an existing staged stop-loss intent. */
  async onSubmitStopLossIntent(): Promise<void> {
    const i = this.intent();
    if (!i || !this.isStopLossIntent() || i.status !== OrderIntentStatus.STAGED) return;
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { intent: i, warnings: [] },
          width: '400px',
        })
        .afterClosed(),
    );
    if (confirmed) {
      this.stagingStore.updateAndSubmitIntent(i.id, { stopPrice: this.stopLossPrice() });
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
    if (i.status !== OrderIntentStatus.SUBMITTED && i.status !== OrderIntentStatus.QUEUED && i.status !== OrderIntentStatus.RESTING && i.status !== OrderIntentStatus.SUBMITTING) return;
    this.stagingStore.cancelIntent(i.id);
  }

  /** Manually reconcile an intent by querying the broker. */
  onReconcile(): void {
    const i = this.intent();
    if (!i) return;
    const canReconcile = i.status === OrderIntentStatus.SUBMITTED ||
      i.status === OrderIntentStatus.QUEUED ||
      i.status === OrderIntentStatus.RESTING ||
      i.status === OrderIntentStatus.SUBMITTING ||
      (i.status === OrderIntentStatus.FAILED && !!i.result?.orderId);
    if (!canReconcile) return;
    this.snackBar.open('Checking broker for latest status…', '', { duration: 3000 });
    this.stagingStore.reconcileIntent(i.id);
  }

  /** Modify a submitted intent — reverts to STAGED so the user can edit and resubmit. */
  onModify(): void {
    const i = this.intent();
    if (!i || (i.status !== OrderIntentStatus.SUBMITTED && i.status !== OrderIntentStatus.QUEUED && i.status !== OrderIntentStatus.RESTING)) return;
    this.stagingStore.modifyIntent(i.id);
  }

  /** Cancel a submitted stop loss intent. */
  onCancelStopLoss(): void {
    const sl = this.stopLossIntent();
    if (!sl) return;
    if (sl.status !== OrderIntentStatus.SUBMITTED && sl.status !== OrderIntentStatus.QUEUED && sl.status !== OrderIntentStatus.RESTING && sl.status !== OrderIntentStatus.SUBMITTING) return;
    this.stagingStore.cancelIntent(sl.id);
  }

  /** New Manual Order placeholder. */
  onNewManualOrder(): void {
    this.snackBar.open('Manual order creation coming soon', 'Dismiss', { duration: 3000 });
  }

  /** Stage a market sell for the fractional remainder in the editable order ticket. */
  onCloseFractionalShare(): void {
    const i = this.intent();
    const quantity = this.fractionalQuantity();
    if (!i || !this.isEntryFilled() || !this.isFractionalEntry() || quantity === '0') return;

    const closeIntent = buildFractionalCloseIntent(
      i,
      this.symbol(),
      quantity,
      this.tradingConfig()?.accountNumber ?? i.accountNumber,
    );
    this.stagingStore.archiveFailedFractionalCloseIntents(i.id);
    this.stagingStore.stageIntent(closeIntent);
    this.intentStaged.emit(closeIntent.id);
    this.snackBar.open(`Fractional close staged for ${quantity} shares — choose order hours`, 'Dismiss', { duration: 3000 });
  }

  /** Confirm, persist, and submit a stop loss order for the current entry. */
  async onPlaceStopLoss(): Promise<void> {
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
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { intent: stopLossIntent, warnings: [] },
          width: '400px',
        })
        .afterClosed(),
    );
    if (!confirmed) return;

    this.stagingStore.stageAndSubmitIntent(stopLossIntent);
    this.snackBar.open('Stop loss order submitted', 'Dismiss', { duration: 3000 });
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
    if (this.isFractionalCloseIntent()) {
      const qty = Number(raw);
      this.quantity.set(Number.isFinite(qty) && qty >= 0 ? raw : '');
      return;
    }
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

  limitUp(): void { this.stepPrice(this.limitPrice, 0.25); }
  limitDown(): void { this.stepPrice(this.limitPrice, -0.25); }
  stopUp(): void { this.stepPrice(this.stopPrice, 0.25); }
  stopDown(): void { this.stepPrice(this.stopPrice, -0.25); }

  /** Stepper for price fields — increment by delta, avoid round endings (0 or 5). */
  private stepPrice(field: WritableSignal<string>, delta: number): void {
    const current = parseFloat(field()) || 0;
    let next = Math.max(0, Math.round((current + delta) * 100) / 100);
    // Nudge to avoid hundredths ending in 0 or 5 (round-looking prices)
    const cents = Math.round(next * 100) % 10;
    if (cents === 0 || cents === 5) {
      next = Math.max(0, Math.round((next + 0.02) * 100) / 100);
    }
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
    const price = this.stopLossReferencePrice();
    const slPrice = parseFloat(this.stopLossPrice());
    if (price && price > 0 && !isNaN(slPrice)) {
      const pct = stopPercentFromPrice(price, slPrice);
      this.stopLossPercent.set(String(pct));
    }
  }

  /** User typed in the stop loss percent field — update price. */
  onStopPercentInput(): void {
    const price = this.stopLossReferencePrice();
    const pct = parseFloat(this.stopLossPercent());
    if (price && price > 0 && !isNaN(pct)) {
      const slPrice = stopPriceFromPercent(price, pct);
      this.stopLossPrice.set(slPrice.toFixed(2));
    }
  }

  /** Stepper up on stop loss price — increment by $0.25. */
  stopPriceUp(): void {
    this.stepPrice(this.stopLossPrice, 0.25);
    this.onStopPriceInput();
  }

  /** Stepper down on stop loss price — decrement by $0.25. */
  stopPriceDown(): void {
    this.stepPrice(this.stopLossPrice, -0.25);
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
