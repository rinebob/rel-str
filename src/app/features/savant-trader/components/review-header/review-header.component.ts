/**
 * Review Header
 *
 * Top bar of the Savant Trader review page: back/history navigation, selected-symbol
 * ACR actions, page title, and the manual symbol input.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { RhSelectMenuComponent, RhSelectOption } from '../rh-select-menu/rh-select-menu.component';
import { SymbolListName, ViewportMode } from '../../common/constants';

const LIST_OPTIONS: RhSelectOption[] = [
  { value: SymbolListName.NONE,           label: 'None' },
  { value: SymbolListName.PRIMARY,       label: 'Primary' },
  { value: SymbolListName.SECONDARY,     label: 'Secondary' },
  { value: SymbolListName.NEUTRAL,       label: 'Neutral' },
  { value: SymbolListName.AVOID,         label: 'Avoid' },
  { value: SymbolListName.PAST_SIGNALS,  label: 'Monitor' },
];

@Component({
  selector: 'app-review-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, RouterLink, RhSelectMenuComponent],
  templateUrl: './review-header.component.html',
  styleUrl: './review-header.component.scss',
})
export class ReviewHeaderComponent {
  readonly listOptions = LIST_OPTIONS;
  protected readonly appRoutes = AppRoutes;

  selectedSymbol = input<string | null>(null);
  manualSymbol = input<string | null>(null);
  companyName = input<string | null>(null);
  status = input('PENDING');
  activeList = input<string>(SymbolListName.NONE);
  viewportMode = input<ViewportMode>('signals');
  /** When false, ACR and queue mutation controls are disabled for the viewed historical run. */
  isActionableRun = input(true);
  /** Count of accepted symbols available for staging. */
  acceptedCount = input(0);

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
  /** Emits when the user clicks the Order button to go to the order page. */
  goToOrder = output<void>();
}
