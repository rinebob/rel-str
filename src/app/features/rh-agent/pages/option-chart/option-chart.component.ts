/**
 * Option Chart Page
 *
 * Options contract viewer dashboard. Input an OCC contract ID, fetch the
 * historical time-series, and plot it on a dedicated chart with underlying
 * price overlay, Greeks, and volume/OI panes.
 */
import { Component, inject, computed, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';

import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionsContractChartComponent } from '../../components/options-contract-chart/options-contract-chart.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { formatUtcDate } from '../../utils/rh-agent.utils';

@Component({
  selector: 'app-option-chart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatAutocompleteModule,
    OptionsContractChartComponent,
  ],
  templateUrl: './option-chart.component.html',
  styleUrl: './option-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChartComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionsContractViewerStore);
  readonly uiStateService = inject(UiStateService);

  occIdInput = '';

  /** Whether the left control panel is open. */
  controlPanelOpen = true;

  // Builder fields (signals so computed/derived state reacts)
  symbol = signal('QQQ');
  readonly expiration = this.store.selectedExpiration;
  type = signal<'call' | 'put'>('call');
  readonly strike = this.store.selectedStrike;
  readonly contractLength = this.store.contractLength;

  readonly lengthOptions: { value: string; label: string; group: string }[] = [
    { value: '0DTE', label: '0DTE', group: 'Ultra short' },
    { value: '1D', label: '1 day', group: 'Ultra short' },
    { value: '2D', label: '2 day', group: 'Ultra short' },
    { value: '3D', label: '3 day', group: 'Ultra short' },
    { value: '5D', label: '5 day', group: 'Ultra short' },
    { value: '1W', label: '1 week', group: 'Weekly' },
    { value: '2W', label: '2 week', group: 'Weekly' },
    { value: '3W', label: '3 week', group: 'Weekly' },
    { value: '1M', label: '1 mo', group: 'Monthly' },
    { value: '2M', label: '2 mo', group: 'Monthly' },
    { value: '3M', label: '3 mo', group: 'Monthly' },
    { value: '6M', label: '6 mo', group: 'Monthly' },
    { value: '9M', label: '9 mo', group: 'Monthly' },
    { value: '12M', label: '12 mo / LEAP', group: 'LEAPS' },
    { value: '2Y', label: '2 yr', group: 'LEAPS' },
    { value: '3Y', label: '3 yr', group: 'LEAPS' },
  ];

  /** Build OCC ID from builder fields. */
  readonly builtOccId = computed(() => {
    const sym = (this.symbol() || '').trim().toUpperCase();
    const exp = this.expiration();
    const stk = this.strike();
    if (!sym || !exp || stk == null) return '';
    const { yy, mm, dd } = this.parseExpirationParts(exp);
    const cp = this.type() === 'call' ? 'C' : 'P';
    const strikeStr = String(Math.round(stk * 1000)).padStart(8, '0');
    return `${sym}${yy.slice(2)}${mm}${dd}${cp}${strikeStr}`;
  });

  /** Whether the search button should be enabled. */
  readonly canSearch = computed(() => {
    return !this.store.searchLoading()
      && this.symbol().trim().length > 0
      && (!!this.expiration() || this.strike() != null);
  });

  /** Expiration options with day-of-week labels, e.g. "2026-01-15 (Thu)". */
  readonly expirationOptions = computed(() =>
    this.store.filteredExpirations().map((exp) => ({
      value: exp,
      label: this.formatExpWithDow(exp),
    })),
  );

  /** Parse a YYYY-MM-DD expiration string into year/month/day parts. */
  private parseExpirationParts(exp: string): { yy: string; mm: string; dd: string } {
    const [yy, mm, dd] = exp.split('-');
    return { yy, mm: mm.padStart(2, '0'), dd: dd.padStart(2, '0') };
  }

  /** Format an expiration date string with day of week, e.g. "2026-01-15 (Thu)". */
  private formatExpWithDow(exp: string): string {
    return `${exp} (${formatUtcDate(exp, { weekday: 'short' })})`;
  }

  /** Sync built OCC ID to the input field. */
  onBuildChange(): void {
    const id = this.builtOccId();
    if (id) this.occIdInput = id;
  }

  /** Handle symbol change — clear dependent fields and fetch expirations/strikes. */
  onSymbolChange(value: string): void {
    this.symbol.set(value);
    this.occIdInput = '';
    this.store.clearSearch();
    const sym = value.trim().toUpperCase();
    if (sym) this.store.loadContractIndex(sym);
  }

  /** Label for the selected contract length. */
  readonly lengthLabel = computed(() => {
    const length = this.contractLength();
    return this.lengthOptions.find((o) => o.value === length)?.label ?? (length ?? '');
  });

  /** Length options grouped for the dropdown. */
  readonly lengthGroups = computed(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const opt of this.lengthOptions) {
      if (!groups.has(opt.group)) groups.set(opt.group, []);
      groups.get(opt.group)!.push({ value: opt.value, label: opt.label });
    }
    return Array.from(groups.entries()).map(([name, options]) => ({ name, options }));
  });

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
    const sym = this.symbol().trim().toUpperCase();
    if (sym) this.store.loadContractIndex(sym);
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  onLoad(): void {
    const id = this.occIdInput.trim().toUpperCase();
    if (!id) return;
    this.store.loadContract(id, this.store.contractLength());
  }

  onKeyPress(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.onLoad();
    }
  }

  /** Search for available contracts using the builder fields as filters. */
  onSearchContracts(): void {
    const sym = (this.symbol() || '').trim().toUpperCase();
    const exp = this.expiration();
    const stk = this.strike();
    const typ = this.type() === 'call' ? 'C' : 'P';

    const filters: { expiration?: string; strike?: number; type?: 'C' | 'P' } = { type: typ };
    if (exp) filters.expiration = exp;
    if (stk != null) filters.strike = stk;

    this.store.searchContracts(sym, filters);
  }

  /** Select a contract from search results and load it. */
  onSelectContract(contractId: string): void {
    const id = contractId.trim().toUpperCase();
    if (!id) return;
    this.occIdInput = id;
    this.onLoad();
  }

  /** Handle mat-autocomplete option selection — auto-load the selected contract. */
  onContractSelected(event: MatAutocompleteSelectedEvent): void {
    const id = (event.option?.value as string)?.trim().toUpperCase();
    if (!id) return;
    this.occIdInput = id;
    this.onLoad();
  }

  /** Whether the prev/next nav buttons can be used. */
  readonly canGoPrev = computed(() => {
    const idx = this.store.currentSearchIndex();
    return idx > 0 && !this.store.loading();
  });

  readonly canGoNext = computed(() => {
    const idx = this.store.currentSearchIndex();
    const count = this.store.searchResults().length;
    return idx >= 0 && idx < count - 1 && !this.store.loading();
  });

  onPrevContract(): void {
    this.store.navigateContract(-1);
  }

  onNextContract(): void {
    this.store.navigateContract(1);
  }
}
