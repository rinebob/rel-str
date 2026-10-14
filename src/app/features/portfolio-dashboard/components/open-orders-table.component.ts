/**
 * OpenOrdersTableComponent — table of open (live/resting) orders that will
 * open a position.
 *
 * Columns: select, Symbol, Side, Type, State, Quantity, Price, Stop Price,
 * Mark, Dist %, Created, Actions (Modify, Cancel). Closing orders —
 * stop-loss sells, take-profit exits, option legs with positionEffect
 * 'close' — are filtered out; they live under History once terminal.
 *
 * Modify is equity-limit only (cancel + re-place — no broker-side modify,
 * and no option placement path exists). Bulk actions: Cancel only —
 * per-row Modify is intentionally one-at-a-time.
 */
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  BrokerOrder,
  EquityQuote,
  OptionQuote,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { compareSortable, SortDirection } from '../utils/table-sort.util';
import { orderMark } from '../utils/order-mark.util';

/** Sortable column keys — selection and Actions are intentionally excluded. */
type SortKey =
  | 'symbol'
  | 'side'
  | 'type'
  | 'state'
  | 'quantity'
  | 'price'
  | 'stopPrice'
  | 'mark'
  | 'dist'
  | 'createdAt';

@Component({
  selector: 'app-open-orders-table',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './open-orders-table.component.html',
  styleUrl: './open-orders-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OpenOrdersTableComponent {
  readonly orders = input<BrokerOrder[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** Whether the selected account is agent-enabled (cancel requires it). */
  readonly agenticAllowed = input(true);
  /** Live marks — equity quotes keyed by symbol, option quotes by instrumentId. */
  readonly equityQuotes = input<Map<string, EquityQuote> | null>(null);
  readonly optionQuotes = input<Map<string, OptionQuote> | null>(null);
  readonly retry = output<void>();
  /** Emits the order when the user clicks Cancel. */
  readonly cancelOrder = output<BrokerOrder>();
  /** Emits the order when the user clicks Modify (equity limit rows only). */
  readonly modifyOrder = output<BrokerOrder>();
  /** Emits the selected orders when the bulk Cancel button is clicked. */
  readonly cancelSelected = output<BrokerOrder[]>();

  /** Opening orders only — position-closing rows are out of scope here. */
  readonly visibleOrders = computed(() => this.orders().filter((o) => this.isOpeningOrder(o)));

  readonly sortKey = signal<SortKey>('createdAt');
  readonly sortDir = signal<SortDirection>('asc');

  /** Rows rendered by the table — opening orders in the active sort order. */
  readonly sortedOrders = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    return [...this.visibleOrders()].sort((a, b) =>
      compareSortable(this.sortValue(a, key), this.sortValue(b, key), dir),
    );
  });

  readonly hasOrders = computed(() => this.visibleOrders().length > 0);

  /** Selected order ids — pruned to orders still present in the list. */
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly selectedOrders = computed(() => {
    const ids = this.selected();
    return this.sortedOrders().filter((o) => ids.has(o.orderId));
  });
  readonly selectedCount = computed(() => this.selectedOrders().length);
  readonly allSelected = computed(
    () => this.sortedOrders().length > 0 &&
      this.sortedOrders().every((o) => this.selected().has(o.orderId)),
  );

  toggleSelected(order: BrokerOrder): void {
    this.selected.update((s) => {
      const next = new Set(s);
      if (next.has(order.orderId)) next.delete(order.orderId);
      else next.add(order.orderId);
      return next;
    });
  }

  toggleAll(): void {
    if (this.allSelected()) {
      this.selected.set(new Set());
    } else {
      this.selected.set(new Set(this.sortedOrders().map((o) => o.orderId)));
    }
  }

  emitCancelSelected(): void {
    this.cancelSelected.emit(this.selectedOrders());
  }

  /** Mark for the order — equity joins on symbol; a single-leg option joins
   *  on legs[0].optionId; multi-leg orders have no single mark. */
  markFor(order: BrokerOrder): number | null {
    return orderMark(order, this.equityQuotes(), this.optionQuotes());
  }

  /** |limit − mark| / mark as a percentage — limit orders with a live mark
   *  only; null renders '—'. */
  distFor(order: BrokerOrder): number | null {
    const mark = this.markFor(order);
    if (order.type !== 'limit' || order.price == null || mark == null || mark === 0) return null;
    return (Math.abs(order.price - mark) / mark) * 100;
  }

  /** Modify is equity limit orders only — options lack a place path and
   *  non-limit types have no price to move. */
  canModify(order: BrokerOrder): boolean {
    return order.instrumentType === 'equity' && order.type === 'limit' && order.price != null;
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

  /** True when the order opens (or adds to) a position. Option legs carry an
   *  explicit positionEffect — any 'open' leg qualifies (a roll opens one
   *  position while closing another). Without leg data, a buy side opens in
   *  this long-only context; sells close. */
  private isOpeningOrder(order: BrokerOrder): boolean {
    const effects = (order.legs ?? [])
      .map((l) => l.positionEffect)
      .filter((e) => e != null);
    if (effects.length > 0) return effects.includes('open');
    return order.side === 'buy';
  }

  private sortValue(o: BrokerOrder, key: SortKey): string | number | null {
    switch (key) {
      case 'symbol': return o.symbol;
      case 'side': return o.side;
      case 'type': return o.type;
      case 'state': return o.state;
      case 'quantity': return o.quantity;
      case 'price': return o.price;
      case 'stopPrice': return o.stopPrice;
      case 'mark': return this.markFor(o);
      case 'dist': return this.distFor(o);
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

  formatPercent(value: number | null): string {
    if (value == null) return '—';
    return `${value.toFixed(2)}%`;
  }

  formatDate(dateStr: string | null | undefined): string {
    if (dateStr == null) return '—';
    return dateStr.slice(0, 10);
  }
}
