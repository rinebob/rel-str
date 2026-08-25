/**
 * @topic #77 — Spread Time Series Viewer (opened 2026-08-02)
 *
 * Material dialog component for constructing spreads.
 * Config-driven spread type forms with auto-assigned directions and debit/credit badge.
 */
import { Component, inject, computed, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatAutocompleteModule } from '@angular/material/autocomplete';

import { SpreadViewerStore } from '../../stores/spread-viewer.store';
import { OptionsContractService } from '../../services/options-contract.service';
import { SaveListDialogComponent } from '../save-list-dialog/save-list-dialog.component';
import { groupLengthBuckets } from '../../utils/contract-length.utils';
import { OptionType } from '@options/common';
import {
  SpreadType,
  DebitOrCredit,
  type Spread,
  type SpreadDefinition,
  type SpreadLeg,
} from '@spread/contracts';
import type { ContractCatalogEntry, QueryContractCatalogRequest } from '@options-contract/contracts';

interface SpreadTypeConfig {
  type: SpreadType;
  legCount: number;
  optionTypeConstraint: 'single' | 'both' | 'none';
  expirationConstraint: 'same' | 'none';
  strikeConstraint: 'distinct' | 'same' | 'distinct_ordered' | 'none';
  autoAssignSides: boolean;
  strikeDistanceApplies: boolean;
}

const SPREAD_CONFIGS: Record<SpreadType, SpreadTypeConfig> = {
  [SpreadType.VERTICAL]: {
    type: SpreadType.VERTICAL,
    legCount: 2,
    optionTypeConstraint: 'single',
    expirationConstraint: 'same',
    strikeConstraint: 'distinct',
    autoAssignSides: true,
    strikeDistanceApplies: true,
  },
  [SpreadType.STRADDLE]: {
    type: SpreadType.STRADDLE,
    legCount: 2,
    optionTypeConstraint: 'both',
    expirationConstraint: 'same',
    strikeConstraint: 'same',
    autoAssignSides: true,
    strikeDistanceApplies: false,
  },
  [SpreadType.STRANGLE]: {
    type: SpreadType.STRANGLE,
    legCount: 2,
    optionTypeConstraint: 'both',
    expirationConstraint: 'same',
    strikeConstraint: 'distinct_ordered',
    autoAssignSides: true,
    strikeDistanceApplies: true,
  },
  [SpreadType.IRON_CONDOR]: {
    type: SpreadType.IRON_CONDOR,
    legCount: 4,
    optionTypeConstraint: 'both',
    expirationConstraint: 'same',
    strikeConstraint: 'distinct_ordered',
    autoAssignSides: true,
    strikeDistanceApplies: true,
  },
  [SpreadType.CUSTOM]: {
    type: SpreadType.CUSTOM,
    legCount: 0,
    optionTypeConstraint: 'none',
    expirationConstraint: 'none',
    strikeConstraint: 'none',
    autoAssignSides: false,
    strikeDistanceApplies: false,
  },
};

@Component({
  selector: 'app-spread-builder-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatIconModule,
    MatChipsModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatMenuModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatAutocompleteModule,
  ],
  templateUrl: './spread-builder-dialog.component.html',
  styleUrl: './spread-builder-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpreadBuilderDialogComponent {
  readonly store = inject(SpreadViewerStore);
  readonly optionsContractService = inject(OptionsContractService);
  readonly dialogRef = inject(MatDialogRef<SpreadBuilderDialogComponent>);
  private readonly dialog = inject(MatDialog);

  readonly spreadTypes = [
    { value: SpreadType.VERTICAL, label: 'Vertical' },
    { value: SpreadType.STRADDLE, label: 'Straddle' },
    { value: SpreadType.STRANGLE, label: 'Strangle' },
    { value: SpreadType.IRON_CONDOR, label: 'Iron Condor' },
    { value: SpreadType.CUSTOM, label: 'Custom' },
  ];

  selectedType = signal<SpreadType>(SpreadType.VERTICAL);
  selectedOptionType = signal<OptionType>(OptionType.CALL);
  selectedExpiration = signal<string | null>(null);
  selectedStrikes = signal<(number | null)[]>([null, null]);
  strikeDistance = signal<number | null>(null);
  startDate = signal<string | null>(null);
  endDate = signal<string | null>(null);

  // Custom mode legs
  customLegs = signal<SpreadLeg[]>([]);

  // Length bucket options — all known buckets, grouped Short/Medium/Long
  readonly selectedLengthBucketValues = computed(() => Array.from(this.store.selectedLengthBuckets()));
  readonly lengthBucketGroups = computed(() => groupLengthBuckets([
    '1d', '3d', '5d', '7d', '14d', '21d',
    '1mo', '1.5mo', '2mo', '3mo', '4mo',
    '6mo', '9mo', '1yr', '2yr', '3yr',
  ]));

  // Catalog picker state
  catalogLoading = signal(false);
  catalogError = signal<string | null>(null);
  catalogResults = signal<ContractCatalogEntry[]>([]);
  catalogColumns = ['type', 'strike', 'expiration', 'contractLengthBucket', 'firstObserved', 'observationCount'];

  // Built-spreads table helpers
  formatLegs(spread: Spread): string {
    return spread.legs.map((leg) => `${leg.optionType[0].toUpperCase()} ${leg.strike}`).join(' / ');
  }

  formatDte(spread: Spread): string {
    const entry = spread.entryDate ?? '';
    const exp = spread.legs[0]?.expiration ?? '';
    if (!entry || !exp) return '-';
    const entryTime = new Date(entry).getTime();
    const expTime = new Date(exp).getTime();
    if (isNaN(entryTime) || isNaN(expTime)) return '-';
    const msPerDay = 24 * 60 * 60 * 1000;
    const dte = Math.ceil((expTime - entryTime) / msPerDay);
    return dte.toString();
  }

  formatStatus(spread: Spread): string {
    return spread.status.toUpperCase();
  }

  readonly storeSymbol = computed(() => this.store.symbol() ?? '');
  readonly contractIndex = computed(() => this.store.contractIndex());
  readonly contractIndexStatus = computed(() => this.store.contractIndexStatus());

  /** Entry date from store (synced with form and catalog clicks). */
  readonly entryDate = computed(() => this.store.entryDate());

  /** Underlying price for the selected entry date. */
  readonly underlyingPrice = computed(() => this.store.underlyingPrice());

  /** Dates that have underlying bars within the chart date range. */
  readonly availableEntryDates = computed(() => this.store.availableEntryDates());

  // Named list context
  readonly namedLists = computed(() => this.store.namedLists());
  readonly selectedListId = computed(() => this.store.selectedListId());
  readonly isDirty = computed(() => this.store.isDirty());
  readonly selectedListName = computed(() => {
    const id = this.selectedListId();
    const list = this.namedLists().find((l) => l.id === id);
    return list?.name ?? 'Unsaved';
  });

  // Working buffer table
  readonly spreads = computed(() => this.store.spreads());
  readonly displayedColumns = ['type', 'expiration', 'legs', 'entryDate', 'dte', 'debitCredit', 'status', 'actions'];


  /** Available expirations from the contract index. */
  readonly expirations = computed(() => {
    const idx = this.contractIndex();
    if (!idx) return [];
    return idx.expirations.map((e) => e.date).sort();
  });

  /** Strikes available for the selected expiration. */
  readonly availableStrikes = computed(() => {
    const idx = this.contractIndex();
    const exp = this.selectedExpiration();
    if (!idx || !exp) return [];
    const entry = idx.expirations.find((e) => e.date === exp);
    return entry ? [...entry.strikes].sort((a, b) => a - b) : [];
  });

  /** Current spread type config. */
  readonly config = computed(() => SPREAD_CONFIGS[this.selectedType()]);

  /** Whether option type selector should be shown. */
  readonly showOptionTypeSelector = computed(() => {
    const c = this.config();
    return c.optionTypeConstraint === 'single';
  });

  /** Number of strike selectors needed. */
  readonly strikeSelectorCount = computed(() => {
    const c = this.config();
    if (c.strikeConstraint === 'same') return 1;
    return c.legCount;
  });

  /** Whether the current spread type supports strike distance. */
  readonly showStrikeDistance = computed(() => this.config().strikeDistanceApplies);

  /** Whether the current spread type is Custom (manual legs). */
  readonly isCustom = computed(() => this.selectedType() === SpreadType.CUSTOM);

  /** Strike selector labels. */
  readonly strikeLabels = computed<string[]>(() => {
    const type = this.selectedType();
    switch (type) {
      case SpreadType.VERTICAL: return ['Long Strike', 'Short Strike'];
      case SpreadType.STRADDLE: return ['Strike'];
      case SpreadType.STRANGLE: return ['Put Strike', 'Call Strike'];
      case SpreadType.IRON_CONDOR: return ['Put Long', 'Put Short', 'Call Short', 'Call Long'];
      default: return [];
    }
  });

  /** Computed debit or credit based on leg arrangement. */
  readonly debitOrCredit = computed<DebitOrCredit | null>(() => {
    const legs = this.buildLegs();
    if (legs.length === 0) return null;
    return computeDebitOrCredit(legs);
  });

  /** Whether the current form is valid for adding a spread. */
  readonly canAdd = computed(() => {
    const sym = this.storeSymbol();
    const exp = this.selectedExpiration();
    if (!sym || !exp) return false;

    const type = this.selectedType();
    if (type === SpreadType.CUSTOM) {
      return this.customLegs().length >= 2;
    }

    const strikes = this.selectedStrikes();
    const count = this.strikeSelectorCount();
    for (let i = 0; i < count; i++) {
      if (strikes[i] == null) return false;
    }

    // Validate distinct strikes where required
    const c = this.config();
    if (c.strikeConstraint === 'distinct') {
      const vals = strikes.slice(0, count).filter((s) => s != null);
      const unique = new Set(vals);
      if (unique.size !== vals.length) return false;
    }
    if (c.strikeConstraint === 'distinct_ordered') {
      const vals = strikes.slice(0, count);
      for (let i = 1; i < vals.length; i++) {
        if (vals[i] != null && vals[i - 1] != null && (vals[i] as number) <= (vals[i - 1] as number)) {
          return false;
        }
      }
    }

    return true;
  });

  /** Running count of added spreads. */
  readonly addedCount = computed(() => this.store.spreads().length);

  /** Build legs from current form state. */
  buildLegs(): SpreadLeg[] {
    const type = this.selectedType();
    const exp = this.selectedExpiration();
    if (!exp) return [];

    if (type === SpreadType.CUSTOM) {
      return this.customLegs();
    }

    const strikes = this.selectedStrikes();
    const optType = this.selectedOptionType();
    const c = this.config();

    if (c.strikeConstraint === 'same') {
      // Straddle: long call + long put at same strike
      const strike = strikes[0];
      if (strike == null) return [];
      return [
        { optionType: OptionType.CALL, strike, expiration: exp, direction: 'long' },
        { optionType: OptionType.PUT, strike, expiration: exp, direction: 'long' },
      ];
    }

    if (type === SpreadType.STRANGLE) {
      const putStrike = strikes[0];
      const callStrike = strikes[1];
      if (putStrike == null || callStrike == null) return [];
      return [
        { optionType: OptionType.PUT, strike: putStrike, expiration: exp, direction: 'long' },
        { optionType: OptionType.CALL, strike: callStrike, expiration: exp, direction: 'long' },
      ];
    }

    if (type === SpreadType.IRON_CONDOR) {
      const [putLong, putShort, callShort, callLong] = strikes;
      if (putLong == null || putShort == null || callShort == null || callLong == null) return [];
      return [
        { optionType: OptionType.PUT, strike: putLong, expiration: exp, direction: 'long' },
        { optionType: OptionType.PUT, strike: putShort, expiration: exp, direction: 'short' },
        { optionType: OptionType.CALL, strike: callShort, expiration: exp, direction: 'short' },
        { optionType: OptionType.CALL, strike: callLong, expiration: exp, direction: 'long' },
      ];
    }

    // Vertical
    const [longStrike, shortStrike] = strikes;
    if (longStrike == null || shortStrike == null) return [];
    return [
      { optionType: optType, strike: longStrike, expiration: exp, direction: 'long' },
      { optionType: optType, strike: shortStrike, expiration: exp, direction: 'short' },
    ];
  }

  onTypeChange(type: SpreadType): void {
    this.selectedType.set(type);
    const count = SPREAD_CONFIGS[type].strikeConstraint === 'same' ? 1 : SPREAD_CONFIGS[type].legCount;
    this.selectedStrikes.set(new Array(count).fill(null));
    if (type === SpreadType.CUSTOM && this.customLegs().length === 0) {
      this.customLegs.set([
        { optionType: OptionType.CALL, strike: 0, expiration: '', direction: 'long' },
        { optionType: OptionType.CALL, strike: 0, expiration: '', direction: 'short' },
      ]);
    }
  }

  onExpirationChange(exp: string): void {
    this.selectedExpiration.set(exp);
    this.selectedStrikes.set(new Array(this.strikeSelectorCount()).fill(null));
  }

  onStrikeChange(index: number, value: number | null): void {
    const strikes = [...this.selectedStrikes()];
    strikes[index] = value;
    this.selectedStrikes.set(strikes);

    if (index === 0 && this.strikeDistance()) {
      this.computeStrikesFromDistance(this.strikeDistance());
    }
  }

  onStartDateChange(date: Date | null): void {
    this.startDate.set(date ? date.toISOString().split('T')[0] : null);
  }

  onEndDateChange(date: Date | null): void {
    this.endDate.set(date ? date.toISOString().split('T')[0] : null);
  }

  /** Filter for entry date picker — only allow dates with underlying bars. */
  entryDateFilter(date: Date | null): boolean {
    if (!date) return false;
    const iso = date.toISOString().split('T')[0];
    return this.availableEntryDates().includes(iso);
  }

  onEntryDateChange(date: Date | null): void {
    this.store.setEntryDate(date ? date.toISOString().split('T')[0] : null);
  }

  onStrikeDistanceChange(value: number | null): void {
    const distance = value != null && !isNaN(value) ? value : null;
    this.strikeDistance.set(distance);
    this.computeStrikesFromDistance(distance);
  }

  /** Auto-compute secondary strikes when the primary strike and distance change. */
  computeStrikesFromDistance(distance: number | null): void {
    if (distance == null || distance <= 0) return;
    const strikes = this.selectedStrikes();
    const primary = strikes[0];
    if (primary == null) return;

    const type = this.selectedType();
    switch (type) {
      case SpreadType.VERTICAL:
        this.selectedStrikes.set([primary, primary + distance]);
        break;
      case SpreadType.STRANGLE:
        this.selectedStrikes.set([primary - distance, primary + distance]);
        break;
      case SpreadType.IRON_CONDOR:
        this.selectedStrikes.set([primary - 2 * distance, primary - distance, primary + distance, primary + 2 * distance]);
        break;
    }
  }

  onAdvanceEntryDate(offset: '1d' | '1w' | '1m'): void {
    this.store.advanceEntryDate(offset);
  }

  onChartStartDateChange(date: Date | null): void {
    const start = date ? date.toISOString().split('T')[0] : null;
    this.store.setChartDateRange(start, this.store.chartDateRange().end);
  }

  onChartEndDateChange(date: Date | null): void {
    const end = date ? date.toISOString().split('T')[0] : null;
    this.store.setChartDateRange(this.store.chartDateRange().start, end);
  }

  onStrikeRangeMinChange(value: number | null): void {
    const min = value != null && !isNaN(value) ? value : null;
    this.store.setStrikeRange(min, this.store.strikeRange().max);
  }

  onStrikeRangeMaxChange(value: number | null): void {
    const max = value != null && !isNaN(value) ? value : null;
    this.store.setStrikeRange(this.store.strikeRange().min, max);
  }

  onLengthBucketsChange(values: string[]): void {
    this.store.setLengthBuckets(new Set(values));
  }

  onAddToList(): void {
    const sym = this.storeSymbol();
    const legs = this.buildLegs();
    if (!sym || legs.length === 0) return;

    const definition: SpreadDefinition = {
      spreadType: this.selectedType(),
      symbol: sym,
      legs,
      entryDate: this.store.entryDate() ?? undefined,
    };

    this.store.addSpread(definition);

    // Reset strikes but keep symbol + expiration
    this.selectedStrikes.set(new Array(this.strikeSelectorCount()).fill(null));
  }

  onLoad(): void {
    const started = this.store.loadSpreads();
    if (started) {
      this.dialogRef.close();
    }
  }

  onCancel(): void {
    if (this.isDirty()) {
      const closeAnyway = typeof window !== 'undefined' && window.confirm('You have unsaved changes. Close anyway?');
      if (!closeAnyway) return;
    }
    this.dialogRef.close();
  }

  // Named list controls
  onListSelected(listId: string): void {
    this.store.openList(listId);
  }

  onNewList(): void {
    this.promptForName().subscribe((name) => {
      if (name) this.store.createNewList(name);
    });
  }

  onSaveList(): void {
    this.store.saveCurrentList();
  }

  onSaveAsList(): void {
    this.promptForName().subscribe((name) => {
      if (name) this.store.saveAsList(name);
    });
  }

  onClearBuffer(): void {
    const confirmed = typeof window !== 'undefined' && window.confirm('Clear all spreads from the working buffer?');
    if (confirmed) this.store.clearBuffer();
  }

  onListsMenuOpen(): void {
    this.store.loadNamedLists();
  }

  /** Load a spread from the buffer into the form for editing. */
  cloneSpread(spread: Spread): void {
    this.selectedType.set(spread.spreadType);
    this.selectedExpiration.set(spread.legs[0]?.expiration ?? null);

    if (spread.spreadType === SpreadType.CUSTOM) {
      this.customLegs.set([...spread.legs]);
      this.selectedOptionType.set(OptionType.CALL);
      this.selectedStrikes.set([null, null]);
      return;
    }

    // For structured spreads, determine option type and strikes from legs
    const optionTypes = new Set(spread.legs.map((l) => l.optionType));
    const hasBoth = optionTypes.size > 1;
    if (hasBoth) {
      // Straddle, Strangle, Iron Condor — no single option type selector
      this.selectedOptionType.set(OptionType.CALL);
    } else {
      this.selectedOptionType.set([...optionTypes][0] as OptionType);
    }

    const strikes = spread.legs.map((l) => l.strike);
    this.selectedStrikes.set(strikes);

    // Set chart date range / entry date from spread if present
    this.store.setEntryDate(spread.entryDate ?? null);
  }

  /** Delete a spread from the working buffer. */
  deleteSpread(spreadId: string): void {
    this.store.deleteSpreadFromBuffer(spreadId);
  }

  /** Query the contract catalog using current filters and populate the table. */
  onSearchCatalog(): void {
    const sym = this.storeSymbol();
    if (!sym) {
      this.catalogError.set('Symbol is required');
      return;
    }

    const range = this.store.strikeRange();
    const dateRange = this.store.chartDateRange();
    const buckets = Array.from(this.store.selectedLengthBuckets());
    const type = this.mapOptionTypeToContractType(this.selectedOptionType());

    const req: QueryContractCatalogRequest = {
      symbol: sym,
      firstObservedGte: dateRange.start ?? undefined,
      firstObservedLte: dateRange.end ?? undefined,
      strikeGte: range.min ?? undefined,
      strikeLte: range.max ?? undefined,
      contractLengthBucket: buckets[0] ?? undefined,
      type,
      sortBy: 'observationCount',
      sortOrder: 'desc',
      pageSize: 100,
    };

    this.catalogLoading.set(true);
    this.catalogError.set(null);
    this.catalogResults.set([]);

    this.optionsContractService.queryContractCatalog$(req).subscribe({
      next: (data) => {
        const sorted = (data.contracts ?? []).slice().sort((a, b) =>
          (a.firstObserved ?? '').localeCompare(b.firstObserved ?? ''),
        );
        this.catalogResults.set(sorted);
        this.catalogLoading.set(false);
      },
      error: (err: Error) => {
        this.catalogError.set(err?.message ?? 'Failed to query catalog');
        this.catalogLoading.set(false);
      },
    });
  }

  /** Populate form fields when a catalog row is clicked. */
  onCatalogRowClick(entry: ContractCatalogEntry): void {
    this.selectedExpiration.set(entry.expiration);
    this.selectedOptionType.set(entry.type as OptionType);

    if (this.selectedType() === SpreadType.STRADDLE) {
      this.selectedStrikes.set([entry.strike]);
    } else {
      // For other types, set the first strike and let the user fill the rest
      const current = [...this.selectedStrikes()];
      current[0] = entry.strike;
      this.selectedStrikes.set(current);
    }

    this.store.setEntryDate(entry.firstObserved);

    if (this.strikeDistance()) {
      this.computeStrikesFromDistance(this.strikeDistance());
    }
  }

  mapOptionTypeToContractType(optionType: OptionType): 'C' | 'P' | undefined {
    if (optionType === OptionType.CALL) return 'C';
    if (optionType === OptionType.PUT) return 'P';
    return undefined;
  }

  formatFirstObserved(date: string): string {
    return date;
  }

  private promptForName() {
    return this.dialog.open(SaveListDialogComponent, {
      width: '360px',
      maxWidth: '90vw',
    }).afterClosed();
  }

  // Custom leg management
  addCustomLeg(): void {
    this.customLegs.update((legs) => [
      ...legs,
      { optionType: OptionType.CALL, strike: 0, expiration: this.selectedExpiration() ?? '', direction: 'long' },
    ]);
  }

  removeCustomLeg(index: number): void {
    this.customLegs.update((legs) => legs.filter((_, i) => i !== index));
  }

  updateCustomLeg(index: number, field: keyof SpreadLeg, value: string | number): void {
    this.customLegs.update((legs) =>
      legs.map((leg, i) => (i === index ? { ...leg, [field]: value } : leg)),
    );
  }
}

/** Compute debit or credit from leg arrangement. */
function computeDebitOrCredit(legs: SpreadLeg[]): DebitOrCredit {
  // Simplified: if more longs than shorts (by premium), it's a debit
  // For structured spreads, the logic is:
  // - Vertical: long lower strike call = debit, short lower strike call = credit
  // - Straddle/Strangle: all long = debit
  // - Iron Condor: credit structure
  const longs = legs.filter((l) => l.direction === 'long').length;
  const shorts = legs.filter((l) => l.direction === 'short').length;

  if (longs > 0 && shorts === 0) return DebitOrCredit.DEBIT;
  if (shorts > longs) return DebitOrCredit.CREDIT;

  // For verticals and iron condors, check if it's a net debit or credit
  // by comparing strike distances (simplified heuristic)
  if (legs.length === 4) return DebitOrCredit.CREDIT; // Iron condor is always credit

  // Vertical: compare strikes
  if (legs.length === 2 && legs[0].optionType === legs[1].optionType) {
    const longLeg = legs.find((l) => l.direction === 'long');
    const shortLeg = legs.find((l) => l.direction === 'short');
    if (longLeg && shortLeg) {
      if (longLeg.optionType === OptionType.CALL) {
        return longLeg.strike < shortLeg.strike ? DebitOrCredit.DEBIT : DebitOrCredit.CREDIT;
      } else {
        return longLeg.strike > shortLeg.strike ? DebitOrCredit.DEBIT : DebitOrCredit.CREDIT;
      }
    }
  }

  return DebitOrCredit.DEBIT;
}
