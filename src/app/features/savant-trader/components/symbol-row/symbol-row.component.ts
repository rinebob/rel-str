/**
 * Symbol Row
 *
 * A single symbol expansion panel inside a group: ticker, signal badges,
 * company meta, ACR and list action buttons, and signal history body.
 */
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { SymbolRow } from '../../stores/group.store';
import { SymbolListName, ReviewDecision } from '../../common/constants';
import { tierLabel } from '../../utils/utils';
import { SymbolAcrActionsComponent } from '../symbol-acr-actions/symbol-acr-actions.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
import { SymbolSignalHistoryComponent } from '../symbol-signal-history/symbol-signal-history.component';
import { ScrollIntoViewDirective } from '../../directives/scroll-into-view.directive';

@Component({
  selector: 'app-symbol-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatIconModule,
    MatTooltipModule,
    MatBadgeModule,
    SymbolAcrActionsComponent,
    SymbolListActionsComponent,
    SymbolSignalHistoryComponent,
    ScrollIntoViewDirective,
  ],
  templateUrl: './symbol-row.component.html',
  styleUrl: './symbol-row.component.scss',
})
export class SymbolRowComponent {
  row = input.required<SymbolRow>();
  isSelected = input(false);
  isChartActive = input(false);
  expanded = input(false);
  symbolLists = input.required<Record<string, string[]>>();
  activeListFilter = input.required<SymbolListName | 'ALL'>();
  /** When false, ACR mutation controls are disabled for this historical row. */
  isActionableRun = input(true);
  readonly Status = ReviewDecision;
  readonly ListName = SymbolListName;

  /** Expose helper to template. */
  readonly tierLabel = tierLabel;

  select = output<void>();
  viewQuickCharts = output<string>();
  markForReview = output<string>();
  accept = output<string>();
  consider = output<string>();
  reject = output<string>();
  reset = output<string>();
  clearHistory = output<string>();
  toggleList = output<{ symbol: string; listName: SymbolListName }>();
  monitor = output<string>();
}
