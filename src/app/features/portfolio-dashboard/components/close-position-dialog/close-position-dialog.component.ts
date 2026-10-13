/**
 * Close Position Dialog
 *
 * Material dialog for closing an equity position. Pre-fills symbol (read-only)
 * and quantity (editable), supports market/limit order types, and calls
 * OrderExecutionService.submitEquityOrder() inline — staying open through
 * submission to show success/error states.
 */
import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { OrderExecutionService, ExecutionResult } from '../../../savant-trader/services/order-execution.service';
import { EquityOrderTicket } from '../../../savant-trader/services/order-ticket.types';
import { EquityPosition } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { buildClosePositionTicket } from '../../../savant-trader/utils/close-position-ticket.util';

export interface ClosePositionDialogData {
  position: EquityPosition;
  currentPrice: number;
  accountNumber: string;
}

type DialogState = 'editing' | 'submitting' | 'success' | 'error';

@Component({
  selector: 'app-close-position-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDialogModule,
    MatIconModule,
  ],
  templateUrl: './close-position-dialog.component.html',
  styleUrl: './close-position-dialog.component.scss',
})
export class ClosePositionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<ClosePositionDialogComponent, boolean>);
  private readonly orderExecution = inject(OrderExecutionService);
  private readonly data = inject(MAT_DIALOG_DATA) as ClosePositionDialogData;

  readonly symbol = computed(() => this.data.position.symbol);
  readonly positionQuantity = computed(() => this.data.position.quantity ?? 0);
  readonly currentPrice = computed(() => this.data.currentPrice);
  readonly accountNumber = computed(() => this.data.accountNumber);

  readonly quantity = signal<string>(String(this.positionQuantity()));
  readonly orderType = signal<'market' | 'limit'>('market');
  readonly limitPrice = signal<string>('');
  readonly state = signal<DialogState>('editing');
  readonly result = signal<ExecutionResult | null>(null);
  /** Last built ticket, retained for retry to preserve refId idempotency. */
  private lastTicket: EquityOrderTicket | null = null;

  readonly isLimit = computed(() => this.orderType() === 'limit');
  readonly error = computed(() => this.state() === 'error' ? this.result()?.error?.message ?? 'Unknown error' : null);
  readonly canRetry = computed(() => this.result()?.error?.retryable ?? true);

  /** Validate quantity is positive and does not exceed position. */
  readonly canSubmit = computed(() => {
    if (this.state() === 'submitting') return false;
    const qty = parseFloat(this.quantity());
    if (!Number.isFinite(qty) || qty <= 0) return false;
    if (qty > this.positionQuantity()) return false;
    if (this.isLimit()) {
      const lp = parseFloat(this.limitPrice());
      if (!Number.isFinite(lp) || lp <= 0) return false;
    }
    return true;
  });

  /** Switch to limit and default the limit price to current price. */
  onOrderTypeChange(type: 'market' | 'limit'): void {
    this.orderType.set(type);
    if (type === 'limit' && !this.limitPrice()) {
      const price = this.currentPrice();
      if (Number.isFinite(price)) {
        this.limitPrice.set(price.toFixed(2));
      }
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.canSubmit()) return;
    const lp = this.isLimit() ? parseFloat(this.limitPrice()) : undefined;
    // Build once — a retry must resubmit the same refId so RH idempotency
    // dedupes a retry of a placement that registered broker-side but whose
    // response was lost.
    this.lastTicket = buildClosePositionTicket(
      this.data.position,
      this.orderType(),
      this.quantity(),
      this.accountNumber(),
      lp,
    );
    await this.submitTicket();
  }

  async onRetry(): Promise<void> {
    if (this.state() === 'submitting' || !this.lastTicket) return;
    await this.submitTicket();
  }

  /** Submit the last built ticket to the broker and transition to success/error state. */
  private async submitTicket(): Promise<void> {
    if (!this.lastTicket) return;
    this.state.set('submitting');
    // Once a submission runs, ESC/backdrop must stay disabled — a dismiss
    // resolves afterClosed with undefined (no refresh) while the attempt may
    // have registered broker-side. Cancel/Done close true and stay available.
    this.dialogRef.disableClose = true;
    try {
      const res = await this.orderExecution.submitEquityOrder(this.lastTicket);
      this.result.set(res);
      this.state.set(res.success ? 'success' : 'error');
    } catch (e) {
      this.result.set({
        success: false,
        error: { message: e instanceof Error ? e.message : String(e), retryable: true },
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
