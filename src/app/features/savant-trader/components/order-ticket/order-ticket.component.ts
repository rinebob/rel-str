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
  ChangeDetectionStrategy,
  OnInit,
  effect,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { OrderStagingStore } from '../../stores/order-staging.store';
import { TradingConfigService } from '../../services/trading-config.service';
import { OrderConfirmDialogComponent } from '../order-confirm-dialog/order-confirm-dialog.component';
import {
  OrderIntent,
  OrderIntentStatus,
  InstrumentType,
  TradingConfig,
} from '../../services/order-intent.types';

@Component({
  selector: 'app-order-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  templateUrl: './order-ticket.component.html',
  styleUrl: './order-ticket.component.scss',
})
export class OrderTicketComponent implements OnInit {
  private readonly stagingStore = inject(OrderStagingStore);
  private readonly configService = inject(TradingConfigService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  /** The selected intent to configure. */
  intent = input<OrderIntent | null>(null);

  /** The user's trading config (account number). */
  readonly tradingConfig = signal<TradingConfig | null>(null);

  /** Local editable copy of the intent fields. */
  readonly orderType = signal<'market' | 'limit' | 'stop_market' | 'stop_limit'>('market');
  readonly quantity = signal<string>('');
  readonly dollarAmount = signal<string>('');
  readonly limitPrice = signal<string>('');
  readonly stopPrice = signal<string>('');
  readonly timeInForce = signal<'gfd' | 'gtc'>('gfd');
  readonly marketHours = signal<'regular_hours' | 'extended_hours' | 'all_day_hours'>('regular_hours');

  /** Expose enum for template. */
  readonly OrderIntentStatus = OrderIntentStatus;

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

  /** Whether quantity field should be shown (not for market dollar orders). */
  readonly showQuantity = computed(() => {
    const i = this.intent();
    if (!i) return true;
    // For equity market orders, user can choose quantity or dollar amount
    return true;
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
      dollarAmount: this.dollarAmount() || undefined,
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
      if (!i) return;
      this.orderType.set(i.orderType);
      this.timeInForce.set(i.timeInForce);
      this.marketHours.set(i.marketHours);
      if (i.instrumentType === InstrumentType.OPTION) {
        this.quantity.set(i.quantity ?? '');
      } else {
        this.quantity.set(i.quantity ?? '');
        this.dollarAmount.set(i.dollarAmount ?? '');
        this.limitPrice.set(i.limitPrice ?? '');
        this.stopPrice.set(i.stopPrice ?? '');
      }
    });
  }

  ngOnInit(): void {
    this.loadConfig();
  }

  /** Load the user's trading config (account number). */
  private loadConfig(): void {
    this.configService.loadConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (config) => this.tradingConfig.set(config),
        error: (err) => {
          console.error('[OrderTicket] Failed to load trading config:', err);
          this.tradingConfig.set(null);
        },
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
      partial.quantity = this.quantity() || undefined;
      partial.dollarAmount = this.dollarAmount() || undefined;
      if (this.showLimitPrice()) partial.limitPrice = this.limitPrice() || undefined;
      if (this.showStopPrice()) partial.stopPrice = this.stopPrice() || undefined;
    }
    this.stagingStore.updateIntent(i.id, partial);
  }

  /** Open confirmation dialog, then submit if confirmed. */
  async onSubmit(): Promise<void> {
    const i = this.intent();
    if (!i) return;

    // Check account before saving edits
    if (!this.hasAccount()) {
      this.snackBar.open('No account number configured. Set one in settings.', 'Dismiss', { duration: 4000 });
      return;
    }

    // Save edits first
    this.saveEdits();

    // Build a snapshot with the edited values for the dialog
    const snapshot = this.preview();

    // Open confirmation dialog with the edited snapshot
    const confirmed = await firstValueFrom(
      this.dialog
        .open(OrderConfirmDialogComponent, {
          data: { intent: { ...i, ...snapshot } },
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

  /** New Manual Order placeholder. */
  onNewManualOrder(): void {
    this.snackBar.open('Manual order creation coming soon', 'Dismiss', { duration: 3000 });
  }
}
