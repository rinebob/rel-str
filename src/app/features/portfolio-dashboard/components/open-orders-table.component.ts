/**
 * OpenOrdersTableComponent — table of open (live/resting) orders.
 *
 * Columns: Symbol, Side, Type, State, Quantity, Price, Stop Price, Created,
 * plus a stop-loss indicator for orders protecting a position.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

@Component({
  selector: 'app-open-orders-table',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './open-orders-table.component.html',
  styleUrl: './open-orders-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenOrdersTableComponent {
  readonly orders = input<BrokerOrder[]>([]);
  readonly protectedSymbols = input<Set<string>>(new Set());
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

  isProtected(order: BrokerOrder): boolean {
    return order.symbol !== null && this.protectedSymbols().has(order.symbol);
  }
}
