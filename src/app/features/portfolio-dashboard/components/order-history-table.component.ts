/**
 * OrderHistoryTableComponent — table of historical (terminal-state) orders.
 *
 * Columns: Symbol, Side, Type, State, Qty, Fill Qty, Avg Fill Price, Created.
 * No actions column — terminal orders are immutable.
 */
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { compareSortable, SortDirection } from '../utils/table-sort.util';
import { orderSymbolLabel } from '../utils/order-display.util';

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
  imports: [],
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

  /** Instrument-grouped rows — option and equity orders get their own
   *  <tbody> + group header so a 'NFLX' option row can't masquerade as the
   *  equity (#1411 QA). Sort applies within each group; equity first. */
  readonly orderGroups = computed(() => {
    const sorted = this.sortedOrders();
    const equity = sorted.filter((o) => o.instrumentType === 'equity');
    const option = sorted.filter((o) => o.instrumentType === 'option');
    const groups: { key: string; label: string; orders: BrokerOrder[] }[] = [];
    if (equity.length) groups.push({ key: 'equity', label: 'Equity Orders', orders: equity });
    if (option.length) groups.push({ key: 'option', label: 'Option Orders', orders: option });
    return groups;
  });

  /** Symbol-cell label — contract terms for option rows. */
  readonly symbolLabel = orderSymbolLabel;

  /** Collapsed instrument groups — keyed by group.key. Transient view
   *  state (reset on remount), not a persisted preference. */
  readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  isGroupCollapsed(key: string): boolean {
    return this.collapsedGroups().has(key);
  }

  toggleGroup(key: string): void {
    this.collapsedGroups.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
