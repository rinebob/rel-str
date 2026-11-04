/**
 * Option Chart Page
 *
 * Options contract viewer dashboard. Input an OCC contract ID, fetch the
 * historical time-series, and plot it on a dedicated chart with underlying
 * price overlay, Greeks, and volume/OI panes.
 */
import { Component, inject, computed, signal, viewChild, OnInit, OnDestroy, DestroyRef, Injector, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, distinctUntilChanged, map, take } from 'rxjs';
import { DsDialogService } from '../../../../shared/ds/ds-dialog';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';


import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import {
  OptionsContractChartComponent,
  type PlottedChartContract,
} from '../../components/options-contract-chart/options-contract-chart.component';
import { plottedSeriesColor, UNDERLYING_COLOR } from '../../components/options-contract-chart/options-contract-chart-series.builder';
import {
  parsePlottedEntries,
  type RejectedEntry,
  type RejectedReason,
} from '../../utils/plotted-pairs.util';
import type { PlottedContract } from '../../stores/plotted-contracts-feature';
import { ConfirmDialogComponent } from '../option-chain-pct-change/components/confirm-dialog.component';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { formatUtcDate } from '../../utils/utils';
import { padDateLabels, unionLabels } from '../../utils/chart-series.utils';
import {
  groupLengthBuckets,
  getLengthLabel,
  toCatalogRow,
  type CatalogRow,
  type LengthGroup,
} from '../../utils/contract-length.utils';
import type { ContractCatalogEntry, LengthBucket } from '@options-contract/contracts';
import { OptionType, parseOccContractId, type ParsedOccContractId } from '@options-contract/contracts';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { OptionGroupGeneratorComponent } from '../../components/option-group-generator/option-group-generator.component';
import type { StudyRange } from '../../utils/option-group-generator.utils';
import { OptionsReplayRunsService } from '../../backtest/services/options-replay-runs.service';
import type { OptionsReplayRunUi } from '../../backtest/common/options-replay.types';
import type { ContractListPickRow } from '@options-replay/contracts';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import { ContractListService } from '../../services/contract-list.service';
import { ContractListChooserComponent } from '../../components/contract-list-chooser/contract-list-chooser.component';
import { ContractListPickerComponent } from '../../components/contract-list-picker/contract-list-picker.component';

/** Pasting more than this many contracts asks for confirmation first — the
 *  chart stays usable but the fetch batch and line count get unwieldy. */
const LARGE_LIST_WARN_THRESHOLD = 50;

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
    MatIconModule,
    MatSidenavModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSelectModule,
    OptionsContractChartComponent,
    OptionGroupGeneratorComponent],
  // Page-scoped — one generator instance + one list session shared by
  // this page, its drawer, and dialogs it opens; dies with the page,
  // never root-provided.
  providers: [OptionGroupGeneratorStore, ContractListSessionStore],
  templateUrl: './option-chart.component.html',
  styleUrl: './option-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeMenus()' },
})
export class OptionChartComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionsContractViewerStore);
  readonly genStore = inject(OptionGroupGeneratorStore);
  readonly uiStateService = inject(UiStateService);
  private readonly dialog = inject(DsDialogService);
  private readonly replayService = inject(OptionsReplayRunsService);
  readonly listStore = inject(ContractListSessionStore);
  private readonly listService = inject(ContractListService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  /** Dialogs resolving page-scoped stores (the list session) must open on
   *  this element injector — without it DsDialogService uses the root injector. */
  private readonly injector = inject(Injector);
  readonly chartRef = viewChild(OptionsContractChartComponent);

  occIdInput = '';

  /** Tokens rejected by the last pair-list parse, shown as a notice. */
  readonly rejectedEntries = signal<RejectedEntry[]>([]);

  /** Whether the left control panel is open. */
  controlPanelOpen = true;

  /** Whether the right group-generator drawer is open. */
  generatorOpen = false;

  /** Arms the study-range brush on the contract chart; Esc disarms. */
  readonly brushArmed = signal(false);

  /** Selection-replay dropdown state — pick a run, plot its default slice. */
  readonly replayRuns = signal<OptionsReplayRunUi[]>([]);
  selectedReplayRunId: string | null = null;
  readonly replayLoading = signal(false);
  readonly replayError = signal<string | null>(null);

  /** Contract-list session errors (?list= / chooser) — named, never silent. */
  readonly listError = signal<string | null>(null);

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

  /** ds-menu dropdowns — one open at a time, closed by document click. */
  readonly openMenu = signal<'queryLen' | 'exp' | 'len' | null>(null);

  /** Backend query expiration range (from/to). */
  queryExpGte = signal<string | null>(null);
  queryExpLte = signal<string | null>(null);

  onExpGteChange(value: string): void {
    this.queryExpGte.set(value || null);
  }
  onExpLteChange(value: string): void {
    this.queryExpLte.set(value || null);
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

  /** Short legend/chip label like "600C 2026-01-16". */
  private plottedLabel(parsed: ParsedOccContractId | null, fallback = 'Mark'): string {
    if (!parsed) return fallback;
    const t = parsed.optionType === OptionType.CALL ? 'C' : 'P';
    return `${parsed.strike}${t} ${parsed.expiration}`;
  }

  /** The chart shows the whole plotted set only when nothing is focused and
   *  at least one non-error contract remains — the one predicate behind both
   *  the series projection and the axis-label pick below. Loading contracts
   *  count toward the set so the pane layout doesn't flicker mid-fetch. */
  readonly showPlottedSet = computed(() =>
    this.store.chartFocusContractId() == null &&
    this.store.plottedList().some((c) => c.status !== 'error'),
  );

  /** Chart input — the plotted set, or the focused contract wrapped as a
   *  1-element array for the single-contract view (chip drill-down and any
   *  plain contract load set the store's focus flag). */
  readonly plottedChartSeries = computed<PlottedChartContract[]>(() => {
    if (this.showPlottedSet()) {
      const rendered = this.store.renderedSeries();
      return this.store.plottedList()
        .filter((c) => c.status !== 'error')
        .map((c) => ({
          contractId: c.entry.contractId,
          label: this.plottedLabel(c.parsed, c.entry.contractId),
          strike: c.parsed.strike,
          expiration: c.parsed.expiration,
          openDate: c.entry.openDate,
          markerDates: c.entry.markerDates ?? [],
          points: rendered[c.entry.contractId] ?? [],
        }));
    }

    const data = this.store.contractData();
    if (!data) return [];
    const parsed = this.store.parsedOccId();
    // A focused contract keeps its plotted openDate so the span marker is
    // identical between set view and drill-down.
    const focusedId = this.store.chartFocusContractId();
    const focusedEntry = focusedId != null
      ? this.store.plottedContracts()[focusedId]?.entry
      : null;
    const openDate = focusedEntry?.openDate ?? null;
    // The display-window clip applies here too — a focused contract with an
    // entry date clips the same way it does in the set.
    const raw = this.store.observations();
    const points = this.store.displayWindow() === 'position' && openDate
      ? raw.filter((p) => p.date >= openDate)
      : raw;
    return [
      {
        contractId: parsed?.contractID ?? data.contractID,
        label: this.plottedLabel(parsed, data.contractID),
        strike: parsed?.strike ?? Number(data.strike),
        expiration: parsed?.expiration ?? data.expiration,
        openDate,
        // A focused contract keeps every pick day — the drill-down marker is
        // identical to the set view's (dots at each selection date).
        markerDates: focusedEntry?.markerDates ?? [],
        points,
      },
    ];
  });

  /** Whether any displayed contract has an entry date — gates the
   *  Clip-to-entry button (the clip is a no-op without one). */
  readonly hasEntryDates = computed(() =>
    this.plottedChartSeries().some((c) => c.openDate != null),
  );

  /** Category axis — rendered dates only; the chart unions in the marker
   *  endpoints itself. The set view uses the store's union across contracts
   *  extended by chartPadDays (the +Nd buttons pad the label domain — same
   *  mechanism padObservations uses for the single-contract axis), the
   *  single/focused view unions the loaded contract's already-padded dates
   *  with the underlying context window so a plotted contract's drill-down
   *  keeps the pick-day prefix. Bare loads have no window — no union. */
  readonly chartAxisLabels = computed<string[]>(() =>
    this.showPlottedSet()
      ? padDateLabels(this.store.allDates(), this.store.chartPadDays())
      : unionLabels(this.store.xLabels(), this.store.underlyingWindowDates()),
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
    this.store.setCatalogBuilder({ symbol: value, type: this.catalogType() });
    // The generator + list session keep per-symbol state — swap both blobs.
    this.genStore.setSymbol(value);
    this.listStore.setSymbol(value);
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
    const sym = this.symbol().trim().toUpperCase();
    this.store.setCatalogBuilder({ symbol: sym, type: this.catalogType() });
    this.genStore.setSymbol(sym);
    this.listStore.setSymbol(sym);
    if (sym) {
      this.store.loadContractIndex(sym);
      this.store.loadCatalogSummary(sym);
      this.store.loadUnderlyingBars(sym);
    }
    this.replayService.watchRuns(20).pipe(take(1)).subscribe({
      next: (runs) => this.replayRuns.set(runs.filter((r) => r.status === 'completed')),
      error: () => this.replayError.set('Could not load replay runs'),
    });
    // `?list={docId}` deep-link — distinctUntilChanged on the param so
    // unrelated query emissions can't retrigger a load (option-chain
    // pattern); an absent param never fires.
    this.route.queryParamMap
      .pipe(
        map((params) => params.get('list')?.trim() ?? ''),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((docId) => {
        if (docId) void this.onContractListDocId(docId);
      });
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  /** Chips strip — mirrors the chart: every plotted contract in set view, or
   *  just the focused contract while it owns the pane. A focused contract
   *  outside the set (catalog row / single-id load) synthesizes a chip from
   *  the loaded contractData so the strip never advertises contracts that
   *  aren't on screen — hover-dim only makes sense against displayed lines. */
  readonly chipContracts = computed<PlottedContract[]>(() => {
    const focused = this.store.chartFocusContractId();
    if (focused == null) return this.store.plottedList();
    const inSet = this.store.plottedContracts()[focused];
    if (inSet) return [inSet];
    const parsed = parseOccContractId(focused);
    if (!parsed) return [];
    const data = this.store.contractData();
    // contractData clears at load intent and only fills on success — its
    // presence marks the focused contract's own fetch as resolved.
    return [{ entry: { contractId: focused, openDate: null }, parsed, status: data ? 'loaded' : 'loading', data, error: null }];
  });

  /** Chip swatch index — position among non-error DISPLAYED contracts, which
   *  is what the chart's series palette indexes over (a focused contract is
   *  always series 0 of its single-series render). */
  readonly chipColorIndex = computed(() => {
    const map = new Map<string, number>();
    this.chipContracts()
      .filter((c) => c.status !== 'error')
      .forEach((c, i) => map.set(c.entry.contractId, i));
    return map;
  });

  /** Chip swatch color — same palette entry as its chart series (errored
   *  contracts have no series and fall back to the first palette color). */
  chipColor(contract: PlottedContract): string {
    return plottedSeriesColor(this.chipColorIndex().get(contract.entry.contractId) ?? 0);
  }

  /** Underlying chip swatch — same literal the builder paints the overlay. */
  readonly underlyingColor = UNDERLYING_COLOR;

  /** Chip text — readable strike/type/expiry, same rule as the series label. */
  chipLabel(contract: PlottedContract): string {
    return this.plottedLabel(contract.parsed, contract.entry.contractId);
  }

  /** Chip hover/click emphasizes its line in the set view — visual only,
   *  no refetch, every plotted series stays on the chart. Pointer leave or
   *  focus loss clears the emphasis. Error chips have no line to light. */
  onChipEnter(contract: PlottedContract): void {
    if (contract.status !== 'error') {
      this.store.setHoveredContract(contract.entry.contractId);
    }
  }

  onChipLeave(): void {
    this.store.setHoveredContract(null);
  }

  onChipRemove(contract: PlottedContract): void {
    this.store.removePlotted(contract.entry.contractId);
  }

  rejectionReasonLabel(reason: RejectedReason): string {
    switch (reason) {
      case 'invalid-contract':
        return 'not a valid contract ID';
      case 'invalid-date':
        return 'invalid date (use YYYY-MM-DD)';
      case 'wrong-underlying':
        return `not a ${(this.symbol() || '').trim().toUpperCase()} contract`;
    }
  }

  /** Load dispatch: a single bare OCC ID keeps the existing single-contract
   *  view; anything else — dated pairs or a multi-line list — goes through
   *  the plotted-set path. Rejected tokens are surfaced, valid entries still
   *  load. */
  async onLoad(): Promise<void> {
    const text = this.occIdInput;
    // Re-entrancy guard: a second click while the >50 confirm is open would
    // stack another dialog and spawn a concurrent batch.
    if (!text.trim() || this.dialog.openDialogs.length) return;

    const { entries, rejected } = parsePlottedEntries(text, this.symbol());
    this.rejectedEntries.set(rejected);
    if (entries.length === 0) return;

    if (entries.length === 1 && entries[0].openDate === null && rejected.length === 0) {
      this.store.loadContract(entries[0].contractId, this.store.contractLength());
      return;
    }

    if (entries.length > LARGE_LIST_WARN_THRESHOLD) {
      const ok = await firstValueFrom(
        this.dialog
          .open(ConfirmDialogComponent, {
            data: {
              message: `This will load ${entries.length} option contracts — the chart may be slow and hard to read. Load all ${entries.length}?`,
              confirmLabel: 'Load',
              cancelLabel: 'Cancel',
            },
          })
          .afterClosed(),
      );
      if (!ok) return;
    }

    await this.store.loadPlotted(entries);
  }

  /** Drawer handoff — emitted pair lines go through the same textarea +
   *  loadPlotted path as a paste, so replace semantics stay identical. */
  onGeneratorSend(lines: string[]): void {
    this.emitLinesToChart(lines);
  }

  /** Picker handoff — same emit path as the generator send. */
  onListSend(lines: string[]): void {
    this.emitLinesToChart(lines);
  }

  private emitLinesToChart(lines: string[]): void {
    this.occIdInput = lines.join('\n');
    void this.onLoad();
  }

  /** `?list=` / chooser entry — read the doc for its symbol (cross-symbol
   *  lists switch the page first), load the session, open the picker.
   *  Missing/failed docs name their error; the chart is never touched. */
  async onContractListDocId(docId: string): Promise<void> {
    this.listError.set(null);
    let doc;
    try {
      doc = await firstValueFrom(this.listService.getList$(docId));
    } catch {
      this.listError.set(`Contract list "${docId}" failed to load`);
      return;
    }
    if (!doc) {
      this.listError.set(`Contract list "${docId}" not found`);
      return;
    }
    const sym = doc.symbol.trim().toUpperCase();
    if (sym && sym !== this.symbol().trim().toUpperCase()) {
      this.onSymbolChange(sym);
    }
    // The doc is already in hand — loadListDoc skips a second read.
    this.listStore.loadListDoc(doc);
    if (this.listStore.status() === 'ready') {
      this.openListPicker();
    } else if (this.listStore.status() === 'error') {
      this.listError.set(this.listStore.error());
    }
  }

  /** "Contract lists…" button — recent-doc chooser; a selection runs the
   *  same handler as `?list=`. */
  openListChooser(): void {
    this.dialog
      .open(ContractListChooserComponent, {
        width: '560px',
        injector: this.injector,
        data: { symbol: this.symbol() },
      })
      .afterClosed()
      .subscribe((listId?: string) => {
        if (listId) void this.onContractListDocId(listId);
      });
  }

  /** Session → picker dialog — returns emitted lines on Send. */
  private openListPicker(): void {
    this.dialog
      .open(ContractListPickerComponent, {
        width: '85vw',
        maxWidth: '85vw',
        height: '85vh',
        injector: this.injector,
      })
      .afterClosed()
      .subscribe((lines?: string[]) => {
        if (lines?.length) this.onListSend(lines);
      });
  }

  /** Chart brush (#1340) → generator alive-range bound. Declared now so the
   *  page route exists when the brush emission lands. */
  onStudyRange(range: StudyRange | null): void {
    this.genStore.applyRange(range);
  }

  /** Header-button × — clears the alive-range bound (chart band + drawer
   *  row go away, persisted blob updates) and disarms the brush. */
  clearStudyRange(): void {
    this.brushArmed.set(false);
    this.genStore.applyRange(null);
  }

  /** Dropdown label — template + window + symbols covered. */
  replayLabel(run: OptionsReplayRunUi): string {
    return `${run.templateId} · ${run.startDate} · ${run.symbols.join(', ')}`;
  }

  /** Replay pick → default slice = first 10 Wednesday pick rows of the
   *  current symbol's list, emitted as `date,id` lines through the same
   *  loadPlotted path as a paste. The filter/paging dialog is a later
   *  step — this just plots. */
  async onReplaySelected(runId: string): Promise<void> {
    this.replayLoading.set(true);
    this.replayError.set(null);
    try {
      const lists = await firstValueFrom(
        this.replayService.watchContractLists(runId).pipe(take(1)),
      );
      const sym = this.symbol().trim().toUpperCase();
      const list = lists.find((l) => l.symbol === sym && l.status === 'success');
      if (!list) {
        this.replayError.set(`No ${sym} contract list in this run`);
        return;
      }
      const picks = list.rows
        .filter((r): r is ContractListPickRow => r.kind === 'pick')
        .filter((r) => new Date(`${r.entryDate}T00:00:00Z`).getUTCDay() === 3)
        .slice(0, 10);
      if (picks.length === 0) {
        this.replayError.set('No Wednesday picks in this list');
        return;
      }
      this.occIdInput = picks.map((r) => `${r.entryDate},${r.contractId}`).join('\n');
      await this.onLoad();
    } finally {
      this.replayLoading.set(false);
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
    void this.onLoad();
  }

  /** Set contract length + bucket filter and re-query catalog. */
  onLengthChange(value: string | null): void {
    this.store.setContractLength(value);
    this.store.setCatalogFilter('contractLengthBucket', value);
    this.onQueryCatalog();
  }

  /** ds-menu dropdown — toggle open state (one menu at a time). */
  toggleMenu(key: 'queryLen' | 'exp' | 'len', event: Event): void {
    event.stopPropagation();
    this.openMenu.update((k) => (k === key ? null : key));
  }

  /** Close any open ds-menu — wired to document click on the host. */
  closeMenus(): void {
    this.openMenu.set(null);
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
