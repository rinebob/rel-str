/**
 * OptionPositionsTableComponent — table of option positions with PnL.
 *
 * Columns: Underlying, Type, Strike, Expiration, Quantity, Avg Cost,
 * Current Price, PnL, PnL%.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OptionPositionWithPnL } from '../portfolio-dashboard.types';

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

  readonly hasPositions = computed(() => this.positions().length > 0);

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
}
