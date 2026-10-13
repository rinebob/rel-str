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
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AppRoutes } from '../../core/common/interfaces';
import { BrokerOrder } from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import { OrderExecutionService } from '../savant-trader/services/order-execution.service';
import { buildModifyOrderTicket } from '../savant-trader/utils/modify-order-ticket.util';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import { SectionName } from './portfolio-dashboard.types';
import { AccountSummaryComponent } from './components/account-summary.component';
import { AccountSwitcherComponent } from './components/account-switcher.component';
import { EquityPositionsTableComponent } from './components/equity-positions-table.component';
import { OptionPositionsTableComponent } from './components/option-positions-table.component';
import { OpenOrdersTableComponent } from './components/open-orders-table.component';
import { OrderHistoryTableComponent } from './components/order-history-table.component';
import { ClosePositionDialogComponent, ClosePositionDialogData } from './components/close-position-dialog/close-position-dialog.component';
import { ConfirmDialogComponent } from './components/confirm-dialog.component';
import { ModifyOrderDialogComponent } from './components/modify-order-dialog.component';
import { StopLossDialogComponent, StopLossDialogData } from './components/stop-loss-dialog/stop-loss-dialog.component';
import { EquityPositionWithPnL } from './portfolio-dashboard.types';
import { orderMark } from './utils/order-mark.util';

@Component({
  selector: 'app-portfolio-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
    AccountSummaryComponent,
    AccountSwitcherComponent,
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
  private readonly snackBar = inject(MatSnackBar);
  private readonly orderExecution = inject(OrderExecutionService);

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

  onAccountSelect(index: number): void {
    this.store.selectAccount(index);
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

  onCancelOrder(order: BrokerOrder): void {
    const account = this.selectedAccount();
    if (!account) return;
    const summary = `${order.side} ${order.type} ${order.symbol ?? order.orderId.slice(0, 8)}`;
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Cancel order',
          message: `Cancel the ${summary} order?`,
          confirmLabel: 'Cancel Order',
        },
      })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (confirmed !== true) return;
        const res = order.instrumentType === 'option'
          ? await this.orderExecution.cancelOptionOrder(account.accountNumber, order.orderId)
          : await this.orderExecution.cancelEquityOrder(account.accountNumber, order.orderId);
        if (res.success) {
          this.snackBar.open('Order cancelled', 'Dismiss', { duration: 3000 });
          this.store.refresh().catch(() => {});
        } else {
          this.snackBar.open(`Cancel failed: ${res.error?.message ?? 'unknown error'}`, 'Dismiss', {
            duration: 5000,
          });
        }
      });
  }

  /** Bulk cancel — one confirmation, then each selected order cancelled in
   *  sequence via the same per-order path. Refresh once at the end. */
  onCancelSelected(orders: BrokerOrder[]): void {
    const account = this.selectedAccount();
    if (!account || orders.length === 0) return;
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: 'Cancel orders',
          message: `Cancel ${orders.length} open ${orders.length === 1 ? 'order' : 'orders'}?`,
          confirmLabel: 'Cancel Orders',
        },
      })
      .afterClosed()
      .subscribe(async (confirmed) => {
        if (confirmed !== true) return;
        let ok = 0;
        const failures: string[] = [];
        for (const order of orders) {
          const res = order.instrumentType === 'option'
            ? await this.orderExecution.cancelOptionOrder(account.accountNumber, order.orderId)
            : await this.orderExecution.cancelEquityOrder(account.accountNumber, order.orderId);
          if (res.success) ok++;
          else failures.push(order.symbol ?? order.orderId.slice(0, 8));
        }
        const msg = failures.length === 0
          ? `${ok} ${ok === 1 ? 'order' : 'orders'} cancelled`
          : `${ok} cancelled, ${failures.length} failed (${failures.join(', ')})`;
        this.snackBar.open(msg, 'Dismiss', { duration: 5000 });
        if (ok > 0) this.store.refresh().catch(() => {});
      });
  }

  /** Per-row Modify — equity limit orders only (the table gates the button).
   *  Cancel-and-replace: RH has no modify endpoint, and the cancelled order's
   *  ref_id is burned so the replacement ticket mints a fresh one. */
  onModifyOrder(order: BrokerOrder): void {
    const account = this.selectedAccount();
    if (!account) return;
    const mark = orderMark(order, account.equityQuotes.data, account.optionQuotes.data);
    this.dialog
      .open(ModifyOrderDialogComponent, { data: { order, markPrice: mark } })
      .afterClosed()
      .subscribe(async (newPrice: number | undefined) => {
        if (newPrice == null) return;
        const cancel = await this.orderExecution.cancelEquityOrder(
          account.accountNumber,
          order.orderId,
        );
        if (!cancel.success) {
          this.snackBar.open(
            `Modify aborted — cancel failed: ${cancel.error?.message ?? 'unknown error'}. The order may still be live.`,
            'Dismiss',
            { duration: 5000 },
          );
          return;
        }
        const place = await this.orderExecution.submitEquityOrder(
          buildModifyOrderTicket(order, newPrice),
        );
        if (place.success) {
          this.snackBar.open('Order replaced', 'Dismiss', { duration: 3000 });
        } else {
          this.snackBar.open(
            `Order cancelled but replacement failed: ${place.error?.message ?? 'unknown error'}. Re-place manually if still needed.`,
            'Dismiss',
            { duration: 6000 },
          );
        }
        this.store.refresh().catch(() => {});
      });
  }

  formatCurrency(value: number | null): string {
    if (value === null) return '—';
    return this.currencyFormatter.format(value);
  }
}
