/**
 * Order Ticket Component
 *
 * Right panel of the signal order screen. Full order configuration for the
 * selected ticket. All Robinhood parameters editable. Live preview of what
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

import { OrderTicketStore } from '../../stores/order-ticket.store';
import { OrderExecutionService } from '../../services/order-execution.service';
import { PaperTradingService } from '../../services/paper-trading.service';
import { OrderConfirmDialogComponent } from '../order-confirm-dialog/order-confirm-dialog.component';
import {
  bucketTargetWarnings,
  evaluateOrderGuardrails,
  GuardrailContext,
} from '../../utils/order-guardrails.util';
import {
  buildFractionalCloseTicket,
  buildStopLossTicket,
} from '../../utils/stop-loss-ticket.util';
import { findActiveStopLoss, rhStateToDisplayStatus } from '../../utils/broker-order.util';
import { isPaperEligibleTicket, toPaperSignalOrderRequest } from '../../utils/paper-ticket.util';
import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
  TradingConfig,
  EquityOrderTicket,
  BrokerOrderSnapshot,
} from '../../services/order-ticket.types';
import {
  computePositionSize,
  computeUnits,
  stopPriceFromPercent,
  stopPercentFromPrice,
  ticketCostBasisPrice,
  DEFAULT_STOP_PERCENT,
} from '../../utils/position-sizing.util';
import { StopLossFormComponent } from '../../../../shared/components/stop-loss-form/stop-loss-form.component';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import { BucketStatus } from '@portfolio-allocation/contracts';

@Component({
  selector: 'app-order-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    StopLossFormComponent,
  ],
  templateUrl: './order-ticket.component.html',
  styleUrl: './order-ticket.component.scss',
})
export class OrderTicketComponent {
  private readonly stagingStore = inject(OrderTicketStore);
  private readonly orderExecution = inject(OrderExecutionService);
  private readonly paperTrading = inject(PaperTradingService);
  private readonly allocStore = inject(AllocationStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** The selected ticket to configure. */
  ticket = input<OrderTicket | null>(null);

  /** Current price for the ticket's symbol (from price service). */
  price = input<number | null>(null);

  /** Trading config (passed from parent page). */
  tradingConfig = input<TradingConfig | null>(null);

  /** Guardrail context from the page (current exposure, units, cash). */
  guardrailContext = input<GuardrailContext | null>(null);

  /** RH orders from the parent page — used to find stop-loss orders by symbol. */
  rhOrders = input<BrokerOrderSnapshot[]>([]);

  /** RH orders keyed by order ID for efficient lookup. */
  readonly rhOrdersMap = computed<Record<string, BrokerOrderSnapshot>>(() => {
    const map: Record<string, BrokerOrderSnapshot> = {};
    for (const o of this.rhOrders()) map[o.id] = o;
    return map;
  });

  /** Emitted after any RH action (cancel, stop, fractional close) so the
   *  parent page can refresh RH orders and positions. */
  readonly refreshRequested = output<void>();

  /** Emitted when the user clicks Requeue on a FAILED ticket — the page
   *  owns the requeue (fresh refId + STAGED) since it also handles the
   *  queue-row Requeue action (#717). */
  readonly requeueRequested = output<string>();

  /** Local editable copy of the ticket fields. */
  readonly orderType = signal<'market' | 'limit' | 'stop_market' | 'stop_limit'>('market');
  readonly quantity = signal<string>('');
  readonly limitPrice = signal<string>('');
  readonly stopPrice = signal<string>('');
  readonly timeInForce = signal<'gfd' | 'gtc'>('gfd');
  readonly marketHours = signal<'regular_hours' | 'extended_hours' | 'all_day_hours'>('regular_hours');

  /** Stop loss fields — bidirectionally linked. */
  readonly stopLossPrice = signal<string>('');
  readonly stopLossPercent = signal<string>(String(DEFAULT_STOP_PERCENT));

  /** Tracks which ticket the stop loss was last initialized for. */
  private lastStopLossTicketId: string | null = null;

  /** Editable bucket pick — optional (#592). Empty = the position lands
   *  in Unassigned; never a submit gate. */
  readonly selectedBucketId = signal<string>('');

  /** The account this ticket trades in — scopes the bucket options + stats.
   *  Prefers the ticket's own accountNumber: it's what `submitEquityOrder`
   *  sends to RH and what `seedFromTicket$` resolves against — the picker
   *  must scope to the same account or a config change between staging and
   *  submit would show buckets the fill can never land in. */
  private readonly ticketAccount = computed(() =>
    this.ticket()?.accountNumber ?? this.tradingConfig()?.accountNumber ?? '');

  /** ACTIVE buckets on the ticket's account — the picker's options. */
  readonly bucketOptions = computed(() =>
    (this.allocStore.byAccount()[this.ticketAccount()]?.buckets ?? [])
      .filter((b) => b.status === BucketStatus.ACTIVE));

  /** The picked bucket object, when it still resolves in this account —
   *  null when unset or the bucket was deleted/retired since staging. */
  readonly selectedBucket = computed(() =>
    this.bucketOptions().find((b) => b.id === this.selectedBucketId()) ?? null);

  /** Expose enum for template. */
  readonly OrderTicketStatus = OrderTicketStatus;

  /** Default dollar amount from config. */
  readonly defaultDollarAmount = computed(() => this.tradingConfig()?.defaultDollarAmount ?? 100);

  /** Current price for the symbol (from input). */
  readonly currentPrice = computed(() => this.price());

  /** Price the cost math uses. Limit/stop-limit orders cost at the
   *  editable limit price — the committed worst case — so the displayed
   *  cost must track the user's edits, not the live quote (#723). Falls
   *  back to the live quote when the limit field is empty/invalid and for
   *  market orders. Shared basis with queue rows + paper sizing via
   *  `ticketCostBasisPrice`. */
  readonly costBasisPrice = computed<number | null>(() =>
    ticketCostBasisPrice(
      { orderType: this.orderType(), limitPrice: this.limitPrice() },
      this.currentPrice(),
    ),
  );

  /** Whole-share quantity (non-negative integer) for calculations. */
  private wholeQuantity(): number {
    return Math.max(0, parseInt(this.quantity(), 10) || 0);
  }

  /** Computed units for the current quantity and price. */
  readonly computedUnits = computed(() => {
    const qty = this.wholeQuantity();
    const price = this.costBasisPrice();
    const dda = this.defaultDollarAmount();
    if (qty <= 0 || price === null || price <= 0 || dda <= 0) return 0;
    return computeUnits(qty, price, dda);
  });

  /** Computed actual cost for the current quantity and price. */
  readonly actualCost = computed(() => {
    const qty = this.wholeQuantity();
    const price = this.costBasisPrice();
    if (qty <= 0 || price === null || price <= 0) return 0;
    return Math.round(qty * price * 100) / 100;
  });

  /** Display symbol for the ticket. */
  readonly symbol = computed(() => {
    const i = this.ticket();
    if (!i) return '';
    if (i.instrumentType === InstrumentType.OPTION) return i.legs[0]?.symbol ?? '?';
    return i.symbol;
  });

  /** Whether the selected ticket is a linked stop-loss order. */
  readonly isStopLossTicket = computed(() => this.ticket()?.sourceRef?.type === 'stop_loss');

  /** Whether the selected ticket closes a fractional remainder. */
  readonly isFractionalCloseTicket = computed(() => this.ticket()?.sourceRef?.type === 'fractional_close');

  /** Stop price for the selected stop-loss ticket. */
  readonly selectedStopPrice = computed(() => {
    const i = this.ticket();
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
  readonly canSubmitStopLossTicket = computed(() => {
    const i = this.ticket();
    return this.isStopLossTicket() && i?.status === OrderTicketStatus.STAGED &&
      this.wholeQuantity() > 0 && parseFloat(this.stopLossPrice()) > 0;
  });

  /** The entry/position protected by the selected stop-loss ticket. */
  readonly protectedEntry = computed<OrderTicket | null>(() => {
    const parentId = this.ticket()?.sourceRef?.id;
    if (!parentId) return null;
    return this.stagingStore.tickets()[parentId] ?? null;
  });

  /** Whether the ticket is in an editable state. FAILED is deliberately
   *  NOT editable — a broker-rejected order already burned its refId at
   *  RH, so submitting it directly 409s. It routes through Requeue, which
   *  mints a fresh refId and returns the ticket to STAGED (#717). */
  readonly isEditable = computed(() => {
    return this.ticket()?.status === OrderTicketStatus.STAGED;
  });

  /** Whether the ticket is currently being submitted. */
  readonly isSubmitting = computed(() => this.ticket()?.status === OrderTicketStatus.SUBMITTING);

  /** In-flight flag for the paperSignalOrder callable. */
  readonly acceptingPaper = signal(false);

  /** Whether the staged ticket can be accepted as paper — signal-pipeline
   *  equity/ETF tickets only (option tickets and non-signal sources have
   *  no signal context to anchor the paper cohort to). The predicate is
   *  shared with the batch send-to-paper path (#709). */
  readonly canAcceptAsPaper = computed(() => isPaperEligibleTicket(this.ticket()));

  /** Whether the ticket is submitted and awaiting fill (or submitting). */
  readonly isSubmitted = computed(() => {
    const s = this.ticket()?.status;
    return s === OrderTicketStatus.SUBMITTED || s === OrderTicketStatus.QUEUED || s === OrderTicketStatus.RESTING || s === OrderTicketStatus.SUBMITTING;
  });

  /** Whether the entry order has been filled (enables stop loss placement). */
  readonly isEntryFilled = computed(() => {
    return this.ticket()?.status === OrderTicketStatus.FILLED;
  });

  /** Fractional positions cannot use Robinhood equity stop-loss orders. */
  readonly isFractionalEntry = computed(() => {
    const i = this.ticket();
    const rawQuantity = i?.result?.filledQuantity ?? i?.quantity;
    const quantity = rawQuantity ? Number(rawQuantity) : 0;
    return quantity > 0 && Number.isFinite(quantity) && !Number.isInteger(quantity);
  });

  /** Fractional remainder to sell to leave an integer-share position. */
  readonly fractionalQuantity = computed(() => {
    const i = this.ticket();
    const rawQuantity = i?.result?.filledQuantity ?? i?.quantity;
    const quantity = rawQuantity ? Number(rawQuantity) : 0;
    if (!Number.isFinite(quantity) || quantity <= 0 || Number.isInteger(quantity)) return '0';
    return (quantity - Math.floor(quantity)).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  });

  /** Whether to show the stop loss section — only for whole-share equity buys that have been filled. */
  readonly showStopLossSection = computed(() => {
    const i = this.ticket();
    if (!i) return false;
    if (i.side !== 'buy') return false;
    if (i.instrumentType !== InstrumentType.EQUITY && i.instrumentType !== InstrumentType.ETF) return false;
    return this.isEntryFilled() && !this.isFractionalEntry() && !this.stopLossExists();
  });

  /** Whether the stop loss can be placed — entry must be filled, qty must be positive, and stop loss price must be valid. */
  readonly canPlaceStopLoss = computed(() => {
    if (!this.isEntryFilled()) return false;
    const i = this.ticket();
    const rawQuantity = i?.result?.filledQuantity ?? i?.quantity ?? '0';
    const quantity = Number(rawQuantity);
    const slPrice = parseFloat(this.stopLossPrice());
    return Number.isInteger(quantity) && quantity > 0 && !isNaN(slPrice) && slPrice > 0;
  });

  /** Quantity for the StopLossFormComponent — filled quantity or ticket quantity. */
  readonly stopLossQuantity = computed(() => {
    const i = this.ticket();
    return (i?.result?.filledQuantity ?? i?.quantity) || '0';
  });

  /** Account number for the StopLossFormComponent. */
  readonly stopLossAccountNumber = computed(() => {
    const i = this.ticket();
    return this.tradingConfig()?.accountNumber ?? i?.accountNumber ?? '';
  });

  /** The stop loss order from RH (found by symbol in the RH orders list). */
  readonly stopLossTicket = computed<OrderTicket | null>(() => {
    const i = this.ticket();
    if (!i) return null;
    if (i.instrumentType !== InstrumentType.EQUITY && i.instrumentType !== InstrumentType.ETF) return null;
    const symbol = i.symbol;
    const rhStop = findActiveStopLoss(this.rhOrdersMap(), symbol);
    if (!rhStop) return null;
    // Map RH order to an OrderTicket-like object for the template
    return {
      id: rhStop.id,
      refId: rhStop.id,
      source: OrderSource.POSITION_MANAGEMENT,
      sourceRef: { type: 'stop_loss', id: i.id },
      status: rhStateToDisplayStatus(rhStop.state, false), // stop orders are trigger-based, never market
      accountNumber: i.accountNumber,
      side: 'sell',
      orderType: 'stop_loss',
      timeInForce: rhStop.timeInForce ?? 'gtc',
      marketHours: rhStop.marketHours ?? 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol,
      quantity: rhStop.quantity ?? '',
      stopPrice: rhStop.stopPrice ?? undefined,
      result: {
        orderId: rhStop.id,
        state: rhStop.state,
        fillPrice: rhStop.price ?? undefined,
        filledQuantity: rhStop.cumulativeQuantity ?? rhStop.quantity,
        brokerOrder: rhStop,
      },
      createdAt: rhStop.createdAt ?? new Date().toISOString(),
      updatedAt: rhStop.lastTransactionAt ?? new Date().toISOString(),
    } as EquityOrderTicket;
  });

  /** Stop price from the linked stop-loss ticket. */
  readonly protectedStopPrice = computed(() => {
    const stopLoss = this.stopLossTicket();
    return stopLoss && 'stopPrice' in stopLoss ? stopLoss.stopPrice ?? null : null;
  });

  /** Whether a stop loss ticket exists in the store. */
  readonly stopLossExists = computed(() => this.stopLossTicket() !== null);

  /** Whether the stop loss is currently submitting. */
  readonly isStopLossSubmitting = computed(() =>
    this.stopLossTicket()?.status === OrderTicketStatus.SUBMITTING,
  );

  /** Whether the stop loss is submitted and awaiting fill. */
  readonly isStopLossSubmitted = computed(() =>
    this.stopLossTicket()?.status === OrderTicketStatus.SUBMITTED ||
    this.stopLossTicket()?.status === OrderTicketStatus.QUEUED ||
    this.stopLossTicket()?.status === OrderTicketStatus.RESTING,
  );

  /** Fill price from the entry order result, if filled. */
  readonly entryFillPrice = computed<number | null>(() => {
    const i = this.ticket();
    if (!i || i.status !== OrderTicketStatus.FILLED) return null;
    const fp = i.result?.fillPrice;
    return fp ? parseFloat(fp) : null;
  });

  /** Compact entry confirmation data for read-only display. */
  readonly entryConfirmation = computed(() => {
    const i = this.ticket();
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

  /** Error from the ticket (if FAILED). */
  readonly ticketError = computed(() => this.ticket()?.error ?? null);

  /** Whether the error is retryable. */
  readonly isRetryable = computed(() => this.ticketError()?.retryable === true);

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

  /** Live preview of the order to be submitted (shows real account number — what will actually be sent). */
  readonly preview = computed(() => {
    const i = this.ticket();
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
    // Sync local editable fields when the ticket changes
    effect(() => {
      const i = this.ticket();
      untracked(() => {
        if (!i) return;
        this.selectedBucketId.set(i.bucketId ?? '');
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
      const i = this.ticket();
      untracked(() => {
        if (!price || price <= 0 || !i || this.isFractionalCloseTicket()) return;
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

    // When entry fills or selection changes to a filled ticket, initialize stop loss
    // from the fill price and default percent. Recalculates directly on ticket change.
    effect(() => {
      const i = this.ticket();
      const fillPrice = this.entryFillPrice();
      untracked(() => {
        if (!i || !fillPrice || fillPrice <= 0) return;
        // Only initialize when the ticket changes — preserve user edits otherwise
        if (this.lastStopLossTicketId === i.id) return;
        this.lastStopLossTicketId = i.id;
        this.stopLossPercent.set(String(DEFAULT_STOP_PERCENT));
        this.stopLossPrice.set(stopPriceFromPercent(fillPrice, DEFAULT_STOP_PERCENT).toFixed(2));
      });
    });

    // Load the ticket account's buckets/stats for the picker — never
    // selects the account (the allocation page may show another).
    effect(() => {
      const acct = this.ticketAccount();
      if (acct) untracked(() => this.allocStore.ensureAccount(acct));
    });

    // Recompute the entry stop price from percent when the user edits an entry ticket.
    // A selected stop-loss ticket owns its persisted stop price and initializes below.
    effect(() => {
      const percent = parseFloat(this.stopLossPercent());
      const refPrice = this.stopLossReferencePrice();
      const isStopLoss = this.isStopLossTicket();
      untracked(() => {
        if (!isStopLoss && refPrice && refPrice > 0 && !isNaN(percent) && percent > 0) {
          this.stopLossPrice.set(stopPriceFromPercent(refPrice, percent).toFixed(2));
        }
      });
    });

    // Initialize the dedicated stop-loss controls from the persisted stop price.
    effect(() => {
      const i = this.ticket();
      const refPrice = this.stopLossReferencePrice();
      untracked(() => {
        if (!i || !this.isStopLossTicket() || !refPrice || refPrice <= 0) return;
        const persistedStop = 'stopPrice' in i ? i.stopPrice : undefined;
        if (persistedStop) this.stopLossPrice.set(persistedStop);
        const percent = persistedStop ? stopPercentFromPrice(refPrice, parseFloat(persistedStop)) : DEFAULT_STOP_PERCENT;
        if (Number.isFinite(percent) && percent > 0) this.stopLossPercent.set(String(percent));
      });
    });
  }

  /** Update the ticket in the store with the edited fields. */
  saveEdits(): void {
    const i = this.ticket();
    if (!i || !this.isEditable()) return;
    const partial: Partial<EquityOrderTicket> = {
      orderType: this.orderType(),
      timeInForce: this.timeInForce(),
      marketHours: this.marketHours(),
      bucketId: this.selectedBucketId() || undefined,
    };
    if (i.instrumentType === InstrumentType.EQUITY || i.instrumentType === InstrumentType.ETF) {
      const q = this.wholeQuantity();
      partial.quantity = this.isFractionalCloseTicket() ? this.quantity() : q > 0 ? String(q) : undefined;
      // Clear dollarAmount — the service converts undefined to deleteField().
      partial.dollarAmount = undefined;
      if (this.showLimitPrice()) partial.limitPrice = this.limitPrice() || undefined;
      if (this.showStopPrice()) partial.stopPrice = this.stopPrice() || undefined;
    }
    this.stagingStore.updateTicket(i.id, partial);
  }

  /** Open confirmation dialog, then submit if confirmed. */
  async onSubmit(): Promise<void> {
    const i = this.ticket();
    if (!i || !this.isEditable()) return;

    // Check account and quantity before saving edits
    if (!this.hasAccount()) {
      this.snackBar.open('No account number configured. Set one in settings.', 'Dismiss', { duration: 4000 });
      return;
    }
    if (this.isFractionalCloseTicket() && this.marketHours() !== 'regular_hours') {
      this.snackBar.open('Fractional orders are only allowed during regular hours', 'Dismiss', { duration: 5000 });
      return;
    }

    const numericQuantity = Number(this.quantity());
    const quantityValid = this.isFractionalCloseTicket()
      ? Number.isFinite(numericQuantity) && numericQuantity > 0
      : this.wholeQuantity() > 0;
    if (!quantityValid) {
      this.snackBar.open(
        this.isFractionalCloseTicket() ? 'Quantity must be positive' : 'Quantity must be a positive whole number of shares',
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
          data: { ticket: { ...i, ...snapshot }, warnings },
          width: '400px',
        })
        .afterClosed(),
    );

    if (confirmed) {
      this.stagingStore.submitTicket(i.id);
    }
  }

  /** Accept the staged signal ticket as paper: opens the confirm dialog in
   *  paper mode, calls paperSignalOrder, and transitions the ticket to
   *  PAPER on success. On failure the ticket stays STAGED. No RH calls —
   *  the callable does all broker reads server-side. */
  async onAcceptAsPaper(): Promise<void> {
    const i = this.ticket();
    if (!i || this.acceptingPaper()) return;
    // canAcceptAsPaper gates the button; the predicate re-check also
    // narrows the union for the request builder (typed `symbol`).
    if (!isPaperEligibleTicket(i)) return;

    // Persist pending edits first so the stored ticket, the dialog, and the
    // request all agree (same ordering as onSubmit).
    this.saveEdits();

    // Held from dialog open through the callable so rapid re-entry can't
    // open a second dialog or double-invoke paperSignalOrder.
    this.acceptingPaper.set(true);

    try {
      const confirmed = await firstValueFrom(
        this.dialog
          .open(OrderConfirmDialogComponent, {
            data: { ticket: { ...i, ...this.preview() }, warnings: [], paper: true },
            width: '400px',
          })
          .afterClosed(),
      );
      if (!confirmed) return;

      // Transient SUBMITTING takes the ticket out of the staged pool
      // while the callable runs — otherwise it can be batch-removed or
      // submitted to RH mid-flight (same guard as the batch path, #709).
      this.stagingStore.setTicketStatusLocal(i.id, OrderTicketStatus.SUBMITTING);
      const quantity = this.wholeQuantity() > 0 ? this.wholeQuantity() : undefined;
      const res = await firstValueFrom(
        this.paperTrading.paperSignalOrder$(toPaperSignalOrderRequest(i, quantity)),
      );
      this.stagingStore.updateTicket(i.id, {
        status: OrderTicketStatus.PAPER,
        error: undefined,
        updatedAt: new Date().toISOString(),
      });
      this.snackBar.open(
        `Accepted as paper — cohort ${res.cohortId} (${res.expressionTradeIds.length} expression trades)`,
        'Dismiss',
        { duration: 5000 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Revert the transient SUBMITTING — the callable failed, the ticket
      // is still staged, and the error is recorded for the row.
      this.stagingStore.updateTicket(i.id, {
        status: OrderTicketStatus.STAGED,
        error: { message: `Paper accept failed: ${msg}`, retryable: true },
        updatedAt: new Date().toISOString(),
      });
      this.snackBar.open(`Failed to accept as paper: ${msg}`, 'Dismiss', { duration: 5000 });
    } finally {
      this.acceptingPaper.set(false);
    }
  }

  /** Confirm and submit an existing staged stop-loss ticket. */
  async onSubmitStopLossTicket(): Promise<void> {
    const i = this.ticket();
    if (!i || !this.isStopLossTicket() || i.status !== OrderTicketStatus.STAGED) return;
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { ticket: i, warnings: [] },
          width: '400px',
        })
        .afterClosed(),
    );
    if (confirmed) {
      this.stagingStore.updateTicket(i.id, { stopPrice: this.stopLossPrice() });
      this.stagingStore.submitTicket(i.id);
    }
  }

  /** Requeue a FAILED ticket — emits to the page, which mints a fresh
   *  refId and returns the ticket to STAGED (#717). A failed RH order's
   *  refId is burned, so it must never be resubmitted directly. */
  onRequeue(): void {
    const i = this.ticket();
    if (i?.status !== OrderTicketStatus.FAILED) return;
    this.requeueRequested.emit(i.id);
  }

  /** Cancel a submitted or submitting ticket — calls RH directly. */
  async onCancel(): Promise<void> {
    const i = this.ticket();
    if (!i) return;
    if (i.status !== OrderTicketStatus.SUBMITTED && i.status !== OrderTicketStatus.QUEUED && i.status !== OrderTicketStatus.RESTING && i.status !== OrderTicketStatus.SUBMITTING) return;
    const orderId = i.result?.orderId;
    if (!orderId) return;
    this.snackBar.open('Cancelling order…', '', { duration: 3000 });
    const result = await this.orderExecution.cancelEquityOrder(i.accountNumber, orderId);
    if (result.success) {
      this.snackBar.open('Order cancelled', 'Dismiss', { duration: 3000 });
      this.refreshRequested.emit();
    } else {
      const msg = result.error?.message ?? 'Cancel failed';
      this.snackBar.open(`Cancel failed: ${msg}`, 'Dismiss', { duration: 5000 });
    }
  }

  /** Manually refresh RH order state. */
  onReconcile(): void {
    this.snackBar.open('Refreshing broker state…', '', { duration: 3000 });
    this.refreshRequested.emit();
  }

  /** Modify a submitted ticket — cancels at RH, then reverts to STAGED for editing. */
  async onModify(): Promise<void> {
    const i = this.ticket();
    if (!i || (i.status !== OrderTicketStatus.SUBMITTED && i.status !== OrderTicketStatus.QUEUED && i.status !== OrderTicketStatus.RESTING)) return;
    const orderId = i.result?.orderId;
    if (!orderId) return;
    this.snackBar.open('Cancelling order for modification…', '', { duration: 3000 });
    const result = await this.orderExecution.cancelEquityOrder(i.accountNumber, orderId);
    if (result.success) {
      // Revert to STAGED so the user can edit and resubmit. The cancel
      // made the order terminal at RH, which burns the refId — resubmitting
      // it would 409. Mint a fresh one, same as requeue (#717). Await the
      // persist: paperSignalOrder looks the ticket up by refId server-side.
      await this.stagingStore.updateTicketAndWait(i.id, {
        status: OrderTicketStatus.STAGED,
        refId: crypto.randomUUID(),
        result: undefined,
        error: undefined,
        terminalAt: undefined,
      });
      this.refreshRequested.emit();
    } else {
      const msg = result.error?.message ?? 'Cancel failed';
      this.snackBar.open(`Modify failed: ${msg}`, 'Dismiss', { duration: 5000 });
    }
  }

  /** Cancel a submitted stop loss order — calls RH directly. */
  async onCancelStopLoss(): Promise<void> {
    const sl = this.stopLossTicket();
    if (!sl) return;
    if (sl.status !== OrderTicketStatus.SUBMITTED && sl.status !== OrderTicketStatus.QUEUED && sl.status !== OrderTicketStatus.RESTING && sl.status !== OrderTicketStatus.SUBMITTING) return;
    const orderId = sl.result?.orderId;
    if (!orderId) return;
    this.snackBar.open('Cancelling stop loss…', '', { duration: 3000 });
    const result = await this.orderExecution.cancelEquityOrder(sl.accountNumber, orderId);
    if (result.success) {
      this.snackBar.open('Stop loss cancelled', 'Dismiss', { duration: 3000 });
      this.refreshRequested.emit();
    } else {
      const msg = result.error?.message ?? 'Cancel failed';
      this.snackBar.open(`Cancel failed: ${msg}`, 'Dismiss', { duration: 5000 });
    }
  }

  /** New Manual Order placeholder. */
  onNewManualOrder(): void {
    this.snackBar.open('Manual order creation coming soon', 'Dismiss', { duration: 3000 });
  }

  /** Submit a market sell for the fractional remainder directly to RH. */
  async onCloseFractionalShare(): Promise<void> {
    const i = this.ticket();
    const quantity = this.fractionalQuantity();
    if (!i || !this.isEntryFilled() || !this.isFractionalEntry() || quantity === '0') return;

    const closeTicket = buildFractionalCloseTicket(
      i,
      this.symbol(),
      quantity,
      this.tradingConfig()?.accountNumber ?? i.accountNumber,
    );
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { ticket: closeTicket, warnings: [] },
          width: '400px',
        })
        .afterClosed(),
    );
    if (!confirmed) return;

    this.snackBar.open('Submitting fractional close…', '', { duration: 3000 });
    const result = await this.orderExecution.submitEquityOrder(closeTicket as EquityOrderTicket);
    if (result.success) {
      this.snackBar.open('Fractional close submitted', 'Dismiss', { duration: 3000 });
      this.refreshRequested.emit();
    } else {
      const msg = result.error?.message ?? 'Submit failed';
      this.snackBar.open(`Fractional close failed: ${msg}`, 'Dismiss', { duration: 5000 });
    }
  }

  /** Confirm and submit a stop loss order directly to RH (no local doc). */
  async onPlaceStopLoss(stopPrice?: number): Promise<void> {
    const i = this.ticket();
    if (!i) return;

    // When stopPrice is provided from StopLossFormComponent, skip canPlaceStopLoss
    // (the component already validates before emitting). Otherwise check locally.
    if (stopPrice === undefined && !this.canPlaceStopLoss()) return;

    const slPrice = stopPrice ?? parseFloat(this.stopLossPrice());
    if (isNaN(slPrice) || slPrice <= 0) {
      this.snackBar.open('Invalid stop loss price', 'Dismiss', { duration: 4000 });
      return;
    }

    const quantity = (i.result?.filledQuantity ?? i.quantity) || '0';
    const stopLossTicket = buildStopLossTicket(
      i,
      this.symbol(),
      quantity,
      slPrice,
      this.tradingConfig()?.accountNumber ?? i.accountNumber,
    );
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { ticket: stopLossTicket, warnings: [] },
          width: '400px',
        })
        .afterClosed(),
    );
    if (!confirmed) return;

    this.snackBar.open('Submitting stop loss…', '', { duration: 3000 });
    const result = await this.orderExecution.submitEquityOrder(stopLossTicket as EquityOrderTicket);
    if (result.success) {
      this.snackBar.open('Stop loss order submitted', 'Dismiss', { duration: 3000 });
      this.refreshRequested.emit();
    } else {
      const msg = result.error?.message ?? 'Submit failed';
      this.snackBar.open(`Stop loss failed: ${msg}`, 'Dismiss', { duration: 5000 });
    }
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
    if (this.isFractionalCloseTicket()) {
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

  /** Compute guardrail warnings for the current order — position-level
   *  limits plus the optional bucket's over-target warning (warn, never
   *  block). */
  private computeWarnings() {
    const context = this.guardrailContext();
    const side = this.ticket()?.side ?? 'buy';
    const warnings = context
      ? evaluateOrderGuardrails(context, this.actualCost(), this.computedUnits(), side)
      : [];
    const bucket = this.selectedBucket();
    const acct = this.ticketAccount();
    const stats = bucket && acct ? this.allocStore.bucketDetail(acct, bucket.id)?.stats : null;
    warnings.push(...bucketTargetWarnings(
      bucket && stats
        ? { bucketName: bucket.name, exposure: stats.exposure, targetDollars: stats.targetDollars }
        : null,
      this.actualCost(), side,
    ));
    return warnings;
  }

  onBucketChange(event: Event): void {
    this.selectedBucketId.set((event.target as HTMLSelectElement).value);
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
