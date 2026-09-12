/**
 * OrderHistoryTableComponent — table of historical (terminal-state) orders.
 *
 * Columns: Symbol, Side, Type, State, Qty, Fill Qty, Avg Fill Price, Created.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

@Component({
  selector: 'app-order-history-table',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './order-history-table.component.html',
  styleUrl: './order-history-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrderHistoryTableComponent {
  readonly orders = input<BrokerOrder[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly retry = output<void>();

  readonly hasOrders = computed(() => this.orders().length > 0);

  private readonly currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });

  private readonly numberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
  });

  formatCurrency(value: number | null | undefined): string {
    if (value == null) return '—';
    return this.currencyFormatter.format(value);
  }

  formatNumber(value: number | null | undefined): string {
    if (value == null) return '—';
    return this.numberFormatter.format(value);
  }

  formatDate(dateStr: string | null | undefined): string {
    if (dateStr == null) return '—';
    return dateStr.slice(0, 10);
  }
}
