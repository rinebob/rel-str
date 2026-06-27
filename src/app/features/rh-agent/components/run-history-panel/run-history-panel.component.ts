/**
 * Run History Panel
 *
 * Displays the agent run history: the current run and a collapsible list of
 * previous runs.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatChipsModule } from '@angular/material/chips';
import { RhAgentRun } from '../../services/rh-agent.service';
import { getRunStatusColor, getRunStatusIcon } from '../../utils/rh-agent.utils';

@Component({
  selector: 'app-run-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatExpansionModule, MatChipsModule],
  templateUrl: './run-history-panel.component.html',
  styleUrl: './run-history-panel.component.scss',
})
export class RunHistoryPanelComponent {
  currentRun = input<RhAgentRun | null>(null);
  currentRunOpen = input(true);
  previousRuns = input<RhAgentRun[]>([]);
  showAllRuns = input(false);
  runsTotal = input(0);

  toggleCurrentRun = output<void>();
  toggleShowAllRuns = output<void>();

  readonly getRunStatusColor = getRunStatusColor;
  readonly getRunStatusIcon = getRunStatusIcon;
}
