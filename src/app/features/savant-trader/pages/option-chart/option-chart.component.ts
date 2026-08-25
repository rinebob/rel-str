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
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

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
import type { ContractCatalogEntry, LengthBucket } from '@options-contract/contracts';

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
    MatMenuModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
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
  type = signal<'call' | 'put' | 'both'>('both');

  /** Maps the type signal to the SA catalog type param: 'C' | 'P' | null (null = both). */
  readonly catalogType = computed<'C' | 'P' | null>(() => {
    const t = this.type();
    return t === 'call' ? 'C' : t === 'put' ? 'P' : null;
  });

  /** Client-side display type filter (separate from backend query). */
  displayType = signal<'all' | 'call' | 'put'>('all');

  /** Client-side multi-select expiration filter. */
  selectedExpirations = signal<Set<string>>(new Set());

  /** Client-side multi-select length bucket filter. */
  selectedLengthBuckets = signal<Set<string>>(new Set());

  /** Backend query multi-select length buckets (comma-separated in request). */
  selectedQueryLengthBuckets = signal<Set<string>>(new Set());

  /** Backend query expiration range (from/to). */
  queryExpGte = signal<string | null>(null);
  queryExpLte = signal<string | null>(null);

  /** Date object for the Exp From datepicker (null when empty). */
  readonly queryExpGteDate = computed(() => this.queryExpGte() ? new Date(this.queryExpGte()! + 'T00:00:00') : null);
  readonly queryExpLteDate = computed(() => this.queryExpLte() ? new Date(this.queryExpLte()! + 'T00:00:00') : null);

  onExpGteChange(date: Date | null): void {
    this.queryExpGte.set(date ? date.toISOString().split('T')[0] : null);
  }
  onExpLteChange(date: Date | null): void {
    this.queryExpLte.set(date ? date.toISOString().split('T')[0] : null);
  }

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

  /** Sorted rows filtered by all client-side display filters. */
  readonly displayedRows = computed<CatalogRow[]>(() => {
    const rows = this.sortedCatalogRows();
    const min = this.strikeMin();
    const max = this.strikeMax();
    const expMin = this.expMin();
    const expMax = this.expMax();
    const dType = this.displayType();
    const expSet = this.selectedExpirations();
    const lenSet = this.selectedLengthBuckets();
    if (min == null && max == null && !expMin && !expMax && dType === 'all' && expSet.size === 0 && lenSet.size === 0) return rows;
    return rows.filter((r) => {
      if (dType !== 'all' && r.type !== dType) return false;
      if (expSet.size > 0 && !expSet.has(r.expiration)) return false;
      if (lenSet.size > 0 && !lenSet.has(r.contractLengthBucket)) return false;
      if (min != null && r.strike < min) return false;
      if (max != null && r.strike > max) return false;
      if (expMin && r.expiration < expMin) return false;
      if (expMax && r.expiration > expMax) return false;
      return true;
    });
  });

  /** Rows with alternating shade index based on the primary sort column's group value. */
  readonly displayedRowsWithShade = computed<{ row: CatalogRow; shade: 0 | 1 }[]>(() => {
    const rows = this.displayedRows();
    const primaryField = this.sortLevels()[0]?.field ?? 'expiration';
    let lastKey: string | null = null;
    let shade: 0 | 1 = 0;
    return rows.map((row) => {
      const key = String(
        primaryField === 'delta' ? row.latestDelta
        : primaryField === 'contractLengthDays' ? row.contractLengthDays
        : primaryField === 'type' ? row.type
        : primaryField === 'strike' ? row.strike
        : primaryField === 'expiration' ? row.expiration
        : primaryField === 'observationCount' ? row.observationCount
        : ''
      );
      if (key !== lastKey) {
        shade = shade === 0 ? 1 : 0;
        lastKey = key;
      }
      return { row, shade };
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

  /** Expiration options derived from loaded catalog results, sorted with counts. */
  readonly chartExpirationOptions = computed(() => {
    const rows = this.catalogRows();
    const expMap = new Map<string, number>();
    for (const row of rows) {
      expMap.set(row.expiration, (expMap.get(row.expiration) ?? 0) + 1);
    }
    return Array.from(expMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([exp, count]) => ({
        value: exp,
        label: this.formatExpWithDow(exp),
        count,
      }));
  });

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
    this.store.setCatalogBuilder({ symbol: value, type: this.catalogType() });
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
      const buckets = (summary.lengthBuckets as LengthBucket[])
        .filter((b) => b.count > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      if (buckets.length > 0) {
        const bucketCounts = new Map(buckets.map((b) => [b.label, b.count]));
        const labels = buckets.map((b) => b.label);
        return groupLengthBuckets(labels).map((group) => ({
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

  /** Flat list of available length buckets for the display filter dropdown. */
  readonly availableLengthBuckets = computed(() => {
    const summary = this.store.catalogSummary();
    if (!summary?.lengthBuckets) return [];
    return (summary.lengthBuckets as LengthBucket[])
      .filter((b) => b.count > 0)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((b) => ({ value: b.label, label: getLengthLabel(b.label), count: b.count }));
  });

  /** Available length buckets grouped into Short/Medium/Long for quick toggle. */
  readonly availableLengthGroups = computed(() => {
    const buckets = this.availableLengthBuckets();
    if (buckets.length === 0) return [];
    return groupLengthBuckets(buckets.map((b) => b.value)).map((group) => ({
      name: group.name,
      options: group.options.map((opt) => {
        const bucket = buckets.find((b) => b.value === opt.value);
        return { ...opt, count: bucket?.count ?? 0 };
      }),
    }));
  });

  /** Label for the expiration display filter button. */
  readonly expFilterLabel = computed(() => {
    const count = this.selectedExpirations().size;
    return count === 0 ? 'Exp' : `Exp (${count})`;
  });

  /** Label for the length display filter button. */
  readonly lenFilterLabel = computed(() => {
    const count = this.selectedLengthBuckets().size;
    return count === 0 ? 'Len' : `Len (${count})`;
  });

  /** Label for the backend query length multi-select button. */
  readonly queryLenLabel = computed(() => {
    const count = this.selectedQueryLengthBuckets().size;
    return count === 0 ? 'Length' : `Length (${count})`;
  });

  /** Total contract count for the current query. When all pages are loaded, this
   *  is the exact total. When more pages remain, it's the count from the first page
   *  (which may be page-level, not true total). */
  readonly catalogTotal = computed(() => {
    if (!this.store.catalogPageToken()) {
      return this.catalogRows().length;
    }
    return Math.max(this.catalogRows().length, this.store.catalogCount());
  });

  /** Whether more pages are available to load. */
  readonly hasMorePages = computed(() => !!this.store.catalogPageToken());

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
    const sym = this.symbol().trim().toUpperCase();
    this.store.setCatalogBuilder({ symbol: sym, type: this.catalogType() });
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
    const lenBuckets = this.selectedQueryLengthBuckets();
    this.store.setCatalogFilter('contractLengthBucket', lenBuckets.size > 0 ? Array.from(lenBuckets).join(',') : null);
    this.store.setCatalogFilters({
      expirationGte: this.queryExpGte(),
      expirationLte: this.queryExpLte(),
    });
    this.store.setCatalogBuilder({
      symbol: this.symbol(),
      type: this.catalogType(),
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

  /** Toggle a length bucket in the backend query multi-select. */
  toggleQueryLengthBucket(value: string): void {
    const set = new Set(this.selectedQueryLengthBuckets());
    if (set.has(value)) set.delete(value);
    else set.add(value);
    this.selectedQueryLengthBuckets.set(set);
  }

  /** Toggle all buckets in a length group for the backend query. */
  toggleQueryLengthGroup(groupName: string): void {
    const group = this.availableLengthGroups().find((g) => g.name === groupName);
    if (!group) return;
    const set = new Set(this.selectedQueryLengthBuckets());
    const allSelected = group.options.every((opt) => set.has(opt.value));
    if (allSelected) {
      group.options.forEach((opt) => set.delete(opt.value));
    } else {
      group.options.forEach((opt) => set.add(opt.value));
    }
    this.selectedQueryLengthBuckets.set(set);
  }

  /** Clear the backend query length bucket selection. */
  clearQueryLengthBuckets(): void {
    this.selectedQueryLengthBuckets.set(new Set());
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

    // SA allows one range dimension per request. Expiration range is used as
    // the server-side filter because it narrows the result set more effectively
    // than strike range (expiration dates are sparse, strikes are dense).
    // Strike filtering stays client-side on returned results.
    this.strikeMin.set(Math.floor(ext.priceLow));
    this.strikeMax.set(Math.ceil(ext.priceHigh));
    this.store.setCatalogFilters({
      strikeGte: null,
      strikeLte: null,
      expirationGte: ext.startDate,
      expirationLte: ext.endDate,
    });
    this.store.setCatalogBuilder({ symbol: this.symbol(), type: this.catalogType() });
    this.store.queryCatalog(true);
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

  /** Auto-paginate through all remaining catalog results. */
  onLoadAll(): void {
    this.store.loadAllCatalog();
  }

  /** Toggle an expiration in the client-side multi-select set. */
  toggleExpiration(value: string): void {
    const set = new Set(this.selectedExpirations());
    if (set.has(value)) set.delete(value);
    else set.add(value);
    this.selectedExpirations.set(set);
  }

  /** Toggle a length bucket in the client-side multi-select set. */
  toggleLengthBucket(value: string): void {
    const set = new Set(this.selectedLengthBuckets());
    if (set.has(value)) set.delete(value);
    else set.add(value);
    this.selectedLengthBuckets.set(set);
  }

  /** Toggle all buckets in a length group (Short/Medium/Long) at once. */
  toggleLengthGroup(groupName: string): void {
    const group = this.availableLengthGroups().find((g) => g.name === groupName);
    if (!group) return;
    const set = new Set(this.selectedLengthBuckets());
    const allSelected = group.options.every((opt) => set.has(opt.value));
    if (allSelected) {
      group.options.forEach((opt) => set.delete(opt.value));
    } else {
      group.options.forEach((opt) => set.add(opt.value));
    }
    this.selectedLengthBuckets.set(set);
  }

  /** Clear all client-side display filters. */
  onClearAllDisplayFilters(): void {
    this.displayType.set('all');
    this.clearSelectedExpirations();
    this.clearSelectedLengthBuckets();
    this.strikeMin.set(null);
    this.strikeMax.set(null);
  }

  /** Clear the expiration multi-select set. */
  clearSelectedExpirations(): void {
    this.selectedExpirations.set(new Set());
  }

  /** Clear the length bucket multi-select set. */
  clearSelectedLengthBuckets(): void {
    this.selectedLengthBuckets.set(new Set());
  }

  /** Whether any display filter is active. */
  readonly displayFilterActive = computed(() =>
    this.displayType() !== 'all' ||
    this.selectedExpirations().size > 0 ||
    this.selectedLengthBuckets().size > 0 ||
    this.strikeMin() != null ||
    this.strikeMax() != null,
  );

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
