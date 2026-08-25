/**
 * Status Summary Chips
 *
 * Reusable status-count chips used in the signal-review header and group headers.
 */
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StatusCounts } from '../../common/constants';

@Component({
  selector: 'app-status-summary-chips',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './status-summary-chips.component.html',
  styleUrl: './status-summary-chips.component.scss',
})
export class StatusSummaryChipsComponent {
  counts = input.required<StatusCounts>();
}
