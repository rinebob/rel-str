/**
 * Order Confirm Dialog
 *
 * Confirmation dialog shown before submitting an order to the broker.
 * Displays a summary of the order parameters and asks the user to confirm.
 */
import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { OrderIntent, InstrumentType } from '../../services/order-intent.types';

@Component({
  selector: 'app-order-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './order-confirm-dialog.component.html',
  styleUrl: './order-confirm-dialog.component.scss',
})
export class OrderConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderConfirmDialogComponent, boolean>);

  /** The intent data injected via MAT_DIALOG_DATA. */
  readonly data = inject(MAT_DIALOG_DATA) as { intent: OrderIntent };

  /** The intent to confirm. */
  readonly intent = computed(() => this.data.intent);

  /** Display symbol for the intent. */
  readonly symbol = computed(() => {
    const i = this.intent();
    if (i.instrumentType === InstrumentType.OPTION) return i.legs[0]?.symbol ?? '?';
    return i.symbol;
  });

  /** Quantity display. */
  readonly quantity = computed(() => {
    const i = this.intent();
    if (i.instrumentType === InstrumentType.OPTION) return i.quantity;
    return i.quantity ?? i.dollarAmount ?? '—';
  });

  /** Limit price (equity/etf only). */
  readonly limitPrice = computed(() => {
    const i = this.intent();
    if (i.instrumentType === InstrumentType.OPTION) return undefined;
    return i.limitPrice;
  });

  /** Stop price (equity/etf only). */
  readonly stopPrice = computed(() => {
    const i = this.intent();
    if (i.instrumentType === InstrumentType.OPTION) return undefined;
    return i.stopPrice;
  });

  onConfirm(): void {
    this.dialogRef.close(true);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
