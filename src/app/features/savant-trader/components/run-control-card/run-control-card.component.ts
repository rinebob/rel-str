import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  RunTriggerFilter,
  RunDateFilter,
  RunStatusFilter,
} from '../../common/constants';

@Component({
  selector: 'app-run-control-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
  ],
  templateUrl: './run-control-card.component.html',
  styleUrl: './run-control-card.component.scss',
})
export class RunControlCardComponent {
  readonly isRunning    = input<boolean>(false);
  readonly triggerFilter = input<RunTriggerFilter>(RunTriggerFilter.ALL);
  readonly dateFilter    = input<RunDateFilter>(RunDateFilter.TODAY);
  readonly statusFilter  = input<RunStatusFilter>(RunStatusFilter.ALL);

  readonly runNow           = output<void>();
  readonly triggerFilterChange = output<RunTriggerFilter>();
  readonly dateFilterChange    = output<RunDateFilter>();
  readonly statusFilterChange  = output<RunStatusFilter>();
  readonly refresh          = output<void>();

  readonly TriggerFilter = RunTriggerFilter;
  readonly DateFilter    = RunDateFilter;
  readonly StatusFilter  = RunStatusFilter;

  readonly triggerOptions: { label: string; value: RunTriggerFilter }[] = [
    { label: 'All',     value: RunTriggerFilter.ALL },
    { label: 'Manual',  value: RunTriggerFilter.MANUAL },
    { label: 'PDR',     value: RunTriggerFilter.PDR },
    { label: 'Nightly', value: RunTriggerFilter.NIGHTLY },
  ];

  readonly dateOptions: { label: string; value: RunDateFilter }[] = [
    { label: 'Today',   value: RunDateFilter.TODAY },
    { label: '7 Days',  value: RunDateFilter.WEEK },
    { label: 'All',     value: RunDateFilter.ALL },
  ];

  readonly statusOptions: { label: string; value: RunStatusFilter }[] = [
    { label: 'All',     value: RunStatusFilter.ALL },
    { label: 'Running', value: RunStatusFilter.RUNNING },
    { label: 'Success', value: RunStatusFilter.SUCCESS },
    { label: 'Partial', value: RunStatusFilter.PARTIAL },
    { label: 'Failed',  value: RunStatusFilter.FAILED },
  ];
}
