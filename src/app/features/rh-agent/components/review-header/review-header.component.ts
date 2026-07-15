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
import { RhSelectMenuComponent, RhSelectOption } from '../rh-select-menu/rh-select-menu.component';
import { RhSymbolListName, ViewportMode } from '../../common/rh-agent.constants';

const LIST_OPTIONS: RhSelectOption[] = [
  { value: RhSymbolListName.NONE,           label: 'None' },
  { value: RhSymbolListName.PRIMARY,       label: 'Primary' },
  { value: RhSymbolListName.SECONDARY,     label: 'Secondary' },
  { value: RhSymbolListName.NEUTRAL,       label: 'Neutral' },
  { value: RhSymbolListName.AVOID,         label: 'Avoid' },
  { value: RhSymbolListName.PAST_SIGNALS,  label: 'Monitor' },
];

@Component({
  selector: 'app-review-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, RhSelectMenuComponent],
  templateUrl: './review-header.component.html',
  styleUrl: './review-header.component.scss',
})
export class ReviewHeaderComponent {
  readonly listOptions = LIST_OPTIONS;

  selectedSymbol = input<string | null>(null);
  manualSymbol = input<string | null>(null);
  companyName = input<string | null>(null);
  status = input('PENDING');
  activeList = input<string>(RhSymbolListName.NONE);
  viewportMode = input<ViewportMode>('signals');

  back = output<void>();
  history = output<void>();
  accept = output<void>();
  watch = output<void>();
  reject = output<void>();
  loadSymbol = output<string>();
  symbolKeydown = output<{ event: KeyboardEvent; input: HTMLInputElement }>();
  /** Emits when the user opens the "new symbols" dialog. */
  newSymbols = output<void>();
  /** Emits the selected list name when user picks a symbol list to review. */
  listChange = output<string>();
  /** Emits when the user toggles viewport mode (signals / browse). */
  modeChange = output<void>();
}
