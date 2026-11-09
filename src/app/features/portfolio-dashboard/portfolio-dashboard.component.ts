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
 * On init: calls store.initialLoad() — selected account's visible sections
 * gate the UI, everything else prefetches silently behind it (#1408).
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ComponentType } from '@angular/cdk/portal';
import { RouterLink } from '@angular/router';
import { DsDialogService } from '../../shared/ds/ds-dialog';

import { DsToastService } from '../../shared/ds/ds-toast.service';

import { AppRoutes } from '../../core/common/interfaces';
import { BrokerOrder } from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import { ExecutionResult, OrderExecutionService } from '../savant-trader/services/order-execution.service';
import { buildModifyOrderTicket } from '../savant-trader/utils/modify-order-ticket.util';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import { PD_SHOW_AMOUNTS_KEY } from './portfolio-dashboard.helpers';
import { SectionName } from './portfolio-dashboard.types';
import { AccountSummaryComponent } from './components/account-summary.component';
import { AccountSwitcherComponent } from './components/account-switcher.component';
import { EquityPositionsTableComponent } from './components/equity-positions-table.component';
import { OptionPositionsTableComponent } from './components/option-positions-table.component';
import { OpenOrdersTableComponent } from './components/open-orders-table.component';
import { OrderHistoryTableComponent } from './components/order-history-table.component';
import { ClosePositionDialogComponent, ClosePositionDialogData } from './components/close-position-dialog/close-position-dialog.component';
import { ConfirmDialogComponent } from '../../shared/ds/confirm-dialog.component';
import { ModifyOrderDialogComponent } from './components/modify-order-dialog.component';
import { StopLossDialogComponent, StopLossDialogData } from './components/stop-loss-dialog/stop-loss-dialog.component';
import { EquityPositionWithPnL } from './portfolio-dashboard.types';
import { orderMark } from './utils/order-mark.util';

@Component({
  selector: 'app-portfolio-dashboard',
  standalone: true,
  imports: [
    RouterLink,
    AccountSummaryComponent,
    AccountSwitcherComponent,
    EquityPositionsTableComponent,
    OptionPositionsTableComponent,
    OpenOrdersTableComponent,
    OrderHistoryTableComponent],
  templateUrl: './portfolio-dashboard.component.html',
  styleUrl: './portfolio-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioDashboardComponent implements OnInit {
  readonly store = inject(PortfolioDashboardStore);
  private readonly dialog = inject(DsDialogService);
  private readonly snackBar = inject(DsToastService);
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
  /** Live equity stops eligible for Update Stop, grouped by symbol (#888). */
  readonly updatableStops = this.store.updatableStops;
  readonly updatableSymbols = computed(() => new Set(this.updatableStops().keys()));
  /** Display stop order per symbol — drives the positions-table Stop
   *  column (#1414); includes stop-limits (shown, not updatable). */
  readonly protectiveStops = this.store.protectiveStops;
  /** Whether the selected account is agent-enabled (controls action button visibility). */
  readonly agenticAllowed = computed(() => this.selectedAccount()?.agenticAllowed ?? false);

  readonly allocationRoute = '/' + AppRoutes.PORTFOLIO_ALLOCATION;

  /** Dollar totals in the header scoreboard are hidden until the user opts
   *  in — holdings tables are unaffected. Persisted per-browser. */
  readonly showAmounts = signal(localStorage.getItem(PD_SHOW_AMOUNTS_KEY) === '1');

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
    this.store.initialLoad().catch(() => {
      // initialLoad() catches and sets loadError; this prevents unhandled rejection.
    });
  }

  onRefresh(): void {
    this.store.refresh().catch(() => {});
  }

  onAccountSelect(index: number): void {
    this.store.selectAccount(index).catch(() => {});
  }

  /** Section tabs that read the orders group — Orders + History. Keep in
   *  sync with the tab-bar order in the template. */
  private readonly ordersTabs = new Set([2, 3]);

  /** Orders + History tabs read the orders group — kick its fetch if the
   *  prefetch wave hasn't reached it yet (#1408 on-demand activation). */
  selectSection(n: number): void {
    this.selectedSection.set(n);
    if (this.ordersTabs.has(n)) {
      this.store.ensureAccountOrders(this.selectedAccountIndex()).catch(() => {});
    }
  }

  /** WAI-ARIA tabs keyboard nav: arrows move + activate, Home/End jump. */
  onTabKeydown(event: KeyboardEvent): void {
    const tabs = Array.from(
      (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('.tab'),
    );
    const count = tabs.length;
    if (count === 0) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight': next = (this.selectedSection() + 1) % count; break;
      case 'ArrowLeft':  next = (this.selectedSection() - 1 + count) % count; break;
      case 'Home':       next = 0; break;
      case 'End':        next = count - 1; break;
      default: return;
    }
    event.preventDefault();
    this.selectSection(next);
    tabs[next]?.focus();
  }

  toggleAmounts(): void {
    const next = !this.showAmounts();
    this.showAmounts.set(next);
    localStorage.setItem(PD_SHOW_AMOUNTS_KEY, next ? '1' : '0');
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
    this.openThenRefresh(ClosePositionDialogComponent, data);
  }

  /** Peak record + pending flag for dialog decision context (#1415) —
   *  undefined peak + pending=true renders '…'; error/null → '—'. */
  private peakContext(symbol: string): Pick<StopLossDialogData, 'peak' | 'peaksPending'> {
    const section = this.selectedAccount()?.positionPeaks;
    const peak = section?.data?.[symbol];
    return { peak: peak ?? null, peaksPending: peak === undefined && section?.error == null };
  }

  onAddStopLoss(position: EquityPositionWithPnL): void {
    const account = this.selectedAccount();
    if (!account) return;
    const data: StopLossDialogData = {
      position,
      currentPrice: position.currentPrice ?? 0,
      accountNumber: account.accountNumber,
      ...this.peakContext(position.symbol),
    };
    this.openThenRefresh(StopLossDialogComponent, data, 'orders');
  }

  /** Update Stop — opens the same dialog in update mode with the symbol's
   *  live protective stops as replacement candidates (#888). */
  onUpdateStop(position: EquityPositionWithPnL): void {
    const account = this.selectedAccount();
    const candidates = this.updatableStops().get(position.symbol);
    if (!account || !candidates?.length) return;
    const data: StopLossDialogData = {
      position,
      currentPrice: position.currentPrice ?? 0,
      accountNumber: account.accountNumber,
      ...this.peakContext(position.symbol),
      update: { candidates },
    };
    this.openThenRefresh(StopLossDialogComponent, data, 'orders');
  }

  /** Open a dialog that reports mutation via close(true) — reconcile store
   *  state with the broker. 'all' (default) runs the full dashboard refresh;
   *  'orders' silently refetches only the orders batch in the background —
   *  no loading flags, no spinners — so the dashboard stays fully
   *  interactive while the slow RH call resolves (#1397). */
  private openThenRefresh<T>(
    component: ComponentType<T>,
    data: unknown,
    scope: 'all' | 'orders' = 'all',
  ): void {
    this.dialog
      .open(component, { data })
      .afterClosed()
      .subscribe((result) => {
        if (result !== true) return;
        if (scope === 'orders') {
          this.store.reconcileOrders(this.selectedAccountIndex()).catch(() => {});
          return;
        }
        this.store.refresh().catch(() => {});
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
        const res = await this.cancelOne(account.accountNumber, order);
        this.store.refresh().catch(() => {});
        if (res.success) {
          this.snackBar.open('Order cancelled', 'Dismiss', { duration: 3000 });
        } else {
          this.snackBar.open(`Cancel failed: ${res.error?.message ?? 'unknown error'}`, 'Dismiss', {
            duration: 5000,
          });
        }
      });
  }

  private cancelOne(accountNumber: string, order: BrokerOrder): Promise<ExecutionResult> {
    return order.instrumentType === 'option'
      ? this.orderExecution.cancelOptionOrder(accountNumber, order.orderId)
      : this.orderExecution.cancelEquityOrder(accountNumber, order.orderId);
  }

  /** Bulk cancel — one confirmation, then all selected orders cancelled in
   *  parallel (no ordering dependency). Always refreshes: an all-failures
   *  outcome is exactly when broker state may have diverged from the list. */
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
        const settled = await Promise.allSettled(
          orders.map((o) => this.cancelOne(account.accountNumber, o)),
        );
        const failures: string[] = [];
        settled.forEach((res, i) => {
          if (res.status !== 'fulfilled' || !res.value.success) {
            failures.push(orders[i].symbol ?? orders[i].orderId.slice(0, 8));
          }
        });
        const ok = orders.length - failures.length;
        const msg = failures.length === 0
          ? `${ok} ${ok === 1 ? 'order' : 'orders'} cancelled`
          : `${ok} cancelled, ${failures.length} failed (${failures.join(', ')})`;
        this.snackBar.open(msg, 'Dismiss', { duration: 5000 });
        this.store.refresh().catch(() => {});
      });
  }

  /** Per-row Modify — equity limit orders only (the table gates the button).
   *  Cancel-and-replace via the service's hardened replace flow: awaits the
   *  cancel's terminal state before placing (an accepted cancel can still
   *  fill), then places the fresh-refId ticket with bounded retry. */
  onModifyOrder(order: BrokerOrder): void {
    const account = this.selectedAccount();
    if (!account) return;
    const mark = orderMark(order, account.equityQuotes.data, account.optionQuotes.data);
    this.dialog
      .open(ModifyOrderDialogComponent, { data: { order, markPrice: mark } })
      .afterClosed()
      .subscribe(async (newPrice: number | undefined) => {
        if (newPrice == null) return;
        const ticket = buildModifyOrderTicket(order, newPrice);
        if (!ticket) {
          this.snackBar.open(
            'Cannot build a replacement ticket for this order — nothing was cancelled.',
            'Dismiss',
            { duration: 5000 },
          );
          return;
        }
        const res = await this.orderExecution.replaceEquityOrder(
          account.accountNumber,
          order.orderId,
          ticket,
          'order',
        );
        // Always reconcile — every failure branch leaves broker state in
        // question (live original, unprotected gap, or unconfirmed place).
        this.store.refresh().catch(() => {});
        if (res.success) {
          this.snackBar.open('Order replaced', 'Dismiss', { duration: 3000 });
        } else if (res.phase === 'cancel') {
          this.snackBar.open(
            `Modify aborted — ${res.error?.message ?? 'cancel failed'}. The order may still be live.`,
            'Dismiss',
            { duration: 6000 },
          );
        } else if (res.unprotected) {
          this.snackBar.open(
            `Order cancelled but the replacement never landed: ${res.error?.message ?? 'unknown error'}. Re-place manually if still needed.`,
            'Dismiss',
            { duration: 6000 },
          );
        } else {
          this.snackBar.open(
            `Replacement state unclear — ${res.error?.message ?? 'unknown error'}. Check open orders before retrying.`,
            'Dismiss',
            { duration: 6000 },
          );
        }
      });
  }

  formatCurrency(value: number | null): string {
    if (value === null) return '—';
    return this.currencyFormatter.format(value);
  }
}
