/**
 * Gallery Header
 *
 * Top bar of the gallery view page: title, viewed-run context, card count,
 * timeframe/direction filter pills, list filter, and sort selector.
 * Bulk-selection actions land here in #758.
 */
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SymbolListFilter, SignalTimeframe, SignalDirection } from '../../common/constants';
import { SignalFilterPillsComponent } from '../signal-filter-pills/signal-filter-pills.component';
import {
  RhSelectMenuComponent,
  RhSelectOption,
  RhSelectOptionGroup,
} from '../rh-select-menu/rh-select-menu.component';
import { GallerySortKey } from '../../utils/gallery-cards.util';

const SENTINEL: RhSelectOption<SymbolListFilter>[] = [
  { value: 'ALL', label: 'All' },
];

@Component({
  selector: 'app-gallery-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatTooltipModule, SignalFilterPillsComponent, RhSelectMenuComponent],
  templateUrl: './gallery-header.component.html',
  styleUrl: './gallery-header.component.scss',
})
export class GalleryHeaderComponent {
  readonly sentinelOptions = SENTINEL;

  /** Market date of the run the gallery is showing. */
  marketDate = input<string | null>(null);
  /** Visible card count under the active filters. */
  cardCount = input(0);
  /** Total cards for the run, before filtering. */
  totalCardCount = input(0);

  timeframe = input<SignalTimeframe>(SignalTimeframe.ALL);
  direction = input<SignalDirection>(SignalDirection.ALL);
  listFilter = input<SymbolListFilter>('ALL');
  listGroups = input<RhSelectOptionGroup<SymbolListFilter>[]>([]);
  sort = input.required<GallerySortKey>();
  sortOptions = input.required<RhSelectOption<GallerySortKey>[]>();

  timeframeChange = output<SignalTimeframe>();
  directionChange = output<SignalDirection>();
  listFilterChange = output<SymbolListFilter>();
  sortChange = output<GallerySortKey>();
}
