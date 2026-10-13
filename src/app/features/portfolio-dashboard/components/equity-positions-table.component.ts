/**
 * EquityPositionsTableComponent — table of equity positions with PnL.
 *
 * Columns: Symbol, Quantity, Avg Cost, Entry, Cost Basis, Current Price,
 * Value, PnL, PnL%.
 * Shows loading, error with retry, and empty states. Closed positions
 * (quantity === 0) are filtered out — realized-P&L history is a separate
 * concern from the open-positions view.
 */
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { EquityPositionWithPnL } from '../portfolio-dashboard.types';
import { compareSortable, SortDirection } from '../utils/table-sort.util';

/** Sortable column keys — Actions is intentionally excluded. */
type SortKey =
  | 'symbol'
  | 'quantity'
  | 'avgCost'
  | 'entry'
  | 'costBasis'
  | 'currentPrice'
  | 'value'
  | 'pnl'
  | 'pnlPercent';

@Component({
  selector: 'app-equity-positions-table',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  templateUrl: './equity-positions-table.component.html',
  styleUrl: './equity-positions-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquityPositionsTableComponent {
  readonly positions = input<EquityPositionWithPnL[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** Symbols with active stop-loss protection — disables the Add Stop button. */
  readonly protectedSymbols = input<Set<string>>(new Set());
  /** Whether the selected account is agent-enabled (controls action button visibility). */
  readonly agenticAllowed = input(true);
  readonly retry = output<void>();
  readonly closePosition = output<EquityPositionWithPnL>();
  /** Emits the position when the user clicks Add Stop. */
  readonly addStopLoss = output<EquityPositionWithPnL>();

  /** Open positions only — closed rows are out of scope for this table. */
  readonly visiblePositions = computed(() => this.positions().filter((p) => !p.closed));

  readonly sortKey = signal<SortKey>('symbol');
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

  private sortValue(p: EquityPositionWithPnL, key: SortKey): string | number | null {
    switch (key) {
      case 'symbol': return p.symbol;
      case 'quantity': return p.quantity;
      case 'avgCost': return p.averageBuyPrice;
      case 'entry': return p.entryDate;
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

  /** ISO timestamp → date-only display (yyyy-MM-dd). */
  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '—';
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

  /** Cost basis = average buy price × |quantity|. */
  costBasis(pos: EquityPositionWithPnL): number | null {
    if (pos.averageBuyPrice == null || pos.quantity == null) return null;
    return pos.averageBuyPrice * Math.abs(pos.quantity);
  }

  /** Current value = current price × |quantity|. */
  currentValue(pos: EquityPositionWithPnL): number | null {
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
