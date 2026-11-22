/**
 * @topic #1098 — RH Scanner | @task #1197, #1199, #1305, #1306
 *
 * Scanner recipe table — one dumb per-recipe table for the auto-run
 * overview (#1183). Renders the raw PreviewScanResult: header line
 * (title · blurb · N of M · sorted_by · ran-at · per-table refresh
 * button) and every wire field as a column — tracked badge, row-actions
 * (triage-list menu, #1306), triage-list chip, Symbol, instrument_id,
 * instrument_type, the recipe's declared columns, then any undeclared
 * keys the response actually returned (e.g. 'Name').
 *
 * Sort is the option-chart click-cycle chain (scanner-sort.util): click
 * adds a level ascending → desc → removes; headers carry numbered
 * priority badges. Sorting runs on RAW cell values (pre-% formatting).
 *
 * Error entries render nothing — the page silently skips failed recipes
 * (PRD). The component owns no calls; refresh just emits.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';


import type { ScannerRecipe } from '../../scanner/scanner-recipes';
import type { RecipeRunState } from '../../stores/scanner.store';
import type { SymbolListDef } from '../../common/symbol-list-defs';
import {
  appliedFilterSummary,
  displayCell,
  normScanSymbol,
  normSymbolSet,
  scanRunRows,
  scanSortCell,
  type ScanRow,
  type ScannerSymbolFilter,
} from '../../utils/scanner-rows.util';
import {
  nextSortLevels,
  numericCell,
  seedSortLevels,
  sortInfo,
  sortRows,
  type SortLevel,
} from '../../utils/scanner-sort.util';

/** Fixed leading sortable columns — wire row fields, before the dynamic
 *  recipe/extra columns. `key` is the sortLevels key, `label` the header.
 *  'tracked' isn't a wire field — it sorts the membership badge. */
const FIXED_COLUMNS = [
  { key: 'tracked', label: 'Tracked' },
  { key: 'symbol', label: 'Symbol' },
  { key: 'instrument_id', label: 'instrument_id' },
  { key: 'instrument_type', label: 'instrument_type' },
] as const;

/** Wire column keys that collide with a fixed column must never render
 *  as an extra — the default 'Symbol' wire column would otherwise
 *  duplicate `td.symbol`, and a colliding name would sort the wrong
 *  data (cellFor resolves fixed keys before the column map). Compared
 *  case-insensitively since wire keys are capitalized. */
const FIXED_KEYS: ReadonlySet<string> = new Set(FIXED_COLUMNS.map((f) => f.key));

@Component({
  selector: 'app-scanner-recipe-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scanner-recipe-table.component.html',
  styleUrl: './scanner-recipe-table.component.scss',
  host: {
    // dse-menu convention — a click anywhere else dismisses the row menu.
    '(document:click)': 'listMenuFor.set(null)',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerRecipeTableComponent {
  readonly recipe = input.required<ScannerRecipe>();
  readonly run = input.required<RecipeRunState>();
  /** Tracked-symbol universe — membership drives the row badge. */
  readonly tracked = input<ReadonlySet<string>>(new Set());
  /** Page-level All/New/Tracked filter (#1305) — filters rows before
   *  sort; the seed (recipe sort) is unchanged. */
  readonly symbolFilter = input<ScannerSymbolFilter>('all');
  /** Exclusive triage defs in catalog order — the row menu's options
   *  (#1306). MONITOR/user lists never arrive: the page scopes the input
   *  to `byRole().exclusive`. */
  readonly listDefs = input<readonly SymbolListDef[]>([]);
  /** normSymbol → exclusive list key — the row chip's single source
   *  (#1306). Computed on the page so rows never hit the store. */
  readonly listMembership = input<ReadonlyMap<string, string>>(new Map());
  /** Catalog still streaming — the row menu's empty state chooses copy
   *  off this ('Loading lists…' vs 'No lists available'). */
  readonly listsLoading = input(false);
  readonly refresh = output<void>();
  /** Row menu pick — {symbol, listKey}; the page routes to
   *  `toggleSymbolInList` (a re-pick of the current key un-assigns —
   *  that decision is the store's, not the menu's). */
  readonly listPick = output<{ symbol: string; listKey: string }>();

  protected readonly fixedColumns = FIXED_COLUMNS;

  /** Seeded from the recipe's declared sort — the catalog's "best first"
   *  contract (e.g. gainers % Change desc) holds until the user clicks.
   *  Shared seed (scanner-sort.util) so the rail's top tickers can't
   *  drift from this initial order. */
  protected readonly sortLevels = linkedSignal<SortLevel[]>(() =>
    seedSortLevels(this.recipe()),
  );

  /** Parsed + first-wins-deduped + symbol-filtered rows and the
   *  presence-verified display_name → wire-key map — one pass via the
   *  shared pipeline (scanner-rows.util scanRunRows) so the page rail's
   *  baseline sort resolves identically. The lookup merges over the
   *  unfiltered wire set; rows carry the page filter (#1305). */
  private readonly prepared = computed(() =>
    scanRunRows(this.recipe(), this.run().result, {
      symbolFilter: this.symbolFilter(),
      trackedNorm: this.trackedNorm(),
    }),
  );

  protected readonly rows = computed<ScanRow[]>(() => this.prepared().rows);
  protected readonly lookup = computed<ReadonlyMap<string, string>>(
    () => this.prepared().lookup,
  );

  /** Dynamic columns: recipe-declared names in declared order (visible
   *  only, honoring `order` when set), then undeclared wire keys the
   *  rows actually carry, first-seen. Suppression runs over ALL declared
   *  columns — a hidden one (`visible:false` still computes on the wire)
   *  must not re-render as a trailing extra, and a declared name's
   *  canonical target key is suppressed so 'Return on equity' never
   *  double-renders next to 'ROE'. */
  protected readonly tableColumns = computed<string[]>(() => {
    const all = this.recipe().columns;
    const declared = all
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.visible !== false)
      .sort((a, b) => (a.c.order ?? a.i) - (b.c.order ?? b.i))
      .map(({ c }) => c.display_name);
    const seen = new Set(all.map((c) => c.display_name));
    const resolved = new Set(all.map((c) => this.lookup().get(c.display_name) ?? c.display_name));
    const extras: string[] = [];
    for (const r of this.rows()) {
      for (const k of Object.keys(r.values)) {
        if (FIXED_KEYS.has(k.toLowerCase())) continue;
        if (!seen.has(k) && !resolved.has(k)) {
          seen.add(k);
          extras.push(k);
        }
      }
    }
    return [...declared, ...extras];
  });

  /** Dynamic columns whose every non-blank raw value parses numeric —
   *  drives the `num` (right-align) class so text extras like 'Name'
   *  don't get a numeric column's alignment. */
  protected readonly numericCols = computed<ReadonlySet<string>>(() => {
    const numeric = new Set<string>();
    for (const c of this.tableColumns()) {
      let sawValue = false;
      const allNumeric = this.rows().every((r) => {
        const v = this.cellFor(r, c);
        if (v === '' || v === null || v === undefined) return true;
        sawValue = true;
        return numericCell(v) !== null;
      });
      if (sawValue && allNumeric) numeric.add(c);
    }
    return numeric;
  });

  /** Compact `filters_applied` echo — delegates to the canonical wire
   *  reader (scanner-rows.util), which owns the applied-filter shape. */
  protected readonly filterSummary = computed<string>(() =>
    appliedFilterSummary(this.run().result?.filters_applied),
  );

  /** Header count tooltip — qualifies 'first N of M' the same way the
   *  rail count does: under a page filter, N is the hits matching the
   *  filter ON THE RETURNED PAGE, so 'first 45 of 900' never reads as
   *  "45 new hits exist among 900". */
  protected readonly headCountTitle = computed<string | null>(() => {
    const r = this.run().result;
    if (!r) return null;
    const capped = r.results.length < r.total_items;
    const capNote =
      'preview_scan returns a capped page — these are the first rows under the scan sort';
    const filter = this.symbolFilter();
    if (filter === 'all') return capped ? capNote : null;
    const filtered = `${this.rows().length} of ${r.total_items} scan hits match the ${filter} filter on the returned page`;
    return capped ? `${filtered} — ${capNote}` : filtered;
  });

  protected readonly sortedRows = computed<ScanRow[]>(() =>
    sortRows(this.rows(), this.sortLevels(), (r, k) => this.cellFor(r, k)),
  );

  protected onHeaderClick(key: string): void {
    this.sortLevels.set(nextSortLevels(this.sortLevels(), key));
  }

  protected badgeFor(key: string): { priority: number; direction: 'asc' | 'desc' } | null {
    return sortInfo(this.sortLevels(), key);
  }

  /** Tracked set normalized to the shared key policy — membership must
   *  not depend on the caller pre-normalizing. */
  private readonly trackedNorm = computed<ReadonlySet<string>>(() =>
    normSymbolSet(this.tracked()),
  );

  protected isTracked(row: ScanRow): boolean {
    return this.trackedNorm().has(normScanSymbol(row.symbol));
  }

  /** Row whose list menu is open — one at a time per table; the
   *  document-click host binding clears it on any outside click. */
  /** Row with an open list menu — resets whenever `rows` re-emits so a
   *  silent refresh (auto-refresh or a pick-driven catalog echo changing
   *  sort order) can't strand or resurrect a menu on a stale row. */
  protected readonly listMenuFor = linkedSignal<ScanRow[], string | null>({
    source: this.rows,
    computation: () => null,
  });

  /** The row's exclusive list key from the page-computed map — the
   *  chip's text AND the menu's checkmark both read this so a row
   *  never disagrees with itself. */
  protected listKeyFor(row: ScanRow): string | null {
    return this.listMembership().get(normScanSymbol(row.symbol)) ?? null;
  }

  protected toggleListMenu(event: MouseEvent, row: ScanRow): void {
    event.stopPropagation(); // keep the document-click closer quiet
    this.listMenuFor.update((cur) => (cur === row.symbol ? null : row.symbol));
  }

  protected pickList(row: ScanRow, listKey: string): void {
    this.listMenuFor.set(null);
    // Emit the canonical spelling — the store's inList/moveToList
    // comparisons key on the same normalized form.
    this.listPick.emit({ symbol: normScanSymbol(row.symbol), listKey });
  }

  /** Raw sortable value for a key — shared resolver (scanner-rows.util)
   *  so the page's rail baseline sort orders identically. */
  private cellFor(row: ScanRow, key: string): unknown {
    return scanSortCell(row, key, this.lookup(), this.isTracked(row));
  }

  protected cellValue(row: ScanRow, name: string): string {
    return displayCell(row, name, this.lookup(), this.recipe().percentColumns);
  }
}
