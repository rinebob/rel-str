/**
 * PortfolioDashboardComponent — top-level shell for the Portfolio Dashboard.
 *
 * Renders:
 * - Error banner (if loadAccounts fails)
 * - Aggregate summary bar (cross-account totals)
 * - Refresh button
 * - MatTabGroup with one tab per Robinhood account
 * - Per-tab section components: AccountSummary, EquityPositionsTable,
 *   OptionPositionsTable, OpenOrdersTable, OrderHistoryTable
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
import { SectionName } from './portfolio-dashboard.types';
import { AccountSummaryComponent } from './components/account-summary.component';
import { EquityPositionsTableComponent } from './components/equity-positions-table.component';
import { OptionPositionsTableComponent } from './components/option-positions-table.component';
import { OpenOrdersTableComponent } from './components/open-orders-table.component';
import { OrderHistoryTableComponent } from './components/order-history-table.component';

@Component({
  selector: 'app-portfolio-dashboard',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
    AccountSummaryComponent,
    EquityPositionsTableComponent,
    OptionPositionsTableComponent,
    OpenOrdersTableComponent,
    OrderHistoryTableComponent,
  ],
  templateUrl: './portfolio-dashboard.component.html',
  styleUrl: './portfolio-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioDashboardComponent implements OnInit {
  readonly store = inject(PortfolioDashboardStore);

  readonly summary = this.store.aggregateSummary;
  readonly accounts = this.store.accounts;
  readonly selectedAccount = this.store.selectedAccount;
  readonly selectedAccountIndex = this.store.selectedAccountIndex;
  readonly globalLoading = this.store.globalLoading;
  readonly loadError = this.store.loadError;

  readonly equityPositions = this.store.equityPositionsWithPnL;
  readonly optionPositions = this.store.optionPositionsWithPnL;
  readonly openOrders = this.store.openOrders;
  readonly orderHistory = this.store.orderHistory;
  readonly protectedSymbols = this.store.stopLossProtectedSymbols;
  readonly showClosedPositions = this.store.showClosedPositions;
  readonly showOrderHistory = this.store.showOrderHistory;

  readonly hasAccounts = computed(() => this.accounts().length > 0);

  readonly ordersLoading = computed(() => {
    const acct = this.selectedAccount();
    return acct ? acct.equityOrders.loading || acct.optionOrders.loading : false;
  });

  readonly ordersError = computed(() => {
    const acct = this.selectedAccount();
    return acct ? (acct.equityOrders.error ?? acct.optionOrders.error) : null;
  });

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

  onToggleClosedPositions(): void {
    this.store.toggleClosedPositions();
  }

  onToggleOrderHistory(): void {
    this.store.toggleOrderHistory();
  }

  onRetrySection(section: SectionName): void {
    this.store.retrySection(this.selectedAccountIndex(), section);
  }

  formatCurrency(value: number | null): string {
    if (value === null) return '—';
    return this.currencyFormatter.format(value);
  }
}
