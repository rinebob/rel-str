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
import type { CatalogSortBy } from '../../stores/contract-catalog-feature';

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

  occIdInput = '';

  /** Whether the left control panel is open. */
  controlPanelOpen = true;

  // Builder fields (signals so computed/derived state reacts)
  symbol = signal('QQQ');
  readonly expiration = this.store.selectedExpiration;
  type = signal<'call' | 'put'>('call');
  readonly strike = this.store.selectedStrike;
  readonly contractLength = this.store.contractLength;


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
    return !this.store.catalogLoading()
      && this.symbol().trim().length > 0;
  });

  /** Length-bucket filter buttons from summary (only buckets with count > 0). */
  readonly lengthBucketButtons = computed(() => {
    const summary = this.store.catalogSummary();
    if (!summary?.lengthBuckets) return [];
    return Object.entries(summary.lengthBuckets)
      .filter(([_, count]) => count > 0)
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket));
  });

  /** Parsed catalog results with numeric latest values for display. */
  readonly catalogRows = computed<CatalogRow[]>(() =>
    this.store.catalogResults().map(toCatalogRow),
  );

  /** Whether delta range filter is active (disables IV + minObs filters). */
  readonly deltaFilterActive = computed(() => {
    const f = this.store.catalogFilters();
    return f.deltaGte != null || f.deltaLte != null;
  });

  /** Whether IV range filter is active (disables delta + minObs filters). */
  readonly ivFilterActive = computed(() => {
    const f = this.store.catalogFilters();
    return f.ivGte != null || f.ivLte != null;
  });

  /** Whether minObs filter is active (disables delta + IV filters). */
  readonly minObsFilterActive = computed(() => this.store.catalogFilters().minObservationCount != null);

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
    }
  }

  /** Label for the selected contract length. */
  readonly lengthLabel = computed(() => {
    const length = this.contractLength();
    return length ? getLengthLabel(length) : '';
  });

  /** Length options grouped for the dropdown. Uses catalog summary when available. */
  readonly lengthGroups = computed<LengthGroup[]>(() => {
    const summary = this.store.catalogSummary();
    if (summary?.lengthBuckets) {
      const buckets = Object.entries(summary.lengthBuckets)
        .filter(([_, count]) => count > 0)
        .map(([bucket]) => bucket);
      if (buckets.length > 0) {
        return groupLengthBuckets(buckets);
      }
    }
    return [];
  });

  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
    const sym = this.symbol().trim().toUpperCase();
    this.store.setCatalogBuilder({ symbol: sym, type: this.type() === 'call' ? 'C' : 'P' });
    if (sym) {
      this.store.loadContractIndex(sym);
      this.store.loadCatalogSummary(sym);
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
      type: this.type() === 'call' ? 'C' : 'P',
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

  /** Toggle length-bucket filter and re-query. */
  onLengthBucketClick(bucket: string | null): void {
    this.store.setCatalogFilter('contractLengthBucket', bucket);
    this.onQueryCatalog();
  }

  /** Change sort field, toggling order if same field. */
  onSortChange(field: CatalogSortBy): void {
    const filters = this.store.catalogFilters();
    if (filters.sortBy === field) {
      this.store.setCatalogFilters({
        sortOrder: filters.sortOrder === 'asc' ? 'desc' : 'asc',
      });
    } else {
      this.store.setCatalogFilters({ sortBy: field, sortOrder: 'asc' });
    }
    this.onQueryCatalog();
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
