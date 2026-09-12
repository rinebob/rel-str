/**
 * AccountSummaryComponent — per-account summary card.
 *
 * Displays portfolio snapshot values (total value, equity, cash, buying power,
 * and margin exposure when available). Shows loading, error with retry, and
 * empty states.
 */
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { PortfolioSnapshot } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

@Component({
  selector: 'app-account-summary',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './account-summary.component.html',
  styleUrl: './account-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountSummaryComponent {
  readonly snapshot = input<PortfolioSnapshot | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly retry = output<void>();

  readonly hasMargin = computed(() => this.snapshot()?.marginExposure != null);

  private readonly currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  formatCurrency(value: number | null | undefined): string {
    if (value == null) return '—';
    return this.currencyFormatter.format(value);
  }
}
