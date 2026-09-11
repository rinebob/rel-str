/**
 * Savant Trader Signal Order Component
 *
 * Master-detail layout for the signal order screen.
 * Left panel: OrderQueueComponent (staged tickets grouped by status).
 * Right panel: ticket placeholder (FE-C1b will replace with OrderTicketComponent).
 *
 * URL: /signal-order
 */
import {
  Component,
  inject,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { OrderTicketStore } from '../../stores/order-ticket.store';
import { OrderQueueComponent } from '../../components/order-queue/order-queue.component';
import { OrderTicketComponent } from '../../components/order-ticket/order-ticket.component';
import { TradingConfigDialogComponent } from '../../components/trading-config-dialog/trading-config-dialog.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { TradingConfigService } from '../../services/trading-config.service';
import { EquityPriceService } from '../../services/equity-price.service';
import { AccountSnapshot, BrokerPosition, PortfolioService } from '../../services/portfolio.service';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { OrderExecutionService } from '../../services/order-execution.service';
import { OrderTicketService } from '../../services/order-ticket.service';
import { OrderTicket, OrderTicketStatus, OrderSource, TradingConfig, InstrumentType } from '../../services/order-ticket.types';
import { BrokerOrderSnapshot } from '../../services/order-ticket.types';
import { formatError } from '../../utils/format-error.util';
import { parseEquityOrdersResponse, isActiveStopLoss, rhStateToTerminalStatus, rhStateToDisplayStatus } from '../../utils/broker-order.util';

@Component({
  selector: 'app-signal-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, OrderQueueComponent, OrderTicketComponent],
  templateUrl: './order.component.html',
  styleUrl: './order.component.scss',
})
export class OrderComponent implements OnInit {
  readonly stagingStore = inject(OrderTicketStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly configService = inject(TradingConfigService);
  private readonly priceService = inject(EquityPriceService);
  private readonly portfolioService = inject(PortfolioService);
  private readonly ticketService = inject(OrderTicketService);
  private readonly mcpService = inject(RobinhoodMcpObservationService);
  private readonly orderExecution = inject(OrderExecutionService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** Currently selected ticket id. */
  readonly selectedTicketId = signal<string | null>(null);

  /** Open RH positions — shown so the user can place protective stops. */
  readonly brokerPositions = signal<BrokerPosition[]>([]);

  /** RH orders keyed by order ID — authoritative for order lifecycle state.
   *  Fetched on page load and after any submit/cancel/stop action. */
  readonly rhOrders = signal<Record<string, BrokerOrderSnapshot>>({});

  /** Whether RH orders have been fetched at least once. */
  readonly rhOrdersLoaded = signal(false);

  /** RH orders as a list (for the order-ticket to search for stops by symbol). */
  readonly rhOrdersList = computed<BrokerOrderSnapshot[]>(() => Object.values(this.rhOrders()));

  /** Set of symbols that have an active protective stop-loss order at RH.
   *  Used by the queue to show the PROTECTED badge on open positions. */
  readonly protectedSymbols = computed<Set<string>>(() => {
    const symbols = new Set<string>();
    for (const o of Object.values(this.rhOrders())) {
      if (isActiveStopLoss(o, o.symbol)) symbols.add(o.symbol);
    }
    return symbols;
  });

  /**
   * All signal entries for display, merged with RH order state.
   *
   * Local docs provide provenance (signal context, refId). RH orders provide
   * authoritative lifecycle state (queued, filled, cancelled, etc.). For each
   * local doc that has a rhOrderId, the status is overridden from the RH order.
   *
   * Open RH positions are also shown so the user can place stops on them.
   * When a broker position exists for a symbol, local filled entries for that
   * symbol are suppressed to avoid duplicate rows.
   */
  readonly allTickets = computed<OrderTicket[]>(() => {
    const positionSymbols = new Set(
      this.brokerPositions()
        .filter((p) => Number(p.quantity) > 0)
        .map((p) => p.symbol),
    );
    const rhOrders = this.rhOrders();
    const rhLoaded = this.rhOrdersLoaded();

    // Local Firestore tickets are provenance records for accepted signals only.
    // Positions, stop losses, and all order lifecycle state come from RH.
    // Submitted/queued tickets are hidden until RH orders are loaded to avoid
    // showing stale statuses that don't match RH.
    const localEntries = Object.values(this.stagingStore.tickets())
      .filter((ticket) => ticket.source === OrderSource.SIGNAL_PIPELINE)
      .map((ticket) => this.mergeWithRhOrder(ticket, rhOrders))
      .filter((ticket) => !this.isSupported(ticket))
      .filter((ticket) => {
        // Suppress local filled entries when a broker position already
        // represents that symbol. Non-filled entries are always kept.
        if (ticket.status !== OrderTicketStatus.FILLED) return true;
        if (ticket.instrumentType !== InstrumentType.EQUITY && ticket.instrumentType !== InstrumentType.ETF) return true;
        return !positionSymbols.has(ticket.symbol);
      })
      .filter((ticket) => {
        // Hide cancelled tickets older than 24 hours — they're stale and
        // can't be requeued. Recent cancellations stay visible for requeue.
        // Uses terminalAt (the RH order's lastTransactionAt) so the recency
        // window is anchored to the actual broker event, not to local writes.
        if (ticket.status !== OrderTicketStatus.CANCELLED) return true;
        const ts = ticket.terminalAt ?? ticket.updatedAt;
        const terminalTime = new Date(ts).getTime();
        if (isNaN(terminalTime)) return true;
        return Date.now() - terminalTime < 24 * 60 * 60 * 1000;
      })
      .filter((ticket) => {
        // Don't show submitted/queued tickets until RH orders are loaded
        // — the local status may be stale (e.g. cancelled at RH)
        if (!rhLoaded) {
          return ticket.status === OrderTicketStatus.STAGED ||
            ticket.status === OrderTicketStatus.FAILED;
        }
        return true;
      });

    const positionRows = this.brokerPositions()
      .filter((p) => Number(p.quantity) > 0)
      .map((p) => this.positionToTicket(p));

    // Add RH stop-loss orders as synthetic rows. Stop losses have no local
    // ticket — they are read directly from RH.
    const rhStopRows = Object.values(rhOrders)
      .filter((o) => isActiveStopLoss(o, o.symbol))
      .map((o) => this.rhStopToTicket(o));

    return [...localEntries, ...positionRows, ...rhStopRows];
  });

  /** The currently selected ticket object (merged with RH order state). */
  readonly selectedTicket = computed<OrderTicket | null>(() => {
    const id = this.selectedTicketId();
    if (!id) return null;
    return this.allTickets().find((i) => i.id === id) ?? null;
  });

  /** Total ticket count for header. */
  readonly ticketCount = computed(() => this.allTickets().length);

  /** Loading state from store. */
  readonly loading = computed(() => this.stagingStore.loading());

  /** Error state from store. */
  readonly error = computed(() => this.stagingStore.error());

  /** Trading config (account + sizing settings). */
  readonly tradingConfig = signal<TradingConfig | null>(null);

  /** Price map from the price service. */
  readonly prices = computed(() => this.priceService.prices());
  readonly pricesLoading = computed(() => this.priceService.loading());
  readonly accountSnapshot = signal<AccountSnapshot | null>(null);

  // Scoreboard computed values
  readonly accountNumber = computed(() => this.tradingConfig()?.accountNumber ?? '');
  readonly accountValue = computed(() => this.accountSnapshot()?.accountValue ?? 0);

  /** Account display name (type + redacted number). */
  readonly accountName = computed(() => {
    const num = this.accountNumber();
    if (!num) return '—';
    // Show only last 4 digits in dashboards
    const tail = num.length > 4 ? num.slice(-4) : num;
    return `agentic ••••${tail}`;
  });

  readonly maxAllocationPercent = computed(() => this.tradingConfig()?.maxAllocationPercent ?? 80);
  readonly allocationCap = computed(() => this.accountValue() * (this.maxAllocationPercent() / 100));
  readonly defaultDollarAmount = computed(() => this.tradingConfig()?.defaultDollarAmount ?? 100);
  readonly maxUnits = computed(() => this.tradingConfig()?.maxUnits ?? 200);

  /** Current total equity exposure from Robinhood. */
  readonly currentExposure = computed(() => this.accountSnapshot()?.exposure ?? 0);

  /** Current open units from the canonical account snapshot. */
  readonly currentUnits = computed(() => this.accountSnapshot()?.units ?? 0);

  /** Available brokerage cash. */
  readonly availableCash = computed(() => this.accountSnapshot()?.cash ?? 0);

  /** Allocation percentage used. */
  readonly allocationPercent = computed(() => {
    const av = this.accountValue();
    if (av <= 0) return 0;
    return Math.round((this.currentExposure() / av) * 1000) / 10;
  });

  /** Count of open Robinhood equity positions. */
  readonly positionCount = computed(() => this.accountSnapshot()?.positionCount ?? 0);

  /** Guardrail context for the order ticket. */
  readonly guardrailContext = computed(() => ({
    currentExposure: this.currentExposure(),
    currentUnits: this.currentUnits(),
    availableCash: this.availableCash(),
    allocationCap: this.allocationCap(),
    maxUnits: this.maxUnits(),
  }));

  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.stagingStore.loadTickets();
    this.loadConfig();
  }

  constructor() {
    // Fetch prices when tickets are loaded or change
    effect(() => {
      const tickets = this.allTickets();
      untracked(() => {
        if (tickets.length > 0) {
          this.fetchPrices();
          if (!this.selectedTicketId()) {
            this.selectedTicketId.set(tickets[0].id);
          }
        }
      });
    });

    // Load the canonical account snapshot and RH orders when the configured account changes.
    effect(() => {
      const accountNumber = this.accountNumber();
      if (accountNumber) {
        this.fetchAccountSnapshot(accountNumber);
        this.refreshRhOrders(accountNumber);
      }
    });

    // Terminal-state reconciliation: when RH orders are loaded, batch-update
    // local signal tickets whose broker order has reached a terminal state
    // (cancelled, filled, failed, rejected, voided). This is the only lifecycle
    // state written locally — intermediate states still come from RH.
    // The store commits all terminal updates in a single Firestore batch and
    // uses the RH order's lastTransactionAt as the terminalAt timestamp.
    effect(() => {
      const rhOrders = this.rhOrders();
      if (!this.rhOrdersLoaded()) return;
      untracked(() => this.stagingStore.reconcileTerminalStatuses(rhOrders));
    });
  }

  /** Load trading config and account info. */
  private loadConfig(): void {
    this.configService.loadConfig().subscribe({
      next: (config) => {
        this.tradingConfig.set(config);
      },
      error: (err) => {
        console.error('[OrderComponent] Failed to load trading config:', err);
      },
    });
  }

  /** Fetch the canonical Robinhood account snapshot used by the scoreboard and guardrails. */
  private async fetchAccountSnapshot(accountNumber: string): Promise<void> {
    try {
      const snapshot = await this.portfolioService.getSnapshot(accountNumber, this.defaultDollarAmount());
      this.accountSnapshot.set(snapshot);
      if (snapshot) {
        this.brokerPositions.set(snapshot.positions);
      }
    } catch (err) {
      console.error('[OrderComponent] Failed to fetch account snapshot:', err);
    }
  }

  /** Fetch RH orders and update the rhOrders signal. Called on page load
   *  and after any submit/cancel/stop action to refresh order state. */
  async refreshRhOrders(accountNumber?: string): Promise<void> {
    const acct = accountNumber ?? this.accountNumber();
    if (!acct) return;
    try {
      const result = await this.mcpService.executeTool('get_equity_orders', {
        args: { account_number: acct },
      });
      if (!result.success) return;
      this.rhOrders.set(parseEquityOrdersResponse(result.parsed));
      this.rhOrdersLoaded.set(true);
    } catch (err) {
      console.error('[OrderComponent] Failed to fetch RH orders:', err);
    }
  }

  /** Fetch prices for all unique symbols in the queue. */
  private fetchPrices(): void {
    const symbols = this.allTickets()
      .filter((i) => i.instrumentType === InstrumentType.EQUITY || i.instrumentType === InstrumentType.ETF)
      .map((i) => i.symbol)
      .filter((s): s is string => !!s);
    if (symbols.length > 0) {
      this.priceService.fetchPrices(symbols);
    }
  }

  /** Handle row selection from the queue. */
  onTicketSelected(id: string): void {
    this.selectedTicketId.set(id);
  }

  /** Handle batch remove from the queue. */
  onRemoveTickets(ids: string[]): void {
    for (const id of ids) {
      this.stagingStore.removeTicket(id);
    }
    if (this.selectedTicketId() && ids.includes(this.selectedTicketId()!)) {
      this.selectedTicketId.set(null);
    }
  }

  /** Refresh RH orders and positions after a ticket action. */
  onRefreshRequested(): void {
    const acct = this.accountNumber();
    if (acct) {
      this.refreshRhOrders(acct);
      this.fetchAccountSnapshot(acct);
    }
  }

  /** Move a cancelled signal ticket back to STAGED so the user can edit
   *  and re-submit it. Clears the stale broker result so the ticket form
   *  becomes editable again. Provenance (signal context, refId) is preserved. */
  async onRequeueTicket(id: string): Promise<void> {
    const ticket = this.stagingStore.tickets()[id];
    if (!ticket) return;
    if (ticket.status !== OrderTicketStatus.CANCELLED) return;

    this.stagingStore.updateTicket(id, {
      status: OrderTicketStatus.STAGED,
      result: undefined,
      error: undefined,
      terminalAt: undefined,
      updatedAt: new Date().toISOString(),
    });

    this.selectedTicketId.set(id);
    const symbol = 'symbol' in ticket ? ticket.symbol : 'Order';
    this.snackBar.open(`${symbol} moved to staged`, 'Dismiss', { duration: 3000 });
  }

  /** Price for the currently selected ticket as a reactive computed signal. */
  readonly selectedPrice = computed<number | null>(() => {
    const i = this.selectedTicket();
    if (!i) return null;
    if (i.instrumentType !== InstrumentType.EQUITY && i.instrumentType !== InstrumentType.ETF) return null;
    const p = this.prices()[i.symbol.toUpperCase()];
    return p !== undefined && p !== null && !isNaN(p) ? p : null;
  });

  /** Open the trading config dialog. */
  async onOpenConfig(): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open(TradingConfigDialogComponent, {
          data: this.tradingConfig(),
          width: '440px',
        })
        .afterClosed(),
    );
    if (!result) return;

    this.configService.saveConfig(result).subscribe({
      next: () => {
        this.tradingConfig.set({ ...this.tradingConfig(), ...result } as TradingConfig);
        this.fetchAccountSnapshot(result.accountNumber);
        this.snackBar.open('Trading settings saved', 'Dismiss', { duration: 3000 });
      },
      error: (err) => {
        console.error('[OrderComponent] Failed to save trading config:', err);
        this.snackBar.open('Failed to save settings', 'Dismiss', { duration: 4000 });
      },
    });
  }

  /** Loading state for Robinhood re-authentication. */
  readonly reauthing = signal(false);

  /** Trigger in-browser Robinhood re-authentication via observation API. */
  async onReauth(): Promise<void> {
    this.reauthing.set(true);
    this.snackBar.open('Opening Robinhood authorization in browser…', 'Dismiss', { duration: 4000 });
    try {
      const result = await this.mcpService.reauthenticate();
      if (result.success) {
        this.snackBar.open('Robinhood re-authenticated successfully', 'Dismiss', { duration: 3000 });
        const acct = this.tradingConfig()?.accountNumber;
        if (acct) this.fetchAccountSnapshot(acct);
        this.fetchPrices();
      } else {
        const errDetail = formatError(result.error ?? result.state ?? 'Authorization incomplete');
        this.snackBar.open(`Re-auth failed: ${errDetail}`, 'Dismiss', { duration: 6000 });
      }
    } catch (err) {
      const msg = formatError(err);
      this.snackBar.open(`Re-auth failed: ${msg}`, 'Dismiss', { duration: 6000 });
    } finally {
      this.reauthing.set(false);
    }
  }

  /** New Manual Order placeholder. */
  onNewManualOrder(): void {
    this.snackBar.open('Manual order creation coming soon', 'Dismiss', { duration: 3000 });
  }

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }

  /**
   * Merge a local Signal Entry Record with its RH order state.
   *
   * If the local doc has a rhOrderId and the RH order is found, the status
   * and result fields are overridden from RH. This is a read-only merge for
   * display — the local Firestore doc is never updated.
   */
  private mergeWithRhOrder(ticket: OrderTicket, rhOrders: Record<string, BrokerOrderSnapshot>): OrderTicket {
    const orderId = ticket.result?.orderId;
    if (!orderId) return ticket;
    const rhOrder = rhOrders[orderId];
    if (!rhOrder) return ticket;

    const isMarket = ticket.orderType === 'market';
    const mergedStatus = rhStateToDisplayStatus(rhOrder.state, isMarket);
    const terminal = rhStateToTerminalStatus(rhOrder.state);

    return {
      ...ticket,
      status: mergedStatus,
      terminalAt: terminal ? (rhOrder.lastTransactionAt ?? ticket.terminalAt) : ticket.terminalAt,
      result: {
        ...ticket.result,
        orderId: rhOrder.id,
        state: rhOrder.state,
        fillPrice: rhOrder.price ?? ticket.result?.fillPrice,
        filledQuantity: rhOrder.cumulativeQuantity ?? rhOrder.quantity ?? ticket.result?.filledQuantity,
        brokerOrder: rhOrder,
      },
    };
  }

  /**
   * An entry is "supported" when the entry order is filled AND a protective
   * stop has been placed at RH. Supported entries graduate off this page.
   *
   * Stops are detected from RH orders — a stop order (type stop_market or
   * stop_limit, side sell) for the same symbol that is not cancelled/failed.
   */
  private isSupported(ticket: OrderTicket): boolean {
    if (ticket.status !== OrderTicketStatus.FILLED) return false;
    if (ticket.instrumentType !== InstrumentType.EQUITY && ticket.instrumentType !== InstrumentType.ETF) return false;
    return this.protectedSymbols().has(ticket.symbol);
  }

  /** Convert a broker position to a display row for the queue. */
  private positionToTicket(p: BrokerPosition): OrderTicket {
    const id = `broker-position-${p.symbol}`;
    return {
      id,
      refId: id,
      source: OrderSource.POSITION_MANAGEMENT,
      sourceRef: { type: 'broker_position', id: p.symbol },
      status: OrderTicketStatus.FILLED,
      accountNumber: this.accountNumber(),
      side: 'buy',
      orderType: 'market',
      timeInForce: 'gtc',
      marketHours: 'regular_hours',
      instrumentType: InstrumentType.EQUITY,
      symbol: p.symbol,
      quantity: p.quantity,
      result: {
        state: 'filled',
        fillPrice: p.averageBuyPrice,
        filledQuantity: p.quantity,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as OrderTicket;
  }

  /** Convert a RH stop-loss order to a display row for the queue. */
  private rhStopToTicket(o: BrokerOrderSnapshot): OrderTicket {
    const status = rhStateToDisplayStatus(o.state, false); // stop orders are trigger-based, never market
    return {
      id: `rh-stop-${o.id}`,
      refId: o.id,
      source: OrderSource.POSITION_MANAGEMENT,
      sourceRef: { type: 'stop_loss', id: o.id },
      status,
      accountNumber: this.accountNumber(),
      side: 'sell',
      orderType: 'stop_loss',
      timeInForce: (o.timeInForce === 'gfd' ? 'gfd' : 'gtc'),
      marketHours: (o.marketHours === 'extended_hours' ? 'extended_hours'
        : o.marketHours === 'all_day_hours' ? 'all_day_hours' : 'regular_hours'),
      instrumentType: InstrumentType.EQUITY,
      symbol: o.symbol,
      quantity: o.quantity ?? '',
      stopPrice: o.stopPrice ?? undefined,
      result: {
        orderId: o.id,
        state: o.state,
        filledQuantity: o.cumulativeQuantity ?? o.quantity,
        brokerOrder: o,
      },
      createdAt: o.createdAt ?? new Date().toISOString(),
      updatedAt: o.lastTransactionAt ?? new Date().toISOString(),
    } as OrderTicket;
  }
}
