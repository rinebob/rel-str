/**
 * RH Agent Order Component
 *
 * Final trade parameter configuration and prompt generation for ACCEPTED symbols.
 * Reads accepted symbols from the shared RhAgentTriageStore.
 * URL: /rh-agent/order
 */
import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentGroupStore } from '../../stores/rh-agent-group.store';
import { RhAgentStore } from '../../stores/rh-agent.store';

import { todayDate, daysAgoPt } from '../../utils/rh-agent.utils';
import {
  RhAgentSignalItem,
  RH_AGENT_MAX_TRADE_AMOUNT,
} from '../../services/rh-agent.service';
import {
  RobinhoodTradeService,
  TradeBatch,
  TradePrompt,
} from '../../../rs/services/robinhood-trade.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { TradeRowComponent, TradeRow } from '../../components/trade-row/trade-row.component';

@Component({
  selector: 'app-rh-agent-order',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSlideToggleModule,
    MatTooltipModule,
    TradeRowComponent,
  ],
  templateUrl: './rh-agent-order.component.html',
  styleUrl: './rh-agent-order.component.scss',
})
export class RhAgentOrderComponent implements OnInit {
  readonly triageStore = inject(RhAgentTriageStore);
  readonly groupStore = inject(RhAgentGroupStore);
  readonly agentStore = inject(RhAgentStore);
  readonly tradeService = inject(RobinhoodTradeService);
  readonly snackBar = inject(MatSnackBar);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  readonly tradeRows = signal<TradeRow[]>([]);
  readonly generatedBatch = signal<TradeBatch | null>(null);
  readonly maxTradeAmount = RH_AGENT_MAX_TRADE_AMOUNT;

  /** Rows that are currently enabled for trade generation. */
  readonly enabledRows = computed(() =>
    this.tradeRows().filter((r) => r.enabled)
  );

  /** Sum of position sizes for all enabled rows. */
  readonly totalAmount = computed(() =>
    this.enabledRows().reduce((sum, r) => sum + r.positionSize, 0)
  );

  /** Whether a trade batch has already been generated. */
  readonly hasGeneratedBatch = computed(() => !!this.generatedBatch());

  /** Order always operates on the latest completed run, regardless of the currently viewed run. */
  readonly orderMarketDate = computed(() => this.agentStore.latestCompletedRun()?.marketDate ?? null);

  /** True when the latest completed run is known and actionable. */
  readonly isActionableRun = computed(() => !!this.orderMarketDate());

  private currentMarketDate(): string | null {
    return this.orderMarketDate();
  }

  /** Initialize the page and build trade rows from accepted symbols. */
  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    const marketDate = this.currentMarketDate();
    if (!marketDate) return;
    this.triageStore.loadPersistedDecisions(daysAgoPt(30), marketDate, marketDate);
    this.initializeTradeRows();
  }

  /** Build initial trade rows from accepted symbols; each row loads its own signal history. */
  private initializeTradeRows(): void {
    const symbols = this.triageStore.acceptedSymbols();
    this.tradeRows.set(
      symbols.map((symbol) => ({
        symbol,
        direction: 'LONG' as const,
        signalType: '',
        barDate: '',
        positionSize: RH_AGENT_MAX_TRADE_AMOUNT,
        stopLossPercent: 8,
        enabled: true,
      }))
    );
  }

  /** Update a trade row with the latest signal details from the backend. */
  onSignalLoaded(event: { symbol: string; signal: RhAgentSignalItem | null }): void {
    const latest = event.signal;
    this.patchRow(event.symbol, {
      signal: latest ?? undefined,
      direction: latest?.direction ?? 'LONG',
      signalType: latest?.signalType ?? '',
      barDate: latest?.barDate ?? '',
    });
  }

  /** Toggle whether a symbol is included in the generated trade batch. */
  onToggleEnabled(symbol: string): void {
    const row = this.tradeRows().find((r) => r.symbol === symbol);
    if (row) {
      this.patchRow(symbol, { enabled: !row.enabled });
    }
  }

  /** Update a row's dollar position size. */
  onPositionSizeChange(event: { symbol: string; value: number }): void {
    this.patchRow(event.symbol, { positionSize: event.value });
  }

  /** Update a row's stop-loss percentage. */
  onStopLossChange(event: { symbol: string; value: number }): void {
    this.patchRow(event.symbol, { stopLossPercent: event.value });
  }

  /** Remove a symbol from the order page: reset ACR to PENDING and re-flag for review. */
  onRemoveSymbol(symbol: string): void {
    const marketDate = this.currentMarketDate();
    if (!marketDate) return;
    this.triageStore.resetSymbol(symbol, marketDate);
    this.triageStore.markForReview(symbol);
    this.tradeRows.update((rows) => rows.filter((r) => r.symbol !== symbol));
  }

  /** Apply a partial update to a single trade row by symbol. */
  private patchRow(symbol: string, patch: Partial<TradeRow>): void {
    this.tradeRows.update((rows) =>
      rows.map((r) => (r.symbol === symbol ? { ...r, ...patch } : r))
    );
  }

  /** Generate a trade batch prompt from all enabled rows. */
  generateBatch(): void {
    const enabled = this.enabledRows();
    if (enabled.length === 0) {
      this.snackBar.open('No enabled symbols to trade', 'Dismiss', { duration: 3000 });
      this.generatedBatch.set(null);
      return;
    }

    const trades: TradePrompt[] = enabled.map((row) => ({
      symbol: row.symbol,
      side: row.direction === 'SHORT' ? 'sell' : 'buy',
      amount: row.positionSize,
      orderType: 'market' as const,
      promptText: '',
    }));

    const batch = this.tradeService.generateBatchPrompt(trades);
    this.generatedBatch.set(batch);
  }

  /** Copy the generated batch prompt to the clipboard. */
  async copyBatch(): Promise<void> {
    const batch = this.generatedBatch();
    if (!batch) return;
    const success = await this.tradeService.copyToClipboard(batch.batchPrompt);
    this.showCopyResult(success, `Copied batch of ${batch.trades.length} trades`);
  }

  /** Copy a single trade's prompt to the clipboard. */
  async copyTrade(row: TradeRow): Promise<void> {
    if (!row.enabled) return;
    const trade = this.tradeService.generateTradePrompt(
      row.symbol,
      row.direction === 'SHORT' ? 'sell' : 'buy',
      row.positionSize,
      'market'
    );
    const success = await this.tradeService.copyToClipboard(trade.promptText);
    this.showCopyResult(success, `Copied: ${trade.side.toUpperCase()} $${trade.amount} ${trade.symbol}`);
  }

  /** Show a snackbar confirming or warning about a clipboard copy. */
  private showCopyResult(success: boolean, message: string): void {
    if (success) {
      this.snackBar.open(message, 'Dismiss', { duration: 3000 });
    } else {
      this.snackBar.open('Failed to copy. Please copy manually.', 'Dismiss', { duration: 5000 });
    }
  }

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }

  /** Navigate to the review page. */
  goToReview(): void {
    this.router.navigate(['/chart-review']);
  }
}
