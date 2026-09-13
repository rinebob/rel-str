/**
 * Stop Loss Dialog
 *
 * Material dialog for placing a stop-loss order on an equity position.
 * Embeds the shared StopLossFormComponent for stop price/percent input.
 * Builds a stop-loss ticket via buildPositionStopLossTicket() and calls
 * OrderExecutionService.submitEquityOrder() inline.
 *
 * Retry resubmits the same ticket object (preserving refId idempotency).
 */
import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { OrderExecutionService, ExecutionResult } from '../../../savant-trader/services/order-execution.service';
import { EquityPosition } from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { buildPositionStopLossTicket } from '../../../savant-trader/utils/stop-loss-ticket.util';
import { EquityOrderTicket } from '../../../savant-trader/services/order-ticket.types';
import { StopLossFormComponent } from '../../../../shared/components/stop-loss-form/stop-loss-form.component';

export interface StopLossDialogData {
  position: EquityPosition;
  currentPrice: number;
  accountNumber: string;
}

type DialogState = 'editing' | 'submitting' | 'success' | 'error';

@Component({
  selector: 'app-stop-loss-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    StopLossFormComponent,
  ],
  templateUrl: './stop-loss-dialog.component.html',
  styleUrl: './stop-loss-dialog.component.scss',
})
export class StopLossDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<StopLossDialogComponent, boolean>);
  private readonly orderExecution = inject(OrderExecutionService);
  private readonly data = inject(MAT_DIALOG_DATA) as StopLossDialogData;

  readonly symbol = computed(() => this.data.position.symbol);
  /** Whole-share quantity (truncated) — stop-loss orders require whole shares. */
  readonly quantity = computed(() => String(Math.trunc(this.data.position.quantity ?? 0)));
  readonly currentPrice = computed(() => this.data.currentPrice);
  readonly accountNumber = computed(() => this.data.accountNumber);

  readonly state = signal<DialogState>('editing');
  readonly result = signal<ExecutionResult | null>(null);
  /** Last stop price submitted, for display in the success view. */
  readonly lastStopPrice = signal<number>(0);
  /** Last built ticket, retained for retry to preserve refId idempotency. */
  private lastTicket: EquityOrderTicket | null = null;

  readonly error = computed(() =>
    this.state() === 'error' ? this.result()?.error?.message ?? 'Unknown error' : null,
  );
  readonly canRetry = computed(() => this.result()?.error?.retryable ?? true);

  async onSubmit(event: { stopPrice: number }): Promise<void> {
    if (this.state() === 'submitting') return;
    this.lastStopPrice.set(event.stopPrice);
    this.lastTicket = buildPositionStopLossTicket(
      this.symbol(),
      this.quantity(),
      event.stopPrice,
      this.accountNumber(),
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
    this.dialogRef.close(false);
  }
}
