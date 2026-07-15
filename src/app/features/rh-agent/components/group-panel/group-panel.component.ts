/**
 * Group Panel
 *
 * A single mat-expansion-panel for a group (sector, industry, market cap tier).
 * Renders the group header and a list of symbol rows.
 */
import { Component, ChangeDetectionStrategy, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RhSymbolGroup, RhSymbolRow } from '../../stores/rh-agent-group.store';
import { RhSymbolListName, SignalDirection } from '../../common/rh-agent.constants';
import { rowHasDirection } from '../../utils/rh-agent.utils';
import { SymbolRowComponent } from '../symbol-row/symbol-row.component';

@Component({
  selector: 'app-group-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatExpansionModule,
    MatIconModule,
    MatTooltipModule,
    SymbolRowComponent,
  ],
  templateUrl: './group-panel.component.html',
  styleUrl: './group-panel.component.scss',
})
export class GroupPanelComponent {
  group = input.required<RhSymbolGroup>();
  expanded = input(false);
  visibleRows = input.required<RhSymbolRow[]>();
  symbolLists = input.required<Record<string, string[]>>();
  activeListFilter = input.required<RhSymbolListName | 'ALL'>();
  selectedSymbol = input<string | null>(null);
  quickChartSymbol = input<string | null>(null);
  /** When false, ACR mutation controls are disabled for all rows in this group. */
  isActionableRun = input(true);

  readonly visibleSymbolCount = computed(() => this.visibleRows().length);

  readonly visibleLongCount = computed(() =>
    this.visibleRows().filter(r => rowHasDirection(r, SignalDirection.LONG)).length
  );
  readonly visibleShortCount = computed(() =>
    this.visibleRows().filter(r => rowHasDirection(r, SignalDirection.SHORT)).length
  );

  opened = output<void>();
  expandAll = output<{ group: RhSymbolGroup; expand: boolean }>();

  rowSelect = output<string>();
  rowViewQuickCharts = output<string>();
  rowMarkForReview = output<string>();
  rowAccept = output<string>();
  rowConsider = output<string>();
  rowReject = output<string>();
  rowReset = output<string>();
  rowToggleList = output<{ symbol: string; listName: RhSymbolListName }>();
  rowMonitor = output<string>();

  onExpandAll(event: Event): void {
    event.stopPropagation();
    this.expandAll.emit({ group: this.group(), expand: !this.expanded() });
  }
}
