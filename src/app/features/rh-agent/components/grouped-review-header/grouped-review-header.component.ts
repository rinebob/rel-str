/**
 * Grouped Review Header
 *
 * Top bar of the grouped review page: navigation, signal counts, status chips,
 * pipeline actions, group/list selectors, and view controls.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { GroupDimension } from '../../stores/rh-agent-group.store';
import { RhSymbolListName, StatusCounts } from '../../common/rh-agent.constants';
import { StatusSummaryChipsComponent } from '../status-summary-chips/status-summary-chips.component';

@Component({
  selector: 'app-grouped-review-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    StatusSummaryChipsComponent,
  ],
  templateUrl: './grouped-review-header.component.html',
  styleUrl: './grouped-review-header.component.scss',
})
export class GroupedReviewHeaderComponent {
  totalSignalCount = input(0);
  weeklySignalCount = input(0);
  dailySignalCount = input(0);
  longCount = input(0);
  shortCount = input(0);
  statusCounts = input.required<StatusCounts>();
  reviewCount = input(0);
  acceptedCount = input(0);
  groupDimension = input<GroupDimension>('sector');
  activeListFilter = input<RhSymbolListName | 'ALL'>('ALL');
  showAllSymbols = input(false);
  allExpanded = input(false);
  fullscreen = input(false);
  loading = input(false);
  quickChartSymbol = input<string | null>(null);
  flatSymbols = input<string[]>([]);

  readonly dimensionOptions: { value: GroupDimension; label: string }[] = [
    { value: 'sector',        label: 'Sector' },
    { value: 'industry',      label: 'Industry' },
    { value: 'marketCapTier', label: 'Market Cap' },
  ];

  readonly listFilterOptions: { value: RhSymbolListName | 'ALL'; label: string }[] = [
    { value: 'ALL',                       label: 'All' },
    { value: RhSymbolListName.PRIMARY,    label: 'Primary' },
    { value: RhSymbolListName.SECONDARY,  label: 'Secondary' },
    { value: RhSymbolListName.NEUTRAL,    label: 'Neutral' },
    { value: RhSymbolListName.AVOID,      label: 'Avoid' },
    { value: RhSymbolListName.HIDE,       label: 'Hidden' },
    { value: RhSymbolListName.PAST_SIGNALS, label: 'Monitor' },
  ];

  back = output<void>();
  goToReview = output<void>();
  goToOrder = output<void>();
  goToTriageReport = output<void>();
  dimensionChange = output<GroupDimension>();
  listFilterChange = output<RhSymbolListName | 'ALL'>();
  prev = output<void>();
  next = output<void>();
  toggleShowAllSymbols = output<void>();
  toggleExpandAll = output<void>();
  refresh = output<void>();
  toggleFullscreen = output<void>();
}
