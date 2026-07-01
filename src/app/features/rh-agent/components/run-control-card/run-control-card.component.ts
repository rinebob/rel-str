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
  RhAgentRunTriggerFilter,
  RhAgentRunDateFilter,
  RhAgentRunStatusFilter,
} from '../../common/rh-agent.constants';

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
  readonly triggerFilter = input<RhAgentRunTriggerFilter>(RhAgentRunTriggerFilter.ALL);
  readonly dateFilter    = input<RhAgentRunDateFilter>(RhAgentRunDateFilter.TODAY);
  readonly statusFilter  = input<RhAgentRunStatusFilter>(RhAgentRunStatusFilter.ALL);

  readonly runNow           = output<void>();
  readonly triggerFilterChange = output<RhAgentRunTriggerFilter>();
  readonly dateFilterChange    = output<RhAgentRunDateFilter>();
  readonly statusFilterChange  = output<RhAgentRunStatusFilter>();
  readonly refresh          = output<void>();

  readonly TriggerFilter = RhAgentRunTriggerFilter;
  readonly DateFilter    = RhAgentRunDateFilter;
  readonly StatusFilter  = RhAgentRunStatusFilter;

  readonly triggerOptions: { label: string; value: RhAgentRunTriggerFilter }[] = [
    { label: 'All',     value: RhAgentRunTriggerFilter.ALL },
    { label: 'Manual',  value: RhAgentRunTriggerFilter.MANUAL },
    { label: 'PDR',     value: RhAgentRunTriggerFilter.PDR },
    { label: 'Nightly', value: RhAgentRunTriggerFilter.NIGHTLY },
  ];

  readonly dateOptions: { label: string; value: RhAgentRunDateFilter }[] = [
    { label: 'Today',   value: RhAgentRunDateFilter.TODAY },
    { label: '7 Days',  value: RhAgentRunDateFilter.WEEK },
    { label: 'All',     value: RhAgentRunDateFilter.ALL },
  ];

  readonly statusOptions: { label: string; value: RhAgentRunStatusFilter }[] = [
    { label: 'All',     value: RhAgentRunStatusFilter.ALL },
    { label: 'Running', value: RhAgentRunStatusFilter.RUNNING },
    { label: 'Success', value: RhAgentRunStatusFilter.SUCCESS },
    { label: 'Partial', value: RhAgentRunStatusFilter.PARTIAL },
    { label: 'Failed',  value: RhAgentRunStatusFilter.FAILED },
  ];
}
