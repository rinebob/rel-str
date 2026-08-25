/**
 * RH Agent Order Component
 *
 * Final trade parameter configuration for ACCEPTED symbols.
 * Reads accepted occurrences from the shared RhAgentOccurrenceDecisionStore.
 * URL: /rh-agent/order
 */
import {
  Component,
  inject,
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
import { Router } from '@angular/router';

import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentOccurrenceDecisionStore } from '../../stores/rh-agent-occurrence-decision.store';
import { RhAgentStore } from '../../stores/rh-agent.store';

import { AgentOccurrenceDecision, RH_AGENT_MAX_TRADE_AMOUNT } from '../../services/types';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { TradeRowComponent, TradeRow } from '../../components/trade-row/trade-row.component';

@Component({
  selector: 'app-rh-agent-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule, MatSlideToggleModule, MatTooltipModule, TradeRowComponent],
  templateUrl: './rh-agent-order.component.html',
  styleUrl: './rh-agent-order.component.scss',
})
export class RhAgentOrderComponent {
  readonly triageStore = inject(RhAgentTriageStore);
  readonly occurrenceStore = inject(RhAgentOccurrenceDecisionStore);
  readonly agentStore = inject(RhAgentStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  readonly tradeRows = signal<TradeRow[]>([]);
  readonly maxTradeAmount = RH_AGENT_MAX_TRADE_AMOUNT;

  /** Tracks the last run whose decisions were loaded so we don't reload on every signal change. */
  private loadedRunId: string | null = null;

  /** Rows that are currently enabled for order configuration. */
  readonly enabledRows = computed(() =>
    this.tradeRows().filter((r) => r.enabled)
  );

  /** Sum of position sizes for all enabled rows. */
  readonly totalAmount = computed(() =>
    this.enabledRows().reduce((sum, r) => sum + r.positionSize, 0)
  );

  /** Order always operates on the latest completed run, regardless of the currently viewed run. */
  readonly orderMarketDate = computed(() => this.agentStore.latestCompletedRun()?.marketDate ?? null);

  /** True when the latest completed run is known and actionable. */
  readonly isActionableRun = computed(() => !!this.orderMarketDate());

  constructor() {
    this.uiState.setFullscreen(true);
    this.agentStore.loadData();

    // Keep trade rows in sync with active order symbols while preserving user edits for symbols still present.
    effect(() => this.syncTradeRowsWithActiveOrderSymbols());

    // Load decisions when the latest completed run becomes known. This handles
    // direct navigation or refresh where agentStore hasn't yet fetched runs.
    effect(() => {
      const latestRun = this.agentStore.latestCompletedRun();
      if (!latestRun) return;
      if (this.loadedRunId === latestRun.id) return;
      this.loadedRunId = latestRun.id;
      this.occurrenceStore.loadDecisionsForRun(latestRun.id);
    });
  }

  /** Merge active order symbols with existing trade rows, preserving edits for symbols still present. */
  private syncTradeRowsWithActiveOrderSymbols(): void {
    const decisions = this.occurrenceStore.activeOrderDecisions();

    const existing = untracked(() => this.tradeRows());
    const existingBySymbol = new Map(existing.map((r) => [r.symbol, r]));

    const decisionBySymbol = new Map<string, AgentOccurrenceDecision>();
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
        enabled: true,
      };
    });

    this.tradeRows.set(next);
  }

  /** Toggle whether a symbol is included in the order configuration. */
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

  /** Navigate back to the signal review page. */
  goBack(): void {
    this.router.navigate(['/signal-review']);
  }

  /** Navigate to the review page. */
  goToReview(): void {
    this.router.navigate(['/chart-review']);
  }
}
