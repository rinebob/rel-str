/**
 * RH Agent Order Component
 *
 * Final trade parameter configuration and prompt generation for ACCEPTED symbols.
 * Reads accepted occurrences from the shared RhAgentOccurrenceDecisionStore.
 * URL: /rh-agent/order
 */
import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  effect,
  untracked,
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
import { RhAgentOccurrenceDecisionStore } from '../../stores/rh-agent-occurrence-decision.store';
import { RhAgentTradeStore } from '../../stores/rh-agent-trade.store';
import { RhAgentExecutionStore } from '../../stores/rh-agent-execution.store';
import { RhAgentStore } from '../../stores/rh-agent.store';

import {
  RhAgentSignalItem,
  RhAgentOccurrenceDecision,
  RH_AGENT_MAX_TRADE_AMOUNT,
  SignalDirection,
} from '../../services/rh-agent.types';
import { RhAgentReviewDecision, SignalTimeframe } from '../../common/rh-agent.constants';
import {
  RobinhoodTradeService,
  TradeBatch,
  TradePrompt,
  TradeSide,
  TradeOrderType,
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
  readonly occurrenceStore = inject(RhAgentOccurrenceDecisionStore);
  readonly tradeStore = inject(RhAgentTradeStore);
  readonly executionStore = inject(RhAgentExecutionStore);
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

  /** Enabled rows that have not yet been marked executed. */
  readonly enabledUnexecutedRows = computed(() =>
    this.enabledRows().filter((r) => !r.executed)
  );

  /** Whether a trade batch has already been generated. */
  readonly hasGeneratedBatch = computed(() => !!this.generatedBatch());

  /** Order always operates on the latest completed run, regardless of the currently viewed run. */
  readonly orderMarketDate = computed(() => this.agentStore.latestCompletedRun()?.marketDate ?? null);

  /** True when the latest completed run is known and actionable. */
  readonly isActionableRun = computed(() => !!this.orderMarketDate());

  constructor() {
    // Keep trade rows in sync with active order symbols while preserving user edits for symbols still present.
    effect(() => this.syncTradeRowsWithActiveOrderSymbols());
  }

  /** Initialize the page and load accepted current-run occurrences and trades. */
  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun) return;
    this.occurrenceStore.loadDecisionsForRun(latestRun.id);
    this.tradeStore.loadTradesForRun(latestRun.id);
  }

  /** Merge active order symbols with existing trade rows, preserving edits for symbols still present. */
  private syncTradeRowsWithActiveOrderSymbols(): void {
    const decisions = this.occurrenceStore.activeOrderDecisions();

    const existing = untracked(() => this.tradeRows());
    const existingBySymbol = new Map(existing.map((r) => [r.symbol, r]));

    const decisionBySymbol = new Map<string, RhAgentOccurrenceDecision>();
    for (const d of decisions) {
      const current = decisionBySymbol.get(d.symbol);
      if (!current || d.barDate > current.barDate) {
        decisionBySymbol.set(d.symbol, d);
      }
    }

    const symbols = this.occurrenceStore.activeOrderSymbols();
    const next: TradeRow[] = symbols.map((symbol) => {
      const row = existingBySymbol.get(symbol);
      if (row) return row;
      const decision = decisionBySymbol.get(symbol);
      if (!decision) {
        throw new Error(`[RhAgentOrderComponent] No accepted occurrence decision for symbol ${symbol}`);
      }
      return {
        symbol,
        direction: decision.direction,
        signalType: decision.signalType,
        barDate: decision.barDate,
        timeframe: decision.timeframe,
        positionSize: RH_AGENT_MAX_TRADE_AMOUNT,
        stopLossPercent: 8,
        entryPrice: 0,
        enabled: true,
        executed: false,
      };
    });

    this.tradeRows.set(next);
  }

  /** Update a trade row's cached signal and entry price from the backend. */
  onSignalLoaded(event: { symbol: string; signal: RhAgentSignalItem | null }): void {
    const latest = event.signal;
    const patch: Partial<TradeRow> = { signal: latest ?? undefined };
    if (latest?.closePrice !== undefined && !Number.isNaN(latest.closePrice)) {
      patch.entryPrice = latest.closePrice;
    }
    this.patchRow(event.symbol, patch);
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

  /** Mark the accepted occurrence decisions for a symbol as executed after a real trade is placed. */
  onMarkExecuted(symbol: string): void {
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun?.marketDate) return;
    const row = this.tradeRows().find((r) => r.symbol === symbol);
    if (!row) return;
    this.executeRows(latestRun.id, latestRun.marketDate, [row]);
  }

  /** Mark all enabled, unexecuted rows as executed. */
  onMarkAllExecuted(): void {
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun?.marketDate) return;
    const rows = this.enabledUnexecutedRows();
    if (rows.length === 0) return;
    this.executeRows(latestRun.id, latestRun.marketDate, rows);
  }

  /** Execute the given rows: create trade records and mark their source decisions executed. */
  private executeRows(runId: string, marketDate: string, rows: TradeRow[]): void {
    const inputs = this.buildExecutionInputs(runId, rows);
    if (inputs.length === 0) return;

    this.executionStore.executeTradeRows(runId, marketDate, inputs);
  }

  /** Pair each row with its exact current-run ACCEPT occurrence decision. */
  private buildExecutionInputs(
    runId: string,
    rows: TradeRow[]
  ): { row: TradeRow; occurrenceDecisionId: string }[] {
    const decisionsByKey = new Map<string, RhAgentOccurrenceDecision>();
    for (const d of Object.values(this.occurrenceStore.occurrenceDecisions())) {
      if (
        d.runId === runId &&
        d.decisionType === RhAgentReviewDecision.ACCEPT &&
        d.isCurrentInLatestRun
      ) {
        decisionsByKey.set(`${d.symbol}:${d.timeframe}:${d.signalType}`, d);
      }
    }

    const inputs: { row: TradeRow; occurrenceDecisionId: string }[] = [];
    for (const row of rows) {
      const key = `${row.symbol.toUpperCase()}:${row.timeframe}:${row.signalType}`;
      const decision = decisionsByKey.get(key);
      if (!decision) {
        console.warn('[RhAgentOrderComponent] No matching decision for row:', row.symbol);
        continue;
      }
      inputs.push({ row, occurrenceDecisionId: decision.id });
    }
    return inputs;
  }

  /** Remove a symbol from the order page: delete occurrence decisions and re-flag for review. */
  onRemoveSymbol(symbol: string): void {
    const latestRun = this.agentStore.latestCompletedRun();
    if (!latestRun) return;
    this.occurrenceStore.resetSymbol(symbol, latestRun.id);
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
      side: row.direction === SignalDirection.SHORT ? TradeSide.SELL : TradeSide.BUY,
      amount: row.positionSize,
      orderType: TradeOrderType.MARKET,
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
      row.direction === SignalDirection.SHORT ? TradeSide.SELL : TradeSide.BUY,
      row.positionSize,
      TradeOrderType.MARKET
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
