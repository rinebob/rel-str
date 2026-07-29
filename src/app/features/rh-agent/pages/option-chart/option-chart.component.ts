/**
 * Option Chart Page
 *
 * Options contract viewer dashboard. Input an OCC contract ID, fetch the
 * historical time-series, and plot it on a dedicated chart with underlying
 * price overlay, Greeks, and volume/OI panes.
 */
import { Component, inject, computed, signal, viewChild, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
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

import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import { OptionsContractChartComponent } from '../../components/options-contract-chart/options-contract-chart.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { formatUtcDate } from '../../utils/rh-agent.utils';
import {
  groupLengthBuckets,
  getLengthLabel,
  toCatalogRow,
  type CatalogRow,
  type LengthGroup,
} from '../../utils/contract-length.utils';
import type { ContractCatalogEntry } from '@options-contract/contracts';

type SortField = 'type' | 'strike' | 'expiration' | 'contractLengthDays' | 'observationCount' | 'delta';
interface SortLevel { field: SortField; direction: 'asc' | 'desc'; }

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
    OptionsContractChartComponent,
  ],
  templateUrl: './option-chart.component.html',
  styleUrl: './option-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionChartComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionsContractViewerStore);
  readonly uiStateService = inject(UiStateService);
  readonly chartRef = viewChild(OptionsContractChartComponent);

  occIdInput = '';

  /** Whether the left control panel is open. */
  controlPanelOpen = true;

  // Builder fields (signals so computed/derived state reacts)
  symbol = signal('QQQ');
  readonly expiration = this.store.selectedExpiration;
  type = signal<'call' | 'put' | 'both'>('call');
  readonly strike = this.store.selectedStrike;
  readonly contractLength = this.store.contractLength;


  /** Build OCC ID from builder fields. */
  readonly builtOccId = computed(() => {
    const sym = (this.symbol() || '').trim().toUpperCase();
    const exp = this.expiration();
    const stk = this.strike();
    if (!sym || !exp || stk == null) return '';
    const { yy, mm, dd } = this.parseExpirationParts(exp);
    if (this.type() === 'both') return '';
    const cp = this.type() === 'call' ? 'C' : 'P';
    const strikeStr = String(Math.round(stk * 1000)).padStart(8, '0');
    return `${sym}${yy.slice(2)}${mm}${dd}${cp}${strikeStr}`;
  });

  /** Whether the search button should be enabled. */
  readonly canSearch = computed(() => {
    return !this.store.catalogLoading()
      && this.symbol().trim().length > 0;
  });

  /** Parsed catalog results with numeric latest values for display. */
  readonly catalogRows = computed<CatalogRow[]>(() =>
    this.store.catalogResults().map(toCatalogRow),
  );

  /** Multi-column sort state — order of array = sort priority. */
  sortLevels = signal<SortLevel[]>([]);

  /** Catalog rows after applying client-side multi-column sort. */
  readonly sortedCatalogRows = computed<CatalogRow[]>(() => {
    const rows = this.catalogRows();
    const levels = this.sortLevels();
    if (levels.length === 0) return rows;
    return [...rows].sort((a, b) => {
      for (const { field, direction } of levels) {
        const cmp = compareByField(a, b, field);
        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });
  });

  /** Sort indicator for a column: { priority, direction } or null. */
  getSortInfo(field: SortField): { priority: number; direction: 'asc' | 'desc' } | null {
    const idx = this.sortLevels().findIndex((l) => l.field === field);
    if (idx === -1) return null;
    return { priority: idx + 1, direction: this.sortLevels()[idx].direction };
  }

  /** Click-to-add, cycle-to-remove sort. */
  onColumnSort(field: SortField): void {
    const levels = [...this.sortLevels()];
    const idx = levels.findIndex((l) => l.field === field);
    if (idx === -1) {
      levels.push({ field, direction: 'asc' });
    } else if (levels[idx].direction === 'asc') {
      levels[idx] = { field, direction: 'desc' };
    } else {
      levels.splice(idx, 1);
    }
    this.sortLevels.set(levels);
  }

  /** Client-side strike range filter. */
  strikeMin = signal<number | null>(null);
  strikeMax = signal<number | null>(null);

  /** Client-side expiration date range filter (from chart extents). */
  expMin = signal<string | null>(null);
  expMax = signal<string | null>(null);

  /** Sorted rows filtered by strike range and expiration date range for display. */
  readonly displayedRows = computed<CatalogRow[]>(() => {
    const rows = this.sortedCatalogRows();
    const min = this.strikeMin();
    const max = this.strikeMax();
    const expMin = this.expMin();
    const expMax = this.expMax();
    if (min == null && max == null && !expMin && !expMax) return rows;
    return rows.filter((r) => {
      if (min != null && r.strike < min) return false;
      if (max != null && r.strike > max) return false;
      if (expMin && r.expiration < expMin) return false;
      if (expMax && r.expiration > expMax) return false;
      return true;
    });
  });

  /** Expiration options with day-of-week labels and contract counts, e.g. "2026-01-15 (Thu) · 42". */
  readonly expirationOptions = computed(() =>
    this.store.filteredExpirations().map((exp) => {
      const strikes = this.store.expirationToStrikes()[exp];
      const count = strikes ? strikes.length * 2 : 0;
      return {
        value: exp,
        label: this.formatExpWithDow(exp),
        count,
      };
    }),
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

  /** Handle symbol change — clear dependent fields and fetch expirations/strikes + catalog summary. */
  onSymbolChange(value: string): void {
    this.symbol.set(value);
    this.occIdInput = '';
    this.store.clearCatalog();
    this.store.clearCatalogFilters();
    this.store.setCatalogBuilder({ symbol: value });
    const sym = value.trim().toUpperCase();
    if (sym) {
      this.store.loadContractIndex(sym);
      this.store.loadCatalogSummary(sym);
      this.store.loadUnderlyingBars(sym);
    }
  }

  /** Label for the selected contract length. */
  readonly lengthLabel = computed(() => {
    const length = this.contractLength();
    return length ? getLengthLabel(length) : '';
  });

  /** Length options grouped for the dropdown with contract counts from summary. */
  readonly lengthGroups = computed<LengthGroup[]>(() => {
    const summary = this.store.catalogSummary();
    if (summary?.lengthBuckets) {
      const entries = Object.entries(summary.lengthBuckets)
        .filter(([_, count]) => count > 0);
      if (entries.length > 0) {
        const bucketCounts = new Map(entries);
        const buckets = entries.map(([bucket]) => bucket);
        return groupLengthBuckets(buckets).map((group) => ({
          ...group,
          options: group.options.map((opt) => {
            const count = bucketCounts.get(opt.value);
            return {
              ...opt,
              label: count != null ? `${opt.label} (${count})` : opt.label,
            };
          }),
        }));
      }
    }
    return [];
  });

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
    const sym = this.symbol().trim().toUpperCase();
    this.store.setCatalogBuilder({ symbol: sym, type: this.type() === 'put' ? 'P' : this.type() === 'both' ? null : 'C' });
    if (sym) {
      this.store.loadContractIndex(sym);
      this.store.loadCatalogSummary(sym);
      this.store.loadUnderlyingBars(sym);
    }
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

  /** Search for available contracts using the catalog endpoint with builder + catalog filters. */
  onQueryCatalog(): void {
    this.store.setCatalogBuilder({
      symbol: this.symbol(),
      type: this.type() === 'put' ? 'P' : this.type() === 'both' ? null : 'C',
    });
    this.store.queryCatalog();
  }

  /** Select a contract from catalog results and load it. */
  onSelectCatalogContract(entry: ContractCatalogEntry): void {
    const id = entry.contractId.trim().toUpperCase();
    if (!id) return;
    this.occIdInput = id;
    this.onLoad();
  }

  /** Set contract length + bucket filter and re-query catalog. */
  onLengthChange(value: string | null): void {
    this.store.setContractLength(value);
    this.store.setCatalogFilter('contractLengthBucket', value);
    this.onQueryCatalog();
  }

  /** Whether the chart-based filter is currently active. */
  readonly chartFilterActive = computed(() =>
    this.expMin() != null || this.expMax() != null ||
    this.strikeMin() != null || this.strikeMax() != null,
  );

  /** Filter contract list to contracts within the chart's visible extents. */
  onFilterToChart(): void {
    const ext = this.chartRef()?.visibleExtents();
    if (!ext) return;
    this.expMin.set(ext.startDate);
    this.expMax.set(ext.endDate);

    // Clamp strike range to ±10% of latest underlying close.
    // SA API allows one range dimension per request — strike range is the most
    // effective narrowing filter. Expiration is exact-match only, so date
    // filtering stays client-side.
    const bars = this.store.underlyingBars();
    const lastClose = bars.length > 0 ? bars[bars.length - 1].close : null;
    let strikeLow = Math.floor(ext.priceLow);
    let strikeHigh = Math.ceil(ext.priceHigh);
    if (lastClose != null && lastClose > 0) {
      const band = lastClose * 0.1;
      strikeLow = Math.max(strikeLow, Math.floor(lastClose - band));
      strikeHigh = Math.min(strikeHigh, Math.ceil(lastClose + band));
    }
    this.strikeMin.set(strikeLow);
    this.strikeMax.set(strikeHigh);
    this.store.setCatalogFilters({
      strikeGte: strikeLow,
      strikeLte: strikeHigh,
      expirationGte: null,
      expirationLte: null,
    });
    this.onQueryCatalog();
  }

  /** Clear chart-based filter. */
  onClearChartFilter(): void {
    this.expMin.set(null);
    this.expMax.set(null);
    this.strikeMin.set(null);
    this.strikeMax.set(null);
    this.store.setCatalogFilters({
      strikeGte: null,
      strikeLte: null,
      expirationGte: null,
      expirationLte: null,
    });
  }

  /** Load more catalog results (pagination). */
  onLoadMore(): void {
    this.store.loadMoreCatalog();
  }

  /** Whether the prev/next nav buttons can be used. */
  readonly canGoPrev = computed(() => {
    const idx = this.store.currentSearchIndex();
    return idx > 0 && !this.store.loading();
  });

  readonly canGoNext = computed(() => {
    const idx = this.store.currentSearchIndex();
    const count = this.store.catalogResults().length;
    return idx >= 0 && idx < count - 1 && !this.store.loading();
  });

  onPrevContract(): void {
    this.store.navigateCatalogContract(-1);
  }

  onNextContract(): void {
    this.store.navigateCatalogContract(1);
  }
}

function compareByField(a: CatalogRow, b: CatalogRow, field: SortField): number {
  switch (field) {
    case 'type':
      return a.type.localeCompare(b.type);
    case 'strike':
      return a.strike - b.strike;
    case 'expiration':
      return a.expiration.localeCompare(b.expiration);
    case 'contractLengthDays': {
      const aVal = a.contractLengthDays ?? Infinity;
      const bVal = b.contractLengthDays ?? Infinity;
      return aVal - bVal;
    }
    case 'observationCount':
      return a.observationCount - b.observationCount;
    case 'delta': {
      const aVal = a.latestDelta ?? -Infinity;
      const bVal = b.latestDelta ?? -Infinity;
      return aVal - bVal;
    }
    default:
      return 0;
  }
}
