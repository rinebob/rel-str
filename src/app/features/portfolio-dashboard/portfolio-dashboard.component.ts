/**
 * PortfolioDashboardComponent — top-level shell for the Portfolio Dashboard.
 *
 * Renders:
 * - Error banner (if loadAccounts fails)
 * - Aggregate summary bar (cross-account totals)
 * - Refresh button
 * - MatTabGroup with one tab per Robinhood account
 * - Per-tab placeholder for section components (Task #286)
 *
 * On init: calls store.refresh() which handles the full load sequence
 * (loadAccounts → loadPhase1 → loadPhase2) with concurrency guard.
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';

@Component({
  selector: 'app-portfolio-dashboard',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  templateUrl: './portfolio-dashboard.component.html',
  styleUrl: './portfolio-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioDashboardComponent implements OnInit {
  readonly store = inject(PortfolioDashboardStore);

  readonly summary = this.store.aggregateSummary;
  readonly accounts = this.store.accounts;
  readonly selectedAccountIndex = this.store.selectedAccountIndex;
  readonly globalLoading = this.store.globalLoading;
  readonly loadError = this.store.loadError;

  readonly hasAccounts = computed(() => this.accounts().length > 0);

  private readonly currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  ngOnInit(): void {
    this.store.refresh().catch(() => {
      // refresh() catches and sets loadError; this prevents unhandled rejection.
    });
  }

  onRefresh(): void {
    this.store.refresh().catch(() => {});
  }

  onTabChange(index: number): void {
    this.store.selectAccount(index);
  }

  formatCurrency(value: number | null): string {
    if (value === null) return '—';
    return this.currencyFormatter.format(value);
  }
}
