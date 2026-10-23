/**
 * Symbol row actions — Trade + review-flag buttons (#1017 — the ACR
 * Accept/Consider/Reject/Reset icon set was replaced by a single Trade
 * action that stages the symbol's ticket and opens the order dialog).
 */
import { Component, ChangeDetectionStrategy, booleanAttribute, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SymbolRow } from '../../stores/group.store';

@Component({
  selector: 'app-symbol-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './symbol-actions.component.html',
  styleUrl: './symbol-actions.component.scss',
})
export class SymbolActionsComponent {
  row = input.required<SymbolRow>();
  /** When true, the Trade button is disabled. */
  disabled = input(false, { transform: booleanAttribute });

  markForReview = output<string>();
  /** Trade the row's symbol (#1017 — replaced the ACR emit set). */
  trade = output<string>();
}
