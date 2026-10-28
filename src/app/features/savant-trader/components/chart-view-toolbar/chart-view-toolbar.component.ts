/**
 * Chart View Toolbar
 *
 * The merged page-top toolbar for chart-view (#1232/#1256) — scan + list
 * source dropdowns, indicator menu, symbol identity, the full chart-control
 * set, and the right action group (Trade | Order | Add | New only | symbol
 * input). Chart-control state is bound to the page-scoped
 * ChartToolbarStateService; everything else is plain inputs/outputs.
 */
import { Component, ChangeDetectionStrategy, computed, inject, input, output } from '@angular/core';
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
import { isScanSource, type SymbolListFilter } from '../../common/constants';
import type { SymbolListDef } from '../../common/symbol-list-defs';

const LIST_SENTINEL: RhSelectOption<SymbolListFilter>[] = [
  { value: 'ALL', label: 'All' },
];

/** The clear-scan option value — shown in the Scan trigger whenever no
 *  scan source is active; picking it routes back to ALL (#1258). */
const SCAN_CLEAR: SymbolListFilter = '—';
const SCAN_SENTINEL: RhSelectOption<SymbolListFilter>[] = [
  { value: SCAN_CLEAR, label: SCAN_CLEAR },
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

  readonly toolbarState = inject(ChartToolbarStateService);
  readonly uiStateService = inject(UiStateService);

  /** The single active source ('ALL' | listKey | NO_MEMBERSHIP |
   *  'scan:{recipeId}') — the two dropdowns derive their display values
   *  from this one input. */
  activeList = input.required<SymbolListFilter>();
  /** Cached latest-run options for the Scan dropdown. */
  scanOptions = input<RhSelectOption<SymbolListFilter>[]>([]);
  /** Scan-source filter — hide tracked-universe rows (#1258). */
  newOnly = input(true);
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

  /** `—` plus the cached scan options — the menu needs a matching option
   *  for its display value, and `—` doubles as the clear-scan escape.
   *  An active scan key whose cache doc disappeared is appended raw so
   *  the trigger still resolves a label instead of going blank. */
  readonly scanMenuOptions = computed(() => {
    const options = [...SCAN_SENTINEL, ...this.scanOptions()];
    const active = this.activeList();
    if (this.scanActive() && !options.some((o) => o.value === active)) {
      options.push({ value: active, label: active });
    }
    return options;
  });
  /** Whether the active source is a `scan:{recipeId}` key — gates the
   *  New-only pill and the clear-scan pick. */
  readonly scanActive = computed(() => isScanSource(this.activeList()));
  /** Scan menu display value — the scan key while one is active, else
   *  `—`. Always an option, so the trigger never renders blank. */
  readonly scanMenuValue = computed(() =>
    this.scanActive() ? this.activeList() : SCAN_CLEAR,
  );
  /** List menu display value — the list source, or 'ALL' while a scan
   *  owns the source slot. Always an option, so the trigger never
   *  renders blank. */
  readonly listMenuValue = computed(() =>
    this.scanActive() ? 'ALL' : this.activeList(),
  );

  /** Emits the selected list filter when the user picks a list source. */
  listChange = output<SymbolListFilter>();
  /** Emits the picked scan source; the `—` option arrives as 'ALL'. */
  scanChange = output<SymbolListFilter>();
  /** Emits the desired New-only state when the pill is clicked. */
  newOnlyChange = output<boolean>();
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

  /** `—` clears the scan selection back to ALL — a no-op when no scan
   *  is active (the trigger just re-displays `—` on a list source;
   *  emitting ALL would silently reset the sibling list source). */
  onScanValueChange(value: SymbolListFilter): void {
    if (value === SCAN_CLEAR) {
      if (this.scanActive()) this.scanChange.emit('ALL');
      return;
    }
    this.scanChange.emit(value);
  }
}
