/**
 * Chart View Toolbar
 *
 * The merged page-top toolbar for chart-view (#1232/#1256) — scan + list
 * source dropdowns, indicator menu, symbol identity, the full chart-control
 * set, and the right action group (Trade | Order | Add | New only | symbol
 * input). Chart-control state is bound to the page-scoped
 * ChartToolbarStateService; everything else is plain inputs/outputs.
 */
import { Component, ChangeDetectionStrategy, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { BarsInterval } from '../../../../core/models/partner.types';
import { ChartLayout, UiStateService } from '../../../../core/services/ui-state.service';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { RhSelectMenuComponent, RhSelectOption, RhSelectOptionGroup } from '../rh-select-menu/rh-select-menu.component';
import { IndicatorMenuComponent } from '../indicator-menu/indicator-menu.component';
import { LogScalePillComponent } from '../log-scale-pill/log-scale-pill.component';
import { SymbolListActionsComponent } from '../symbol-list-actions/symbol-list-actions.component';
import type { SymbolListFilter } from '../../common/constants';
import type { SymbolListDef } from '../../common/symbol-list-defs';

const LIST_SENTINEL: RhSelectOption<SymbolListFilter>[] = [
  { value: 'ALL', label: 'All' },
];

/** Placeholder option while the latest-run cache doesn't exist — the
 *  dropdown renders disabled until #1258 wires real scan options. */
const SCAN_SENTINEL: RhSelectOption<string>[] = [
  { value: '—', label: '—' },
];

@Component({
  selector: 'app-chart-view-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    RhSelectMenuComponent,
    IndicatorMenuComponent,
    LogScalePillComponent,
    SymbolListActionsComponent,
  ],
  templateUrl: './chart-view-toolbar.component.html',
  styleUrl: './chart-view-toolbar.component.scss',
})
export class ChartViewToolbarComponent {
  readonly BarsInterval = BarsInterval;
  readonly ChartLayout = ChartLayout;
  readonly listSentinelOptions = LIST_SENTINEL;
  readonly scanSentinelOptions = SCAN_SENTINEL;

  readonly toolbarState = inject(ChartToolbarStateService);
  readonly uiStateService = inject(UiStateService);

  /** The active list source ('ALL' | listKey | NO_MEMBERSHIP). */
  activeList = input.required<SymbolListFilter>();
  /** Grouped catalog options — Triage then My lists, from the store. */
  listGroups = input<RhSelectOptionGroup<SymbolListFilter>[]>([]);
  /** The displayed symbol (list selection or manual input), null when none. */
  symbol = input<string | null>(null);
  /** Company name resolved from the st-symbols doc (null → ticker only). */
  companyName = input<string | null>(null);
  /** Whether the displayed symbol is in the tracked universe — filing
   *  chips only make sense for tracked symbols. */
  tracked = input(false);
  /** List catalog for the filing chips. */
  listCatalog = input<SymbolListDef[]>([]);
  /** 0-based index of the active symbol in the viewport, or -1. */
  symbolIndex = input<number>(-1);
  /** Total number of symbols in the viewport (0 = no nav). */
  symbolCount = input<number>(0);
  /** Non-terminal tickets in the order queue. */
  orderCount = input<number>(0);

  /** Emits the selected list filter when the user picks a list source. */
  listChange = output<SymbolListFilter>();
  /** Trade the displayed symbol — always the manual dialog, no run gating. */
  trade = output<void>();
  /** Navigate to the order page. */
  goToOrder = output<void>();
  /** Add-to-tracked request — stubbed by the host until SA lands it. */
  addToTracked = output<void>();
  /** Emits the raw input value on Load click or Enter in the field. */
  loadSymbol = output<string>();
  /** Emits when the user toggles the displayed symbol's list membership. */
  toggleList = output<{ symbol: string; listKey: string }>();
  /** Emits when the user clicks the previous-symbol nav button. */
  prevSymbol = output<void>();
  /** Emits when the user clicks the next-symbol nav button. */
  nextSymbol = output<void>();
}
