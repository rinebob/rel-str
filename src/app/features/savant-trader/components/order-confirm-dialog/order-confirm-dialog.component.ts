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

import { OrderTicket, InstrumentType } from '../../services/order-ticket.types';
import { GuardrailWarning } from '../../utils/order-guardrails.util';

/** Data injected into the confirm dialog. */
export interface OrderConfirmDialogData {
  ticket: OrderTicket;
  warnings?: GuardrailWarning[];
}

@Component({
  selector: 'app-order-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './order-confirm-dialog.component.html',
  styleUrl: './order-confirm-dialog.component.scss',
})
export class OrderConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderConfirmDialogComponent, boolean>);

  /** The ticket data injected via MAT_DIALOG_DATA. */
  readonly data = inject(MAT_DIALOG_DATA) as OrderConfirmDialogData;

  /** The ticket to confirm. */
  readonly ticket = computed(() => this.data.ticket);

  /** Guardrail warnings. */
  readonly warnings = computed(() => this.data.warnings ?? []);

  /** Whether the submit is blocked (hard stop). */
  readonly isBlocked = computed(() => this.warnings().some((w) => w.severity === 'block'));

  /** Display symbol for the ticket. */
  readonly symbol = computed(() => {
    const i = this.ticket();
    if (i.instrumentType === InstrumentType.OPTION) return i.legs[0]?.symbol ?? '?';
    return i.symbol;
  });

  /** Quantity display. */
  readonly quantity = computed(() => {
    const i = this.ticket();
    if (i.instrumentType === InstrumentType.OPTION) return i.quantity;
    return i.quantity ?? i.dollarAmount ?? '—';
  });

  /** Limit price (equity/etf only). */
  readonly limitPrice = computed(() => {
    const i = this.ticket();
    if (i.instrumentType === InstrumentType.OPTION) return undefined;
    return i.limitPrice;
  });

  /** Stop price (equity/etf only). */
  readonly stopPrice = computed(() => {
    const i = this.ticket();
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
