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
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AppRoutes } from '../../core/common/interfaces';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import { SectionName } from './portfolio-dashboard.types';
import { AccountSummaryComponent } from './components/account-summary.component';
import { EquityPositionsTableComponent } from './components/equity-positions-table.component';
import { OptionPositionsTableComponent } from './components/option-positions-table.component';
import { OpenOrdersTableComponent } from './components/open-orders-table.component';
import { OrderHistoryTableComponent } from './components/order-history-table.component';
import { ClosePositionDialogComponent, ClosePositionDialogData } from './components/close-position-dialog/close-position-dialog.component';
import { StopLossDialogComponent, StopLossDialogData } from './components/stop-loss-dialog/stop-loss-dialog.component';
import { EquityPositionWithPnL } from './portfolio-dashboard.types';

@Component({
  selector: 'app-portfolio-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatButtonToggleModule,
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
  private readonly dialog = inject(MatDialog);

  readonly summary = this.store.aggregateSummary;
  readonly accounts = this.store.accounts;
  readonly selectedAccount = this.store.selectedAccount;
  readonly selectedAccountIndex = this.store.selectedAccountIndex;
  readonly globalLoading = this.store.globalLoading;
  readonly loadError = this.store.loadError;

  readonly equityPositions = this.store.displayedEquityPositions;
  readonly optionPositions = this.store.optionPositionsWithPnL;
  readonly openOrders = this.store.openOrders;
  readonly orderHistory = this.store.orderHistory;
  readonly protectedSymbols = this.store.stopLossProtectedSymbols;
  readonly showClosedPositions = this.store.showClosedPositions;
  /** Whether the selected account is agent-enabled (controls action button visibility). */
  readonly agenticAllowed = computed(() => this.selectedAccount()?.agenticAllowed ?? false);

  readonly allocationRoute = '/' + AppRoutes.PORTFOLIO_ALLOCATION;

  /** Dollar totals in the header scoreboard are hidden until the user opts
   *  in — holdings tables are unaffected. Persisted per-browser. */
  readonly showAmounts = signal(localStorage.getItem('pd-show-amounts') === '1');

  /** Active section tab: 0 Equities, 1 Options, 2 Orders, 3 History, 4 Account. */
  readonly selectedSection = signal(0);

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

  toggleAmounts(): void {
    const next = !this.showAmounts();
    this.showAmounts.set(next);
    localStorage.setItem('pd-show-amounts', next ? '1' : '0');
  }

  /** Scoreboard display — masked until the user opts in via toggleAmounts. */
  maskedCurrency(value: number | null): string {
    return this.showAmounts() ? this.formatCurrency(value) : '•••';
  }

  onRetrySection(section: SectionName): void {
    this.store.retrySection(this.selectedAccountIndex(), section);
  }

  onClosePosition(position: EquityPositionWithPnL): void {
    const account = this.selectedAccount();
    if (!account) return;
    const data: ClosePositionDialogData = {
      position,
      currentPrice: position.currentPrice ?? 0,
      accountNumber: account.accountNumber,
    };
    this.dialog
      .open(ClosePositionDialogComponent, { data })
      .afterClosed()
      .subscribe((result) => {
        if (result === true) {
          this.store.refresh().catch(() => {});
        }
      });
  }

  onAddStopLoss(position: EquityPositionWithPnL): void {
    const account = this.selectedAccount();
    if (!account) return;
    const data: StopLossDialogData = {
      position,
      currentPrice: position.currentPrice ?? 0,
      accountNumber: account.accountNumber,
    };
    this.dialog
      .open(StopLossDialogComponent, { data })
      .afterClosed()
      .subscribe((result) => {
        if (result === true) {
          this.store.refresh().catch(() => {});
        }
      });
  }

  formatCurrency(value: number | null): string {
    if (value === null) return '—';
    return this.currencyFormatter.format(value);
  }
}
