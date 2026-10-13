/**
 * OptionPositionsTableComponent — table of option positions with PnL.
 *
 * Columns: Underlying, Type, Strike, Expiration, Quantity, Avg Cost,
 * Current Price, PnL, PnL%.
 */
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OptionPositionWithPnL } from '../portfolio-dashboard.types';
import { compareSortable, SortDirection } from '../utils/table-sort.util';

/** Sortable column keys. */
type SortKey =
  | 'underlying'
  | 'type'
  | 'strike'
  | 'expiration'
  | 'quantity'
  | 'avgCost'
  | 'costBasis'
  | 'currentPrice'
  | 'value'
  | 'pnl'
  | 'pnlPercent';

@Component({
  selector: 'app-option-positions-table',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './option-positions-table.component.html',
  styleUrl: './option-positions-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionPositionsTableComponent {
  readonly positions = input<OptionPositionWithPnL[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly retry = output<void>();

  /** Open positions only — closed rows are out of scope for this table. */
  readonly visiblePositions = computed(() => this.positions().filter((p) => !p.closed));

  readonly sortKey = signal<SortKey>('underlying');
  readonly sortDir = signal<SortDirection>('asc');

  /** Rows rendered by the table — visible positions in the active sort order. */
  readonly sortedPositions = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    return [...this.visiblePositions()].sort((a, b) =>
      compareSortable(this.sortValue(a, key), this.sortValue(b, key), dir),
    );
  });

  readonly hasPositions = computed(() => this.visiblePositions().length > 0);

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

  private sortValue(p: OptionPositionWithPnL, key: SortKey): string | number | null {
    switch (key) {
      case 'underlying': return p.chainSymbol;
      case 'type': return p.optionType;
      case 'strike': return p.strikePrice;
      case 'expiration': return p.expirationDate;
      case 'quantity': return p.quantity;
      case 'avgCost': return p.averageCost;
      case 'costBasis': return this.costBasis(p);
      case 'currentPrice': return p.currentPrice;
      case 'value': return this.currentValue(p);
      case 'pnl': return p.pnl;
      case 'pnlPercent': return p.pnlPercent;
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

  formatPnl(value: number | null | undefined): string {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    return sign + this.currencyFormatter.format(value);
  }

  formatPnlPercent(value: number | null | undefined): string {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
  }

  /** Cost basis = average cost × |quantity|. */
  costBasis(pos: OptionPositionWithPnL): number | null {
    if (pos.averageCost == null || pos.quantity == null) return null;
    return pos.averageCost * Math.abs(pos.quantity);
  }

  /** Current value = current price × |quantity|. */
  currentValue(pos: OptionPositionWithPnL): number | null {
    if (pos.currentPrice == null || pos.quantity == null) return null;
    return pos.currentPrice * Math.abs(pos.quantity);
  }

  /** Sum of cost basis across visible positions. */
  readonly totalCostBasis = computed(() => {
    let total = 0;
    let has = false;
    for (const p of this.visiblePositions()) {
      const cb = this.costBasis(p);
      if (cb != null) { total += cb; has = true; }
    }
    return has ? total : null;
  });

  /** Sum of current value across visible positions. */
  readonly totalValue = computed(() => {
    let total = 0;
    let has = false;
    for (const p of this.visiblePositions()) {
      const cv = this.currentValue(p);
      if (cv != null) { total += cv; has = true; }
    }
    return has ? total : null;
  });

  /** Sum of PnL across visible positions. */
  readonly totalPnL = computed(() => {
    let total = 0;
    let has = false;
    for (const p of this.visiblePositions()) {
      if (p.pnl != null) { total += p.pnl; has = true; }
    }
    return has ? total : null;
  });

  /** Weighted-average PnL% = total PnL / total cost basis. */
  readonly avgPnlPercent = computed(() => {
    const pnl = this.totalPnL();
    const cost = this.totalCostBasis();
    if (pnl == null || cost == null || cost === 0) return null;
    return (pnl / cost) * 100;
  });
}
