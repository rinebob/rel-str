/**
 * Savant Trader Signal Order Component
 *
 * Master-detail layout for the signal order screen.
 * Left panel: OrderQueueComponent (staged intents grouped by status).
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

import { OrderStagingStore } from '../../stores/order-staging.store';
import { OrderQueueComponent } from '../../components/order-queue/order-queue.component';
import { OrderTicketComponent } from '../../components/order-ticket/order-ticket.component';
import { TradingConfigDialogComponent } from '../../components/trading-config-dialog/trading-config-dialog.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { TradingConfigService } from '../../services/trading-config.service';
import { EquityPriceService } from '../../services/equity-price.service';
import { AccountSnapshot, PortfolioService } from '../../services/portfolio.service';
import { RobinhoodMcpObservationService } from '../../services/robinhood-mcp-observation.service';
import { OrderIntent, TradingConfig, InstrumentType } from '../../services/order-intent.types';
import { formatError } from '../../utils/format-error.util';

@Component({
  selector: 'app-signal-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, OrderQueueComponent, OrderTicketComponent],
  templateUrl: './order.component.html',
  styleUrl: './order.component.scss',
})
export class OrderComponent implements OnInit {
  readonly stagingStore = inject(OrderStagingStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);
  private readonly configService = inject(TradingConfigService);
  private readonly priceService = inject(EquityPriceService);
  private readonly portfolioService = inject(PortfolioService);
  private readonly mcpService = inject(RobinhoodMcpObservationService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  /** Currently selected intent id. */
  readonly selectedIntentId = signal<string | null>(null);

  /** All intents from the store. */
  readonly allIntents = computed(() => Object.values(this.stagingStore.intents()));

  /** The currently selected intent object. */
  readonly selectedIntent = computed<OrderIntent | null>(() => {
    const id = this.selectedIntentId();
    if (!id) return null;
    return this.stagingStore.intents()[id] ?? null;
  });

  /** Total intent count for header. */
  readonly intentCount = computed(() => this.allIntents().length);

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

  /** Account display name (type + number). */
  readonly accountName = computed(() => {
    const num = this.accountNumber();
    return num ? `agentic ${num}` : '—';
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
    this.stagingStore.loadIntents();
    this.loadConfig();
  }

  constructor() {
    // Fetch prices when intents are loaded or change
    effect(() => {
      const intents = this.allIntents();
      untracked(() => {
        if (intents.length > 0) {
          this.fetchPrices();
          if (!this.selectedIntentId()) {
            this.selectedIntentId.set(intents[0].id);
          }
        }
      });
    });

    // Refresh the canonical account snapshot when the account or live order states change
    effect(() => {
      const accountNumber = this.accountNumber();
      const activeCount = this.stagingStore.activeIntents().length;
      const terminalCount = this.stagingStore.terminalIntents().length;
      if (accountNumber) {
        this.fetchAccountSnapshot(accountNumber);
      }
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
      this.accountSnapshot.set(await this.portfolioService.getSnapshot(accountNumber, this.defaultDollarAmount()));
    } catch (err) {
      console.error('[OrderComponent] Failed to fetch account snapshot:', err);
    }
  }

  /** Fetch prices for all unique symbols in the queue. */
  private fetchPrices(): void {
    const symbols = this.allIntents()
      .filter((i) => i.instrumentType === InstrumentType.EQUITY || i.instrumentType === InstrumentType.ETF)
      .map((i) => i.symbol)
      .filter((s): s is string => !!s);
    if (symbols.length > 0) {
      this.priceService.fetchPrices(symbols);
    }
  }

  /** Handle row selection from the queue. */
  onIntentSelected(id: string): void {
    this.selectedIntentId.set(id);
  }

  /** Handle batch remove from the queue. */
  onRemoveIntents(ids: string[]): void {
    for (const id of ids) {
      this.stagingStore.removeIntent(id);
    }
    if (this.selectedIntentId() && ids.includes(this.selectedIntentId()!)) {
      this.selectedIntentId.set(null);
    }
  }

  /** Price for the currently selected intent as a reactive computed signal. */
  readonly selectedPrice = computed<number | null>(() => {
    const i = this.selectedIntent();
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

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }
}
