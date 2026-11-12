/**
 * Backtest Dashboard Component
 *
 * Phase 2 dashboard for the Savant Trader strategy backtest run management UI.
 * Wires the run store, UI store, control strip, and run list together.
 */
import { Component, computed, inject, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DsDialogService } from '../../../../../shared/ds/ds-dialog';


import { BacktestRunStore } from '../../stores/backtest-run.store';
import { BacktestUiStore } from '../../stores/backtest-ui.store';
import { OptionsReplayStore } from '../../stores/options-replay.store';
import { BacktestRunControlComponent } from '../../components/backtest-run-control/backtest-run-control.component';
import { BacktestRunListComponent } from '../../components/backtest-run-list/backtest-run-list.component';
import { BacktestRunSummaryComponent } from '../../components/backtest-run-summary/backtest-run-summary.component';
import { BacktestPermutationDetailComponent } from '../../components/backtest-permutation-detail/backtest-permutation-detail.component';
import { BacktestNewRunDialogComponent } from '../../components/backtest-new-run-dialog/backtest-new-run-dialog.component';
import { OptionsReplayRunListComponent } from '../../components/options-replay-run-list/options-replay-run-list.component';
import { OptionsReplayRunControlsComponent } from '../../components/options-replay-run-controls/options-replay-run-controls.component';
import {
  OptionsReplayContractListDialogComponent,
  ContractListDialogData,
} from '../../components/options-replay-contract-list-dialog/options-replay-contract-list-dialog.component';
import { OptionsReplayNewRunDialogComponent } from '../../components/options-replay-new-run-dialog/options-replay-new-run-dialog.component';
import { ConfirmDialogComponent } from '../../../../../shared/ds/confirm-dialog.component';
import { UiStateService } from '../../../../../core/services/ui-state.service';
import type { OptionsReplayStartRequest } from '@options-replay/contracts';
import type { BacktestPermutationUi, BacktestStrategyMetadata, StartBacktestRequest } from '../../common/backtest.types';
import { formatBacktestRunId } from '../../utils/backtest.utils';

@Component({
  selector: 'app-backtest-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    BacktestRunControlComponent,
    BacktestRunListComponent,
    BacktestRunSummaryComponent,
    BacktestPermutationDetailComponent,
    OptionsReplayRunListComponent,
    OptionsReplayRunControlsComponent],
  templateUrl: './backtest-dashboard.component.html',
  styleUrl: './backtest-dashboard.component.scss',
})
export class BacktestDashboardComponent implements OnDestroy {
  readonly runStore = inject(BacktestRunStore);
  readonly uiStore = inject(BacktestUiStore);
  readonly replayStore = inject(OptionsReplayStore);
  private readonly dialog = inject(DsDialogService);
  private readonly uiStateService = inject(UiStateService);

  readonly selectedPermutation = computed((): BacktestPermutationUi | null => {
    const id = this.uiStore.selectedPermutationId();
    return id ? this.runStore.permutations().find((p) => p.permutationId === id) ?? null : null;
  });

  /** Sim-engine section hidden — Selection Replay is the live pipeline;
   *  kept (not deleted) while the sim's analytics are evaluated for reuse. */
  protected readonly showSimRuns = false;

  constructor() {
    if (this.showSimRuns) {
      this.runStore.loadRuns();
      this.runStore.loadStrategies();
    }
    this.replayStore.loadRuns();
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  openNewRunDialog(): void {
    const ref = this.dialog.open<BacktestNewRunDialogComponent, { strategies: BacktestStrategyMetadata[] }, StartBacktestRequest | undefined>(
      BacktestNewRunDialogComponent,
      {
        width: '640px',
        maxWidth: '90vw',
        data: { strategies: this.runStore.strategies() },
      }
    );

    ref.afterClosed().subscribe((request) => {
      if (request) {
        this.runStore.startRun(request);
      }
    });
  }

  openNewReplayDialog(): void {
    const ref = this.dialog.open<OptionsReplayNewRunDialogComponent, void, OptionsReplayStartRequest | undefined>(
      OptionsReplayNewRunDialogComponent,
      {
        width: '560px',
        maxWidth: '90vw',
      }
    );

    ref.afterClosed().subscribe((request) => {
      if (request) {
        this.replayStore.startReplay(request);
      }
    });
  }

  /** Row Contracts action — pops the run's contract-list doc in a
   *  dialog (the list doc is keyed by runId, #1430). */
  openContractListDialog(runId: string): void {
    const list = this.replayStore.contractListById().get(runId);
    if (!list) return;
    this.dialog.open<OptionsReplayContractListDialogComponent, ContractListDialogData>(
      OptionsReplayContractListDialogComponent,
      {
        width: '960px',
        maxWidth: '95vw',
        data: { list },
      }
    );
  }

  /** Row delete action — confirm first; the cascade (run + contract
   *  list + analysis results) is irreversible (#1439). */
  confirmDeleteReplayRun(runId: string): void {
    const run = this.replayStore.runs().find((r) => r.runId === runId);
    const label = run ? `${run.symbol} run ${formatBacktestRunId(runId)}` : `run ${formatBacktestRunId(runId)}`;
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          message: `Delete ${label}? This removes the run, its contract list, and any analysis results.`,
          confirmLabel: 'Delete',
        },
      })
      .afterClosed()
      .subscribe((confirmed: boolean) => {
        if (confirmed) this.replayStore.deleteRun(runId);
      });
  }
}
