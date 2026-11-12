/**
 * Options Replay Contract-List Dialog
 *
 * Row-action surface for one run's contract-list doc (#1471
 * detail-panel removal — what the detail panel's expandable list card
 * rendered now lives in a dialog). Shows the list status/error plus the
 * contract-list table; a row's inspect action opens the contract-series
 * dialog on top.
 */
import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

import { DS_DIALOG_DATA, DsDialogRef, DsDialogService } from '../../../../../shared/ds/ds-dialog';

import type { ContractListPickRow } from '@options-replay/contracts';
import type { OptionsContractListUi } from '../../common/options-replay.types';
import { getBacktestStatusVisuals } from '../../utils/backtest.utils';
import { OptionsReplayContractListTableComponent } from '../options-replay-contract-list-table/options-replay-contract-list-table.component';
import {
  OptionsReplayContractSeriesDialogComponent,
  ContractSeriesDialogData,
} from '../options-replay-contract-series-dialog/options-replay-contract-series-dialog.component';

export interface ContractListDialogData {
  list: OptionsContractListUi;
}

@Component({
  selector: 'app-options-replay-contract-list-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, OptionsReplayContractListTableComponent],
  templateUrl: './options-replay-contract-list-dialog.component.html',
  styleUrl: './options-replay-contract-list-dialog.component.scss',
})
export class OptionsReplayContractListDialogComponent {
  private readonly dialog = inject(DsDialogService);
  readonly data = inject<ContractListDialogData>(DS_DIALOG_DATA);
  protected readonly ref = inject(DsDialogRef<OptionsReplayContractListDialogComponent>);

  readonly statusColorName = computed(() => getBacktestStatusVisuals(this.data.list.status).color);
  readonly statusIconName = computed(() => getBacktestStatusVisuals(this.data.list.status).icon);

  /** Row inspect action → lazily-fetched contract-series dialog. */
  openSeriesDialog(row: ContractListPickRow): void {
    this.dialog.open<OptionsReplayContractSeriesDialogComponent, ContractSeriesDialogData>(
      OptionsReplayContractSeriesDialogComponent,
      {
        width: '640px',
        maxWidth: '95vw',
        data: { symbol: this.data.list.symbol, contractId: row.contractId, entryDate: row.entryDate },
      }
    );
  }
}
