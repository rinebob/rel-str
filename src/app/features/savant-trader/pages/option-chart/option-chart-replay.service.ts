/**
 * Replay-run selector wiring — recent-runs dropdown and the pick →
 * default-slice → loadPlotted path. Page-scoped: provided by the
 * component, dies with the page.
 */
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, take } from 'rxjs';

import { OptionsReplayRunsService } from '../../backtest/services/options-replay-runs.service';
import type { OptionsReplayRunUi } from '../../backtest/common/options-replay.types';
import type { ContractListPickRow } from '@options-replay/contracts';
import { OptionChartPageService } from './option-chart-page.service';
import { OptionChartLoadService } from './option-chart-load.service';

@Injectable()
export class OptionChartReplayService {
  private readonly page = inject(OptionChartPageService);
  private readonly load = inject(OptionChartLoadService);
  private readonly replayService = inject(OptionsReplayRunsService);

  /** Selection-replay dropdown state — pick a run, plot its default slice. */
  readonly replayRuns = signal<OptionsReplayRunUi[]>([]);
  selectedReplayRunId: string | null = null;
  readonly replayLoading = signal(false);
  readonly replayError = signal<string | null>(null);

  /** Recent completed runs for the dropdown — called once on init. */
  bindRuns(): void {
    this.replayService.watchRuns(20).pipe(take(1)).subscribe({
      next: (runs) => this.replayRuns.set(runs.filter((r) => r.status === 'completed')),
      error: () => this.replayError.set('Could not load replay runs'),
    });
  }

  /** Dropdown label — template + window + the run's symbol. */
  replayLabel(run: OptionsReplayRunUi): string {
    return `${run.templateId} · ${run.startDate} · ${run.symbol}`;
  }

  /** Replay pick → default slice = first 10 Wednesday pick rows of the
   *  run's list, emitted as `date,id` lines through the same loadPlotted
   *  path as a paste. The filter/paging dialog is a later step — this
   *  just plots. */
  async onReplaySelected(runId: string): Promise<void> {
    this.replayLoading.set(true);
    this.replayError.set(null);
    try {
      const list = await firstValueFrom(this.replayService.watchContractList(runId));
      if (list?.status !== 'success') {
        this.replayError.set('No successful contract list in this run');
        return;
      }
      const picks = list.rows
        .filter((r): r is ContractListPickRow => r.kind === 'pick')
        .filter((r) => new Date(`${r.entryDate}T00:00:00Z`).getUTCDay() === 3)
        .slice(0, 10);
      if (picks.length === 0) {
        this.replayError.set('No Wednesday picks in this list');
        return;
      }
      // Single-symbol runs (#1430): a run is exactly one list, often NOT
      // the page symbol — selecting it is intent to view that symbol, so
      // switch pages like onContractListDoc does. Only after every bail
      // path — an errored selection must not yank the page underneath
      // the user (the error names the run, not a symbol switch).
      const sym = list.symbol.trim().toUpperCase();
      if (sym && sym !== this.page.symbol().trim().toUpperCase()) {
        this.page.onSymbolChange(sym);
      }
      this.page.occIdInput = picks.map((r) => `${r.entryDate},${r.contractId}`).join('\n');
      await this.load.onLoad();
    } catch (e: unknown) {
      // A dead stream (rules/offline) must not fail silently — the
      // loading flag clears in finally either way.
      this.replayError.set(e instanceof Error ? e.message : 'Failed to load this run');
    } finally {
      this.replayLoading.set(false);
    }
  }
}
