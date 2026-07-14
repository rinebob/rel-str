/**
 * Review Header
 *
 * Top bar of the RH Agent review page: back/history navigation, selected-symbol
 * ACR actions, page title, and the manual symbol input.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-review-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule],
  templateUrl: './review-header.component.html',
  styleUrl: './review-header.component.scss',
})
export class ReviewHeaderComponent {
  selectedSymbol = input<string | null>(null);
  manualSymbol = input<string | null>(null);
  companyName = input<string | null>(null);
  status = input('PENDING');

  back = output<void>();
  history = output<void>();
  accept = output<void>();
  watch = output<void>();
  reject = output<void>();
  loadSymbol = output<string>();
  symbolKeydown = output<{ event: KeyboardEvent; input: HTMLInputElement }>();
  /** Emits when the user opens the "new symbols" dialog. */
  newSymbols = output<void>();
}
