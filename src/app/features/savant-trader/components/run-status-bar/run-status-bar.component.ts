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
  selector: 'app-run-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule],
  templateUrl: './run-status-bar.component.html',
  styleUrl: './run-status-bar.component.scss',
})
export class RunStatusBarComponent {
  lastRunAt = input<string | Date | null | undefined>(undefined);
  lastRunStatus = input<string | null | undefined>(undefined);
  triggeredBy = input<string | null | undefined>(undefined);
  scheduleDescription = input<string | null | undefined>(undefined);
}
