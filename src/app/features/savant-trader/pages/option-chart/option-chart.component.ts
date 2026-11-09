/**
 * Option Chart Page
 *
 * Options contract viewer dashboard. Input an OCC contract ID, fetch the
 * historical time-series, and plot it on a dedicated chart with underlying
 * price overlay, Greeks, and volume/OI panes.
 *
 * Composition root only — coordination lives in the page-scoped services
 * (`option-chart-*.service.ts`); the members below are view state
 * (plotted/chips projection, panel toggles) plus thin aliases that keep
 * the template and spec surface unchanged. The facade deliberately
 * mirrors the full pre-refactor public surface — a few aliases (e.g.
 * builtOccId, the builder dropdown signals) are currently unbound
 * because the slimmed template doesn't reference them; they're kept so
 * the surface is verbatim, not because they carry load today.
 */
import { Component, inject, computed, viewChild, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DsDialogService } from '../../../../shared/ds/ds-dialog';

import { OptionsContractViewerStore } from '../../stores/options-contract-viewer.store';
import {
  OptionsContractChartComponent,
  type PlottedChartContract,
} from '../../components/options-contract-chart/options-contract-chart.component';
import { plottedSeriesColor, UNDERLYING_COLOR } from '../../components/options-contract-chart/options-contract-chart-series.builder';
import type { RejectedReason } from '../../utils/plotted-pairs.util';
import type { PlottedContract } from '../../stores/plotted-contracts-feature';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { padDateLabels, unionLabels } from '../../utils/chart-series.utils';
import { OptionType, parseOccContractId, type ParsedOccContractId } from '@options-contract/contracts';
import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import { OptionGroupGeneratorComponent } from '../../components/option-group-generator/option-group-generator.component';
import type { StudyRange } from '../../utils/option-group-generator.utils';
import type { ContractCatalogEntry } from '@options-contract/contracts';
import { ContractListSessionStore } from '../../stores/contract-list-session.store';
import type { OptionsContractListUi } from '../../backtest/common/options-replay.types';
import type { OptionsReplayRunUi } from '../../backtest/common/options-replay.types';
import { OptionChartPageService } from './option-chart-page.service';
import { OptionChartCatalogService, type SortField } from './option-chart-catalog.service';
import { OptionChartLoadService } from './option-chart-load.service';
import { OptionChartListService } from './option-chart-list.service';
import { OptionChartReplayService } from './option-chart-replay.service';
import { OptionChartGeneratorService } from './option-chart-generator.service';
import { OPTION_CHART_PAGE_PROVIDERS } from './option-chart-page.providers';

@Component({
  selector: 'app-option-chart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    OptionsContractChartComponent,
    OptionGroupGeneratorComponent],
  // Page-scoped — one generator instance + one list session + one set of
  // coordination units shared by this page, its drawer, and dialogs it
  // opens; dies with the page, never root-provided.
  providers: OPTION_CHART_PAGE_PROVIDERS,
  templateUrl: './option-chart.component.html',
  styleUrl: './option-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'closeMenus()' },
})
export class OptionChartComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionsContractViewerStore);
  readonly genStore = inject(OptionGroupGeneratorStore);
  readonly listStore = inject(ContractListSessionStore);
  readonly uiStateService = inject(UiStateService);
  private readonly dialog = inject(DsDialogService);
  private readonly page = inject(OptionChartPageService);
  private readonly catalog = inject(OptionChartCatalogService);
  private readonly load = inject(OptionChartLoadService);
  private readonly list = inject(OptionChartListService);
  private readonly replay = inject(OptionChartReplayService);
  private readonly gen = inject(OptionChartGeneratorService);
  readonly chartRef = viewChild(OptionsContractChartComponent);

  constructor() {
    // The catalog's filter-to-chart reads the chart's visible window —
    // the viewChild lives here, the query lives there.
    this.page.chartExtents = () => this.chartRef()?.visibleExtents() ?? null;
  }

  /** Whether the left control panel is open. */
  controlPanelOpen = true;

  // ── Page context (option-chart-page.service.ts) ─────────────────────

  readonly symbol = this.page.symbol;
  readonly type = this.page.type;
  readonly catalogType = this.page.catalogType;
  get occIdInput(): string { return this.page.occIdInput; }
  set occIdInput(v: string) { this.page.occIdInput = v; }
  readonly listError = this.page.listError;
  readonly onSymbolChange = (value: string): void => this.page.onSymbolChange(value);

  // ── Catalog table (option-chart-catalog.service.ts) ─────────────────

  readonly expiration = this.catalog.expiration;
  readonly strike = this.catalog.strike;
  readonly contractLength = this.catalog.contractLength;
  readonly displayType = this.catalog.displayType;
  readonly selectedExpirations = this.catalog.selectedExpirations;
  readonly selectedLengthBuckets = this.catalog.selectedLengthBuckets;
  readonly selectedQueryLengthBuckets = this.catalog.selectedQueryLengthBuckets;
  readonly openMenu = this.catalog.openMenu;
  readonly queryExpGte = this.catalog.queryExpGte;
  readonly queryExpLte = this.catalog.queryExpLte;
  readonly builtOccId = this.catalog.builtOccId;
  readonly canSearch = this.catalog.canSearch;
  readonly catalogRows = this.catalog.catalogRows;
  readonly sortLevels = this.catalog.sortLevels;
  readonly sortedCatalogRows = this.catalog.sortedCatalogRows;
  readonly strikeMin = this.catalog.strikeMin;
  readonly strikeMax = this.catalog.strikeMax;
  readonly expMin = this.catalog.expMin;
  readonly expMax = this.catalog.expMax;
  readonly displayedRows = this.catalog.displayedRows;
  readonly displayedRowsWithShade = this.catalog.displayedRowsWithShade;
  readonly expirationOptions = this.catalog.expirationOptions;
  readonly chartExpirationOptions = this.catalog.chartExpirationOptions;
  readonly lengthLabel = this.catalog.lengthLabel;
  readonly lengthGroups = this.catalog.lengthGroups;
  readonly availableLengthBuckets = this.catalog.availableLengthBuckets;
  readonly availableLengthGroups = this.catalog.availableLengthGroups;
  readonly expFilterLabel = this.catalog.expFilterLabel;
  readonly lenFilterLabel = this.catalog.lenFilterLabel;
  readonly queryLenLabel = this.catalog.queryLenLabel;
  readonly catalogTotal = this.catalog.catalogTotal;
  readonly hasMorePages = this.catalog.hasMorePages;
  readonly chartFilterActive = this.catalog.chartFilterActive;
  readonly displayFilterActive = this.catalog.displayFilterActive;
  readonly canGoPrev = this.catalog.canGoPrev;
  readonly canGoNext = this.catalog.canGoNext;

  readonly onExpGteChange = (v: string): void => this.catalog.onExpGteChange(v);
  readonly onExpLteChange = (v: string): void => this.catalog.onExpLteChange(v);
  readonly onBuildChange = (): void => this.catalog.onBuildChange();
  readonly getSortInfo = (field: SortField) => this.catalog.getSortInfo(field);
  readonly onColumnSort = (field: SortField): void => this.catalog.onColumnSort(field);
  readonly onQueryCatalog = (): void => this.catalog.onQueryCatalog();
  readonly onSelectCatalogContract = (e: ContractCatalogEntry): void => this.catalog.onSelectCatalogContract(e);
  readonly onLengthChange = (v: string | null): void => this.catalog.onLengthChange(v);
  readonly toggleMenu = (key: 'queryLen' | 'exp' | 'len', event: Event): void => this.catalog.toggleMenu(key, event);
  readonly closeMenus = (): void => this.catalog.closeMenus();
  readonly toggleQueryLengthBucket = (v: string): void => this.catalog.toggleQueryLengthBucket(v);
  readonly toggleQueryLengthGroup = (name: string): void => this.catalog.toggleQueryLengthGroup(name);
  readonly clearQueryLengthBuckets = (): void => this.catalog.clearQueryLengthBuckets();
  readonly onFilterToChart = (): void => this.catalog.onFilterToChart();
  readonly onClearChartFilter = (): void => this.catalog.onClearChartFilter();
  readonly onLoadMore = (): void => this.catalog.onLoadMore();
  readonly onLoadAll = (): void => this.catalog.onLoadAll();
  readonly toggleExpiration = (v: string): void => this.catalog.toggleExpiration(v);
  readonly toggleLengthBucket = (v: string): void => this.catalog.toggleLengthBucket(v);
  readonly toggleLengthGroup = (name: string): void => this.catalog.toggleLengthGroup(name);
  readonly onClearAllDisplayFilters = (): void => this.catalog.onClearAllDisplayFilters();
  readonly clearSelectedExpirations = (): void => this.catalog.clearSelectedExpirations();
  readonly clearSelectedLengthBuckets = (): void => this.catalog.clearSelectedLengthBuckets();
  readonly onPrevContract = (): void => this.catalog.onPrevContract();
  readonly onNextContract = (): void => this.catalog.onNextContract();

  // ── Chart emit plumbing (option-chart-load.service.ts) ──────────────

  readonly rejectedEntries = this.load.rejectedEntries;
  readonly onLoad = (sentLines?: string): Promise<void> => this.load.onLoad(sentLines);
  readonly rejectionReasonLabel = (reason: RejectedReason): string => this.load.rejectionReasonLabel(reason);

  // ── Contract-list wiring (option-chart-list.service.ts) ─────────────

  readonly listErrorText = this.list.listErrorText;
  readonly emitSessionLines = this.list.emitSessionLines;
  readonly onContractListDocId = (docId: string): Promise<void> => this.list.onContractListDocId(docId);
  readonly onContractListDoc = (doc: OptionsContractListUi): void => this.list.onContractListDoc(doc);
  readonly openListChooser = (): void => this.list.openListChooser();
  readonly openListPicker = (): void => this.list.openListPicker();
  /** Picker handoff — same emit path as the generator send. */
  readonly onListSend = (lines: string[]): void => this.load.emitLinesToChart(lines);

  // ── Replay selector (option-chart-replay.service.ts) ────────────────

  readonly replayRuns = this.replay.replayRuns;
  get selectedReplayRunId(): string | null { return this.replay.selectedReplayRunId; }
  set selectedReplayRunId(v: string | null) { this.replay.selectedReplayRunId = v; }
  readonly replayLoading = this.replay.replayLoading;
  readonly replayError = this.replay.replayError;
  readonly replayLabel = (run: OptionsReplayRunUi): string => this.replay.replayLabel(run);
  readonly onReplaySelected = (runId: string): Promise<void> => this.replay.onReplaySelected(runId);

  // ── Generator drawer (option-chart-generator.service.ts) ────────────

  get generatorOpen(): boolean { return this.gen.generatorOpen; }
  set generatorOpen(v: boolean) { this.gen.generatorOpen = v; }
  readonly brushArmed = this.gen.brushArmed;
  readonly onStudyRange = (range: StudyRange | null): void => this.gen.onStudyRange(range);
  readonly clearStudyRange = (): void => this.gen.clearStudyRange();
  readonly onGeneratorSend = (lines: string[]): void => this.gen.onGeneratorSend(lines);

  // ── Lifecycle ───────────────────────────────────────────────────────

  ngOnInit(): void {
    this.page.initSession();
    this.replay.bindRuns();
    this.list.bindDeepLink();
  }

  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
    // DsDialogService is root-scoped — overlays outlive the route. A
    // picker left open over the next page would keep its `onSend`
    // callback alive against this destroyed component (and the root
    // viewer store); every dialog open at destroy is page-owned.
    this.dialog.closeAll();
  }

  // ── View state: plotted/chips projection ────────────────────────────

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
}
