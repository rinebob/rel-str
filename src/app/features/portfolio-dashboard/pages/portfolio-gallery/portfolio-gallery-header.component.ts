/**
 * Portfolio Gallery Header (#926/#950)
 *
 * Top bar of the portfolio-v2 page: account summary strip, card count,
 * side filter pills, global chart D/W toggle, group-dimension and list
 * selectors, refresh. No signal-timeframe filter — positions have no
 * signal timeframe; the D/W pill is chart context only.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import {
  SymbolListFilter,
  SignalTimeframe,
  CardChartTimeframe,
  DEFAULT_CARD_CHART_TIMEFRAME,
} from '../../../savant-trader/common/constants';
import {
  RhSelectMenuComponent,
  RhSelectOption,
  RhSelectOptionGroup,
} from '../../../savant-trader/components/rh-select-menu/rh-select-menu.component';
import { PositionGroupDimension, PositionSide } from './utils/position-cards.util';
import { SYMBOL_LIST_SENTINEL_OPTIONS } from '../../../savant-trader/common/symbol-list-filter-options';
import type { PortfolioGallerySummary } from './portfolio-gallery.facade';

/** Allocation bucket first per PRD; None (flat) is the default. */
const DIMENSION_OPTIONS: RhSelectOption<PositionGroupDimension>[] = [
  { value: PositionGroupDimension.BUCKET,   label: 'Bucket' },
  { value: PositionGroupDimension.SECTOR,   label: 'Sector' },
  { value: PositionGroupDimension.INDUSTRY, label: 'Industry' },
  { value: PositionGroupDimension.CAP_TIER, label: 'Market Cap' },
  { value: PositionGroupDimension.NONE,     label: 'None' },
];

@Component({
  selector: 'app-portfolio-gallery-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTooltipModule, MatIconModule, MatButtonModule, RhSelectMenuComponent],
  templateUrl: './portfolio-gallery-header.component.html',
  styleUrl: './portfolio-gallery-header.component.scss',
})
export class PortfolioGalleryHeaderComponent {
  readonly sentinelOptions = SYMBOL_LIST_SENTINEL_OPTIONS;
  readonly dimensionOptions = DIMENSION_OPTIONS;

  /** Account summary strip values — nulls render as —. */
  summary = input.required<PortfolioGallerySummary>();
  /** Visible card count under the active filters / total positions. */
  cardCount = input(0);
  totalCardCount = input(0);

  side = input<'all' | PositionSide>('all');
  /** Chart interval for every card (D/W) — chart context only. */
  chartTimeframe = input<CardChartTimeframe>(DEFAULT_CARD_CHART_TIMEFRAME);
  listFilter = input<SymbolListFilter>('ALL');
  listGroups = input<RhSelectOptionGroup<SymbolListFilter>[]>([]);
  groupDimension = input.required<PositionGroupDimension>();
  /** Every rendered group expanded — drives the expand-all icon. */
  allGroupsExpanded = input(false);
  /** No groups rendered (empty result set) — expand-all is a no-op. */
  expandAllDisabled = input(false);
  /** Whether the grid renders expando groups — the expand-all button only
   *  makes sense when they're mounted (currently dormant: the grouped
   *  view renders a sorted flat grid instead). */
  expandAllVisible = input(true);
  refreshing = input(false);

  readonly SignalTimeframe = SignalTimeframe;
  readonly PositionGroupDimension = PositionGroupDimension;

  sideChange = output<'all' | PositionSide>();
  chartTimeframeChange = output<CardChartTimeframe>();
  listFilterChange = output<SymbolListFilter>();
  dimensionChange = output<PositionGroupDimension>();
  expandAllToggle = output<void>();
  refresh = output<void>();

  /** Whole-dollar display, '—' for missing. */
  fmtDollars(v: number | null | undefined): string {
    return v != null && Number.isFinite(v)
      ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : '—';
  }

  /** Signed whole-dollar display for P&L cells. */
  fmtPnl(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return '—';
    const abs = `$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    return v < 0 ? `−${abs}` : `+${abs}`;
  }
}
