/**
 * Options Replay Run Detail Component
 *
 * Shell for a selected replay run — run header (template, symbols,
 * startDate, status, progress) plus one status card per symbol's
 * contract-list doc. Success docs expand into the contract-list table
 * (coverage header from pickDocMeta, marker rows, repeat badges);
 * a row's inspect action opens the contract-series dialog.
 */
import { Component, input, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { ContractListPickRow } from '@options-replay/contracts';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../../common/options-replay.types';
import { getReplayTemplate } from '@options-replay/templates';
import { getBacktestStatusVisuals, formatBacktestRunId } from '../../utils/backtest.utils';
import { OptionsReplayContractListTableComponent } from '../options-replay-contract-list-table/options-replay-contract-list-table.component';
import {
  OptionsReplayContractSeriesDialogComponent,
  ContractSeriesDialogData,
} from '../options-replay-contract-series-dialog/options-replay-contract-series-dialog.component';

/** Per-symbol view model — the list doc resolved against the run's symbol set. */
export interface OptionsReplaySymbolView {
  symbol: string;
  list: OptionsContractListUi | null;
  statusLabel: string;
  statusColorName: string;
  statusIconName: string;
  rowCount: number | null;
  error?: string;
}

@Component({
  selector: 'app-options-replay-run-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule, OptionsReplayContractListTableComponent],
  templateUrl: './options-replay-run-detail.component.html',
  styleUrl: './options-replay-run-detail.component.scss',
})
export class OptionsReplayRunDetailComponent {
  private readonly dialog = inject(MatDialog);

  readonly run = input.required<OptionsReplayRunUi>();
  readonly contractLists = input<OptionsContractListUi[]>([]);
  readonly isLoadingLists = input<boolean>(false);

  /** Symbols whose row table is expanded — collapsed by default since
   *  a run can carry hundreds of rows per symbol. */
  readonly expandedSymbols = signal<ReadonlySet<string>>(new Set());

  toggleExpanded(symbol: string): void {
    this.expandedSymbols.update((set) => {
      const next = new Set(set);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      return next;
    });
  }

  /** Row inspect action → lazily-fetched contract-series dialog. */
  openSeriesDialog(symbol: string, row: ContractListPickRow): void {
    this.dialog.open<OptionsReplayContractSeriesDialogComponent, ContractSeriesDialogData>(
      OptionsReplayContractSeriesDialogComponent,
      {
        width: '640px',
        maxWidth: '95vw',
        data: { symbol, contractId: row.contractId, entryDate: row.entryDate },
      }
    );
  }

  readonly templateName = computed(() =>
    getReplayTemplate(this.run().templateId)?.name ?? this.run().templateId
  );

  readonly formattedRunId = computed(() => formatBacktestRunId(this.run().runId));

  readonly statusIconName = computed(() => getBacktestStatusVisuals(this.run().status).icon);
  readonly statusColorName = computed(() => getBacktestStatusVisuals(this.run().status).color);

  readonly progressText = computed(() => {
    const run = this.run();
    if (!run.totalLists) return '—';
    return `${run.completedLists} / ${run.totalLists} lists`;
  });

  /** One view per run symbol — a symbol whose doc hasn't been written yet
   *  shows 'pending' so the grid is complete from enqueue onward. */
  readonly symbolViews = computed((): OptionsReplaySymbolView[] => {
    const bySymbol = new Map(this.contractLists().map((l) => [l.symbol, l]));
    return this.run().symbols.map((symbol) => {
      const list = bySymbol.get(symbol) ?? null;
      const status = list?.status ?? 'pending';
      const visuals = getBacktestStatusVisuals(status);
      return {
        symbol,
        list,
        statusLabel: status,
        statusColorName: visuals.color,
        statusIconName: visuals.icon,
        rowCount: list ? list.rows.length : null,
        error: list?.error,
      };
    });
  });
}
