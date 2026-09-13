/**
 * EquityPositionsTableComponent — table of equity positions with PnL.
 *
 * Columns: Symbol, Quantity, Avg Cost, Current Price, PnL, PnL%.
 * Shows loading, error with retry, empty states, and a toggle for closed positions.
 * Closed positions (quantity === 0) are hidden by default and shown with muted
 * styling when `showClosed` is true.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { EquityPositionWithPnL } from '../portfolio-dashboard.types';

@Component({
  selector: 'app-equity-positions-table',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './equity-positions-table.component.html',
  styleUrl: './equity-positions-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquityPositionsTableComponent {
  readonly positions = input<EquityPositionWithPnL[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly showClosed = input(false);
  readonly retry = output<void>();
  readonly toggleClosed = output<void>();

  /** Positions filtered by closed state — closed positions hidden unless showClosed is true. */
  readonly visiblePositions = computed(() => {
    const all = this.positions();
    if (this.showClosed()) return all;
    return all.filter((p) => !p.closed);
  });

  readonly hasPositions = computed(() => this.visiblePositions().length > 0);
  readonly hasAnyPositions = computed(() => this.positions().length > 0);

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
