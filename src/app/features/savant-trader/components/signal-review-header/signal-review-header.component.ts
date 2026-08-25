/**
 * Signal Review Header
 *
 * Top bar of the signal review page: navigation, signal counts, status chips,
 * pipeline actions, group/list selectors, and view controls.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { RhSymbolListName, StatusCounts, GroupDimension, SignalTimeframe, SignalDirection } from '../../common/constants';
import { StatusSummaryChipsComponent } from '../status-summary-chips/status-summary-chips.component';
import { SignalFilterPillsComponent } from '../signal-filter-pills/signal-filter-pills.component';
import { RhSelectMenuComponent, RhSelectOption } from '../rh-select-menu/rh-select-menu.component';

const DIMENSION_OPTIONS: RhSelectOption[] = [
  { value: GroupDimension.SECTOR,          label: 'Sector' },
  { value: GroupDimension.INDUSTRY,        label: 'Industry' },
  { value: GroupDimension.MARKET_CAP_TIER, label: 'Market Cap' },
];

const LIST_FILTER_OPTIONS: RhSelectOption[] = [
  { value: 'ALL',                          label: 'All' },
  { value: RhSymbolListName.PRIMARY,       label: 'Primary' },
  { value: RhSymbolListName.SECONDARY,     label: 'Secondary' },
  { value: RhSymbolListName.NEUTRAL,       label: 'Neutral' },
  { value: RhSymbolListName.AVOID,         label: 'Avoid' },
  { value: RhSymbolListName.HIDE,          label: 'Hidden' },
  { value: RhSymbolListName.PAST_SIGNALS,  label: 'Monitor' },
];

@Component({
  selector: 'app-signal-review-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RouterLink,
    StatusSummaryChipsComponent,
    SignalFilterPillsComponent,
    RhSelectMenuComponent,
  ],
  templateUrl: './signal-review-header.component.html',
  styleUrl: './signal-review-header.component.scss',
})
export class SignalReviewHeaderComponent {
  readonly dimensionOptions = DIMENSION_OPTIONS;
  readonly listFilterOptions = LIST_FILTER_OPTIONS;
  protected readonly appRoutes = AppRoutes;

  totalSignalCount = input(0);
  weeklySignalCount = input(0);
  dailySignalCount = input(0);
  longCount = input(0);
  shortCount = input(0);
  statusCounts = input.required<StatusCounts>();
  reviewCount = input(0);
  acceptedCount = input(0);
  groupDimension = input<GroupDimension>(GroupDimension.SECTOR);
  activeListFilter = input<RhSymbolListName | 'ALL'>('ALL');
  timeframe = input<SignalTimeframe>(SignalTimeframe.ALL);
  direction = input<SignalDirection>(SignalDirection.ALL);
  showAllSymbols = input(false);
  allExpanded = input(false);
  fullscreen = input(false);
  loading = input(false);
  quickChartSymbol = input<string | null>(null);
  flatSymbols = input<string[]>([]);
  /** When false, mutation actions in the header are disabled for the viewed historical run. */
  isActionableRun = input(true);

  back = output<void>();
  goToReview = output<void>();
  goToOrder = output<void>();
  goToTriageReport = output<void>();
  dimensionChange = output<string>();
  listFilterChange = output<string>();
  timeframeFilterChange = output<SignalTimeframe>();
  directionFilterChange = output<SignalDirection>();
  prev = output<void>();
  next = output<void>();
  toggleShowAllSymbols = output<void>();
  toggleExpandAll = output<void>();
  refresh = output<void>();
  clearReviewFlags = output<void>();
  toggleFullscreen = output<void>();
}
