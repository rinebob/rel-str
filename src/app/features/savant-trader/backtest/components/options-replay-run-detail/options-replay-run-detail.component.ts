/**
 * Options Replay Run Detail Component
 *
 * Shell for a selected replay run — run header (template, symbol,
 * startDate, status) plus the run's contract-list card. Success docs
 * expand into the contract-list table (coverage header from pickDocMeta,
 * marker rows, repeat badges); a row's inspect action opens the
 * contract-series dialog. Runs are single-symbol (#1430) — the card grid
 * carries exactly one card.
 */
import { Component, input, output, ChangeDetectionStrategy, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DsDialogService } from '../../../../../shared/ds/ds-dialog';

import type { ContractListPickRow } from '@options-replay/contracts';
import type { OptionsContractListUi, OptionsReplayRunUi } from '../../common/options-replay.types';
import { getReplayTemplate } from '@options-replay/templates';
import { getBacktestStatusVisuals, formatBacktestRunId } from '../../utils/backtest.utils';
import { AppRoutes } from '../../../../../core/common/interfaces';
import { OptionsReplayContractListTableComponent } from '../options-replay-contract-list-table/options-replay-contract-list-table.component';
import {
  OptionsReplayContractSeriesDialogComponent,
  ContractSeriesDialogData,
} from '../options-replay-contract-series-dialog/options-replay-contract-series-dialog.component';

/** Card view model — the run's contract list (or a pending placeholder
 *  until the worker writes the doc). */
export interface OptionsReplayListView {
  symbol: string;
  list: OptionsContractListUi | null;
  statusLabel: string;
  statusColorName: string;
  statusIconName: string;
  rowCount: number | null;
  error?: string;
  /** Analysis action state — drives the card's Analyze → View Results flip. */
  canAnalyze: boolean;
  hasResults: boolean;
  analyzing: boolean;
  /** '/options/strategy/backtest/analysis/{listDocId}' — null when no doc. */
  analysisLink: string | null;
}

@Component({
  selector: 'app-options-replay-run-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, OptionsReplayContractListTableComponent, RouterLink],
  templateUrl: './options-replay-run-detail.component.html',
  styleUrl: './options-replay-run-detail.component.scss',
})
export class OptionsReplayRunDetailComponent {
  private readonly dialog = inject(DsDialogService);

  /** Route template for a list's analysis-results page — the card swaps
   *  the `:listDocId` segment for its own docId. */
  readonly analysisPath = AppRoutes.STRATEGY_BACKTEST_ANALYSIS;

  readonly run = input.required<OptionsReplayRunUi>();
  readonly contractList = input<OptionsContractListUi | null>(null);
  readonly isLoadingLists = input<boolean>(false);
  /** List docIds with ≥1 analysis result doc — flips Analyze to View Results. */
  readonly analysisReadyListIds = input<ReadonlySet<string>>(new Set());
  /** List docIds with an in-flight optionsAnalysisStart call. */
  readonly analyzingListIds = input<ReadonlySet<string>>(new Set());

  /** Emitted when the card's Analyze action is clicked — the list docId. */
  readonly analyze = output<string>();

  /** Whether the card's row table is expanded — a run can carry hundreds
   *  of rows. Expands on run select (a click on the run is intent to see
   *  its list); the toggle collapses. */
  readonly expanded = signal<boolean>(false);

  constructor() {
    let lastRunId: string | null = null;
    effect(() => {
      const runId = this.run().runId;
      if (runId !== lastRunId) {
        lastRunId = runId;
        this.expanded.set(true);
      }
    });
  }

  toggleExpanded(): void {
    this.expanded.update((v) => !v);
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

  /** The run's contract-list card — the list doc is keyed at docId ==
   *  runId; it may not exist yet (worker hasn't written), in which case
   *  the card shows 'pending'. Null only on a sparse run doc (no symbol). */
  readonly listView = computed((): OptionsReplayListView | null => {
    const symbol = this.run().symbol;
    if (!symbol) return null;
    const list = this.contractList();
    const ready = this.analysisReadyListIds();
    const analyzing = this.analyzingListIds();
    const status = list?.status ?? 'pending';
    const visuals = getBacktestStatusVisuals(status);
    const listId = list?.listId ?? '';
    return {
      symbol,
      list,
      statusLabel: status,
      statusColorName: visuals.color,
      statusIconName: visuals.icon,
      rowCount: list ? list.rows.length : null,
      error: list?.error,
      canAnalyze: status === 'success',
      hasResults: list ? ready.has(listId) : false,
      analyzing: list ? analyzing.has(listId) : false,
      analysisLink: list ? `/${this.analysisPath.replace(':listDocId', listId)}` : null,
    };
  });
}
