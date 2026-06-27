/**
 * Symbol ACR Actions
 *
 * Review / Accept / Consider / Reject / Reset buttons for a single symbol row.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RhReviewStatus } from '../../common/rh-agent.constants';
import { RhSymbolRow } from '../../stores/rh-agent-group.store';

@Component({
  selector: 'app-symbol-acr-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './symbol-acr-actions.component.html',
  styleUrl: './symbol-acr-actions.component.scss',
})
export class SymbolAcrActionsComponent {
  row = input.required<RhSymbolRow>();
  readonly Status = RhReviewStatus;

  markForReview = output<string>();
  accept = output<string>();
  consider = output<string>();
  reject = output<string>();
  reset = output<string>();
}
