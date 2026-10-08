/**
 * Gallery Header
 *
 * Top bar of the gallery view page: title, viewed-run context, card count,
 * timeframe/direction filter pills, list filter, and the group-dimension
 * selector (#783 — same dimensions as signal-review).
 * Bulk-selection actions land here in #758.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { SymbolListFilter, SignalTimeframe, SignalDirection, GroupDimension, CardChartTimeframe, DEFAULT_CARD_CHART_TIMEFRAME } from '../../common/constants';
import { formatTimestampPT } from '../../utils/utils';
import { SignalFilterPillsComponent } from '../signal-filter-pills/signal-filter-pills.component';
import {
  RhSelectMenuComponent,
  RhSelectOption,
  RhSelectOptionGroup,
} from '../rh-select-menu/rh-select-menu.component';

const SENTINEL: RhSelectOption<SymbolListFilter>[] = [
  { value: 'ALL', label: 'All' },
];

/** Same grouping dimensions as signal-review (#783), plus a flat-grid
 *  "None" mode (#820). */
const DIMENSION_OPTIONS: RhSelectOption<GroupDimension>[] = [
  { value: GroupDimension.SECTOR,          label: 'Sector' },
  { value: GroupDimension.INDUSTRY,        label: 'Industry' },
  { value: GroupDimension.MARKET_CAP_TIER, label: 'Market Cap' },
  { value: GroupDimension.NONE,            label: 'None' },
];

@Component({
  selector: 'app-gallery-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTooltipModule, MatIconModule, MatButtonModule, SignalFilterPillsComponent, RhSelectMenuComponent],
  templateUrl: './gallery-header.component.html',
  styleUrl: './gallery-header.component.scss',
})
export class GalleryHeaderComponent {
  readonly sentinelOptions = SENTINEL;
  readonly dimensionOptions = DIMENSION_OPTIONS;

  /** Market date of the run the gallery is showing. */
  marketDate = input<string | null>(null);
  /** When the viewed run finished — shown as the data-refresh timestamp. */
  runCompletedAt = input<string | null>(null);
  /** Visible card count under the active filters. */
  cardCount = input(0);
  /** Total cards for the run, before filtering. */
  totalCardCount = input(0);

  timeframe = input<SignalTimeframe>(SignalTimeframe.ALL);
  /** Chart interval for every card (DAILY|WEEKLY) — independent of the
   *  `timeframe` signal filter. */
  chartTimeframe = input<CardChartTimeframe>(DEFAULT_CARD_CHART_TIMEFRAME);
  direction = input<SignalDirection>(SignalDirection.ALL);
  listFilter = input<SymbolListFilter>('ALL');
  listGroups = input<RhSelectOptionGroup<SymbolListFilter>[]>([]);
  /** Grouping dimension for the expando layout (#783) — same as signal-review. */
  groupDimension = input.required<GroupDimension>();
  /** True when every rendered group is expanded — drives the toggle icon. */
  allGroupsExpanded = input(true);
  /** True while a run refresh is in flight — disables the refresh button. */
  refreshing = input(false);

  readonly formatTimestampPT = formatTimestampPT;
  readonly SignalTimeframe = SignalTimeframe;

  timeframeChange = output<SignalTimeframe>();
  chartTimeframeChange = output<CardChartTimeframe>();
  directionChange = output<SignalDirection>();
  listFilterChange = output<SymbolListFilter>();
  dimensionChange = output<GroupDimension>();
  expandAllToggle = output<void>();
  refresh = output<void>();
}
