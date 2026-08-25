/**
 * Agent Status Bar
 *
 * Displays the agent status summary: last run time/status, trigger source,
 * and schedule description.
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-agent-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  templateUrl: './agent-status-bar.component.html',
  styleUrl: './agent-status-bar.component.scss',
})
export class AgentStatusBarComponent {
  lastRunAt = input<string | Date | null | undefined>(undefined);
  lastRunStatus = input<string | null | undefined>(undefined);
  triggeredBy = input<string | null | undefined>(undefined);
  scheduleDescription = input<string | null | undefined>(undefined);
}
