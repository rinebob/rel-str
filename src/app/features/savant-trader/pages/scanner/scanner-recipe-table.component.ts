/**
 * @topic #1098 — RH Scanner | @task #1197, #1199
 *
 * Scanner recipe table — one dumb per-recipe table for the auto-run
 * overview (#1183). Renders the raw PreviewScanResult: header line
 * (title · blurb · N of M · sorted_by · ran-at · per-table refresh
 * button) and every wire field as a column — tracked badge, Symbol,
 * instrument_id, instrument_type, the recipe's declared columns, then
 * any undeclared keys the response actually returned (e.g. 'Name').
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
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import type { ScannerRecipe } from '../../scanner/scanner-recipes';
import type { RecipeRunState } from '../../stores/scanner.store';
import {
  appliedFilterSummary,
  displayCell,
  normScanSymbol,
  scanRunRows,
  scanSortCell,
  type ScanRow,
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
  imports: [CommonModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './scanner-recipe-table.component.html',
  styleUrl: './scanner-recipe-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerRecipeTableComponent {
  readonly recipe = input.required<ScannerRecipe>();
  readonly run = input.required<RecipeRunState>();
  /** Tracked-symbol universe — membership drives the row badge. */
  readonly tracked = input<ReadonlySet<string>>(new Set());
  readonly refresh = output<void>();

  protected readonly fixedColumns = FIXED_COLUMNS;

  /** Seeded from the recipe's declared sort — the catalog's "best first"
   *  contract (e.g. gainers % Change desc) holds until the user clicks.
   *  Shared seed (scanner-sort.util) so the rail's top tickers can't
   *  drift from this initial order. */
  protected readonly sortLevels = linkedSignal<SortLevel[]>(() =>
    seedSortLevels(this.recipe()),
  );

  /** Parsed + first-wins-deduped rows + the presence-verified
   *  display_name → wire-key map — one pass via the shared pipeline
   *  (scanner-rows.util scanRunRows) so the page rail's baseline sort
   *  resolves identically. */
  private readonly prepared = computed(() =>
    scanRunRows(this.recipe(), this.run().result),
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
  private readonly trackedNorm = computed<ReadonlySet<string>>(
    () => new Set(Array.from(this.tracked()).map(normScanSymbol)),
  );

  protected isTracked(row: ScanRow): boolean {
    return this.trackedNorm().has(normScanSymbol(row.symbol));
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
