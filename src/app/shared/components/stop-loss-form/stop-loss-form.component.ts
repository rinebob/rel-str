/**
 * Stop Loss Form Component (shared)
 *
 * Extracted from OrderTicketComponent's stop-loss section. Provides stop price,
 * stop percent with bidirectional linking, dollar risk calculation, and order preview.
 * Used by the signal-order page's OrderTicketComponent and the portfolio-dashboard
 * stop-loss dialog.
 *
 * Refs:
 * - PRD: 219-279-280-PRD-portfolio-portfolio-dashboard-order-placement.md US10-US12
 * - IMPL: 219-279-291-IMPL-portfolio-FE-portfolio-dashboard-order-placement.md Task 1
 */
import {
  Component,
  input,
  output,
  computed,
  signal,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import {
  stopPriceFromPercent,
  stopPercentFromPrice,
  DEFAULT_STOP_PERCENT,
} from '../../utils/stop-loss-math.util';

@Component({
  selector: 'app-stop-loss-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './stop-loss-form.component.html',
  styleUrl: './stop-loss-form.component.scss',
})
export class StopLossFormComponent {
  /** Position symbol. */
  readonly symbol = input.required<string>();

  /** Position quantity in shares (string, e.g. '100'). */
  readonly quantity = input.required<string>();

  /** Reference price for computing stop percent from stop price (entry fill or current). */
  readonly referencePrice = input<number | null>(null);

  /** Account number for the order preview. */
  readonly accountNumber = input.required<string>();

  /** Whether the form is disabled (e.g., during submission). */
  readonly disabled = input(false);

  /** Emitted when the user clicks "Submit Stop Loss". Parent handles actual placement. */
  readonly placeStopLoss = output<{ stopPrice: number }>();

  // ========================================
  // Internal state
  // ========================================

  readonly stopLossPrice = signal<string>('');
  readonly stopLossPercent = signal<string>(String(DEFAULT_STOP_PERCENT));

  /** Whether the user has manually edited the stop price. Prevents re-initialization from clobbering edits. */
  private userEdited = signal(false);

  // ========================================
  // Computed
  // ========================================

  /** Whole-share quantity as a number. */
  private wholeQuantity(): number {
    return Math.max(0, parseInt(this.quantity(), 10) || 0);
  }

  /** Dollar risk = shares × (reference price − stop price). */
  readonly dollarRisk = computed(() => {
    const qty = this.wholeQuantity();
    const refPrice = this.referencePrice();
    const slPrice = parseFloat(this.stopLossPrice());
    if (qty <= 0 || refPrice === null || refPrice <= 0 || isNaN(slPrice) || slPrice <= 0) return 0;
    return Math.round(qty * (refPrice - slPrice) * 100) / 100;
  });

  /** Whether the stop loss can be placed — stop price > 0 and quantity > 0. */
  readonly canPlace = computed(() => {
    const qty = this.wholeQuantity();
    const slPrice = parseFloat(this.stopLossPrice());
    return qty > 0 && !isNaN(slPrice) && slPrice > 0;
  });

  /** Preview of the stop loss order object. */
  readonly preview = computed(() => ({
    symbol: this.symbol(),
    side: 'sell',
    orderType: 'stop_market',
    quantity: this.quantity(),
    stopPrice: this.stopLossPrice() || undefined,
    stopLossPercent: this.stopLossPercent() || undefined,
    timeInForce: 'gtc',
    marketHours: 'regular_hours',
    accountNumber: this.accountNumber(),
  }));

  // ========================================
  // Effects — initialization and bidirectional linking
  // ========================================

  constructor() {
    // Initialize stop price from reference price and default percent when reference price changes.
    // Guard against clobbering user edits — only initialize on first set or when reference price
    // changes before the user has edited.
    effect(() => {
      const refPrice = this.referencePrice();
      untracked(() => {
        if (refPrice !== null && refPrice > 0 && !this.userEdited()) {
          this.stopLossPercent.set(String(DEFAULT_STOP_PERCENT));
          this.stopLossPrice.set(stopPriceFromPercent(refPrice, DEFAULT_STOP_PERCENT).toFixed(2));
        }
      });
    });
  }

  // ========================================
  // Public methods
  // ========================================

  /** Emit the placeStopLoss event with the current stop price. */
  onPlace(): void {
    if (this.disabled() || !this.canPlace()) return;
    const slPrice = parseFloat(this.stopLossPrice());
    this.placeStopLoss.emit({ stopPrice: slPrice });
  }

  // ========================================
  // Input and stepper methods
  // ========================================

  onStopPriceChange(event: Event): void {
    this.userEdited.set(true);
    const raw = (event.target as HTMLInputElement).value;
    this.stopLossPrice.set(raw);
    // Bidirectional linking: update percent from price
    const refPrice = this.referencePrice();
    if (refPrice !== null && refPrice > 0) {
      const price = parseFloat(raw);
      if (!isNaN(price) && price > 0) {
        const percent = stopPercentFromPrice(refPrice, price);
        if (Number.isFinite(percent) && percent >= 0) {
          this.stopLossPercent.set(String(percent));
        }
      }
    }
  }

  onStopPercentChange(event: Event): void {
    this.userEdited.set(true);
    const raw = (event.target as HTMLInputElement).value;
    this.stopLossPercent.set(raw);
    // Bidirectional linking: update price from percent
    const refPrice = this.referencePrice();
    if (refPrice !== null && refPrice > 0) {
      const percent = parseFloat(raw);
      if (!isNaN(percent) && percent > 0) {
        this.stopLossPrice.set(stopPriceFromPercent(refPrice, percent).toFixed(2));
      }
    }
  }

  stopPriceUp(): void {
    this.userEdited.set(true);
    this.stepPrice(this.stopLossPrice, 0.25);
    this.syncPercentFromPrice();
  }

  stopPriceDown(): void {
    this.userEdited.set(true);
    this.stepPrice(this.stopLossPrice, -0.25);
    this.syncPercentFromPrice();
  }

  stopPercentUp(): void {
    this.userEdited.set(true);
    this.stepPercent(this.stopLossPercent, 0.5);
    this.syncPriceFromPercent();
  }

  stopPercentDown(): void {
    this.userEdited.set(true);
    this.stepPercent(this.stopLossPercent, -0.5);
    this.syncPriceFromPercent();
  }

  // ========================================
  // Private helpers
  // ========================================

  /** Stepper for price fields — increment by delta, avoid round endings (0 or 5). */
  private stepPrice(field: typeof this.stopLossPrice, delta: number): void {
    const current = parseFloat(field()) || 0;
    let next = Math.max(0, Math.round((current + delta) * 100) / 100);
    const cents = Math.round(next * 100) % 10;
    if (cents === 0 || cents === 5) {
      next = Math.max(0, Math.round((next + 0.02) * 100) / 100);
    }
    field.set(next.toFixed(2));
  }

  /** Stepper for percent fields — increment by delta. */
  private stepPercent(field: typeof this.stopLossPercent, delta: number): void {
    const current = parseFloat(field()) || 0;
    const next = Math.max(0, Math.round((current + delta) * 10) / 10);
    field.set(String(next));
  }

  /** Sync stop percent from stop price (price → percent). */
  private syncPercentFromPrice(): void {
    const refPrice = this.referencePrice();
    if (refPrice === null || refPrice <= 0) return;
    const price = parseFloat(this.stopLossPrice());
    if (isNaN(price) || price <= 0) return;
    const percent = stopPercentFromPrice(refPrice, price);
    if (Number.isFinite(percent) && percent >= 0) {
      this.stopLossPercent.set(String(percent));
    }
  }

  /** Sync stop price from stop percent (percent → price). */
  private syncPriceFromPercent(): void {
    const refPrice = this.referencePrice();
    if (refPrice === null || refPrice <= 0) return;
    const percent = parseFloat(this.stopLossPercent());
    if (isNaN(percent) || percent <= 0) return;
    this.stopLossPrice.set(stopPriceFromPercent(refPrice, percent).toFixed(2));
  }
}
