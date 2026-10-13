/**
 * OrderHistoryTableComponent — table of historical (terminal-state) orders.
 *
 * Columns: Symbol, Side, Type, State, Qty, Fill Qty, Avg Fill Price, Created.
 * No actions column — terminal orders are immutable.
 */
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { compareSortable, SortDirection } from '../utils/table-sort.util';

/** Sortable column keys. */
type SortKey =
  | 'symbol'
  | 'side'
  | 'type'
  | 'state'
  | 'quantity'
  | 'cumulativeQuantity'
  | 'averageFillPrice'
  | 'createdAt';

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

  readonly visibleOrders = computed(() => this.orders());

  readonly sortKey = signal<SortKey>('createdAt');
  readonly sortDir = signal<SortDirection>('desc');

  /** Rows rendered by the table — history orders in the active sort order. */
  readonly sortedOrders = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    return [...this.visibleOrders()].sort((a, b) =>
      compareSortable(this.sortValue(a, key), this.sortValue(b, key), dir),
    );
  });

  readonly hasOrders = computed(() => this.visibleOrders().length > 0);

  /** Click a header: first click sorts ascending, repeat toggles direction. */
  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  sortIcon(key: SortKey): string {
    if (this.sortKey() !== key) return 'unfold_more';
    return this.sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortValue(o: BrokerOrder, key: SortKey): string | number | null {
    switch (key) {
      case 'symbol': return o.symbol;
      case 'side': return o.side;
      case 'type': return o.type;
      case 'state': return o.state;
      case 'quantity': return o.quantity;
      case 'cumulativeQuantity': return o.cumulativeQuantity;
      case 'averageFillPrice': return o.averageFillPrice;
      case 'createdAt': return o.createdAt;
    }
  }

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
