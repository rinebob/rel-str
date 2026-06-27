/**
 * Symbol Row
 *
 * A single symbol expansion panel inside a group: ticker, signal badges,
 * company meta, ACR and list action buttons, and signal history body.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { RhSymbolRow } from '../../stores/rh-agent-group.store';
import { RhSymbolListName, RhReviewStatus } from '../../common/rh-agent.constants';
import { tierLabel, latestSignals } from '../../utils/rh-agent.utils';
import { SymbolAcrActionsComponent } from '../symbol-acr-actions/symbol-acr-actions.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
import { SymbolSignalHistoryComponent } from '../symbol-signal-history/symbol-signal-history.component';

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
  ],
  templateUrl: './symbol-row.component.html',
  styleUrl: './symbol-row.component.scss',
})
export class SymbolRowComponent {
  row = input.required<RhSymbolRow>();
  isSelected = input(false);
  isChartActive = input(false);
  expanded = input(false);
  symbolLists = input.required<Record<string, string[]>>();
  activeListFilter = input.required<RhSymbolListName | 'ALL'>();
  readonly Status = RhReviewStatus;
  readonly ListName = RhSymbolListName;

  /** Expose helper to template. */
  readonly tierLabel = tierLabel;
  readonly latestSignals = latestSignals;

  select = output<void>();
  viewQuickCharts = output<string>();
  markForReview = output<string>();
  accept = output<string>();
  consider = output<string>();
  reject = output<string>();
  reset = output<string>();
  toggleList = output<{ symbol: string; listName: RhSymbolListName }>();
  monitor = output<string>();
}
