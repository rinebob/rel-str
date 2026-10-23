/**
 * Symbol Row
 *
 * A single symbol expansion panel inside a group: ticker, signal badges,
 * company meta, trade and list action buttons, and signal history body.
 */
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { SymbolRow } from '../../stores/group.store';
import type { SymbolListDef } from '../../common/symbol-list-defs';
import { tierLabel } from '../../utils/utils';
import { SymbolActionsComponent } from '../symbol-actions/symbol-actions.component';
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
    SymbolActionsComponent,
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
  listCatalog = input.required<SymbolListDef[]>();
  /** When false, the row's Trade button is disabled for this historical row. */
  isActionableRun = input(true);

  /** Expose helper to template. */
  readonly tierLabel = tierLabel;

  select = output<void>();
  viewQuickCharts = output<string>();
  markForReview = output<string>();
  /** Trade the row's symbol (#1017 — replaced the ACR emit set). */
  trade = output<string>();
  toggleList = output<{ symbol: string; listKey: string }>();
}
