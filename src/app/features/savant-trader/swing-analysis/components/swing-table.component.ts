/**
 * SwingTableComponent — sortable, filterable table of ZigZag swings.
 *
 * Columns: #, Direction, Start Date, End Date, Duration, Magnitude %,
 * Magnitude $, Start Price, End Price, Volume.
 * The last row (projected swing, `confirmed: false`) has distinct styling.
 * Pure signal-based sorting and filtering — no external library.
 *
 * Dual mode: when `smallSwings` is non-null the table renders a nested
 * tree — large swings are parent rows, small swings are children assigned
 * to the parent active at their start (see `buildTreeSwings`). Parents
 * expand/collapse individually; an expand-all/collapse-all button appears
 * when any parent has children. Small swings outside every parent's range
 * render as orphan top-level rows. Sorting applies to top-level rows;
 * children stay chronological. Filters apply to top-level rows — a
 * filtered-out parent hides its children with it.
 *
 * Note: `input()` signals are not recognized in this repo's Jest setup
 * (jest-preset-angular). Inputs use `@Input()` decorators mirrored into
 * private signals via `OnChanges` so `computed()` reactivity works.
 *
 * File-size note: this file exceeds the ~400-line guideline because it
 * hosts two table presentations (flat + nested tree) sharing one filter,
 * sort, and cell-render pipeline. Splitting tree rows into a second
 * component would force duplicating that shared pipeline; the shared
 * `#swingCells` template keeps the actual markup single-sourced.
 */
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, Input, OnChanges, signal, SimpleChanges } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';
import { buildTreeSwings, type TreeSwingRow } from './swing-tree.utils';

type SortKey =
  | 'index'
  | 'direction'
  | 'startDate'
  | 'endDate'
  | 'duration'
  | 'magnitudePercent'
  | 'magnitudeAbsolute'
  | 'startPrice'
  | 'endPrice'
  | 'volume';

type DirectionFilter = 'all' | 'up' | 'down';

type ViewSwing = Swing & { _index: number };

/** A top-level tree row with display bookkeeping. */
type ViewTreeRow = TreeSwingRow & {
  /** Position in the chronological merged list — used for 'index' sort,
   *  row tracking, and as the collapse-state key (unique per row even
   *  when two swings share a start.time). */
  _order: number;
  /** Display index: 1..N among large swings, or among orphans. */
  _index: number;
};

@Component({
  selector: 'app-swing-table',
  standalone: true,
  imports: [NgTemplateOutlet, MatIconModule, MatProgressSpinnerModule],
  template: `
<div class="swing-table-section">
  @if (isLoading()) {
    <div class="swing-table-loading" aria-live="polite">
      <mat-progress-spinner diameter="24" mode="indeterminate" />
      <span>Loading swings…</span>
    </div>
  } @else if (errorMessage(); as err) {
    <div class="swing-table-error" aria-live="polite">
      <mat-icon aria-hidden="true">error</mat-icon>
      <span>{{ err }}</span>
    </div>
  } @else if (hasSwings()) {
    <div class="swing-table-filters">
      @if (isTreeMode() && hasExpandableRows()) {
        <button
          type="button"
          class="expand-collapse-all"
          data-testid="expand-collapse-all"
          (click)="onToggleAll()"
        >
          {{ allCollapsed() ? 'Expand All' : 'Collapse All' }}
        </button>
      }
      <label class="filter">
        Direction
        <select (change)="onDirectionFilter($event)">
          <option value="all" selected>All</option>
          <option value="up">Up</option>
          <option value="down">Down</option>
        </select>
      </label>
      <label class="filter">
        Date From
        <input type="date" (change)="onDateFrom($event)" />
      </label>
      <label class="filter">
        Date To
        <input type="date" (change)="onDateTo($event)" />
      </label>
      <label class="filter">
        Duration Min
        <input type="number" min="0" (input)="onDurationMin($event)" />
      </label>
      <label class="filter">
        Duration Max
        <input type="number" min="0" (input)="onDurationMax($event)" />
      </label>
      <label class="filter">
        Magnitude $ Min
        <input type="number" min="0" step="0.01" (input)="onMagnitudeMin($event)" />
      </label>
      <label class="filter">
        Magnitude $ Max
        <input type="number" min="0" step="0.01" (input)="onMagnitudeMax($event)" />
      </label>
    </div>

    <ng-template #swingCells let-s>
      <td>
        <span class="direction-badge" [class.up]="s.direction === 'up'" [class.down]="s.direction === 'down'">
          {{ s.direction === 'up' ? '▲' : '▼' }} {{ s.direction }}
        </span>
      </td>
      <td>{{ formatDate(s.start.time) }}</td>
      <td>{{ formatDate(s.end.time) }}</td>
      <td>{{ s.duration }}</td>
      <td [class.positive]="s.magnitudePercent >= 0" [class.negative]="s.magnitudePercent < 0">
        {{ formatMagnitudePercent(s.magnitudePercent) }}
      </td>
      <td>{{ formatMagnitudeAbsolute(s.magnitudeAbsolute) }}</td>
      <td>{{ formatPrice(s.start.price) }}</td>
      <td>{{ formatPrice(s.end.price) }}</td>
      <td>{{ formatVolume(s.volume) }}</td>
    </ng-template>

    <table class="swing-table">
      <thead>
        <tr>
          @if (isTreeMode()) {
            <th class="expander-col" aria-label="expand"></th>
          }
          <th class="sortable" (click)="onSort('index')"># @if (sortIcon('index')) { <mat-icon>{{ sortIcon('index') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('direction')">Direction @if (sortIcon('direction')) { <mat-icon>{{ sortIcon('direction') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('startDate')">Start Date @if (sortIcon('startDate')) { <mat-icon>{{ sortIcon('startDate') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('endDate')">End Date @if (sortIcon('endDate')) { <mat-icon>{{ sortIcon('endDate') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('duration')">Duration @if (sortIcon('duration')) { <mat-icon>{{ sortIcon('duration') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('magnitudePercent')">Magnitude % @if (sortIcon('magnitudePercent')) { <mat-icon>{{ sortIcon('magnitudePercent') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('magnitudeAbsolute')">Magnitude $ @if (sortIcon('magnitudeAbsolute')) { <mat-icon>{{ sortIcon('magnitudeAbsolute') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('startPrice')">Start Price @if (sortIcon('startPrice')) { <mat-icon>{{ sortIcon('startPrice') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('endPrice')">End Price @if (sortIcon('endPrice')) { <mat-icon>{{ sortIcon('endPrice') }}</mat-icon> }</th>
          <th class="sortable" (click)="onSort('volume')">Volume @if (sortIcon('volume')) { <mat-icon>{{ sortIcon('volume') }}</mat-icon> }</th>
        </tr>
      </thead>
      <tbody>
        @if (isTreeMode()) {
          @for (row of viewTreeRows(); track row._order) {
            <tr
              class="parent-row"
              [class.orphan-row]="row.isOrphan"
              [class.projected]="!row.confirmed"
            >
              <td class="expander-cell">
                @if (row.children.length > 0) {
                  <button
                    type="button"
                    class="expander-btn"
                    [attr.data-testid]="'expander-' + row._order"
                    [attr.aria-expanded]="!isCollapsed(row)"
                    (click)="toggleRow(row)"
                  >
                    <mat-icon>{{ isCollapsed(row) ? 'chevron_right' : 'expand_more' }}</mat-icon>
                  </button>
                }
              </td>
              <td>{{ row.isOrphan ? 'S' + row._index : row._index }}</td>
              <ng-container *ngTemplateOutlet="swingCells; context: { $implicit: row }" />
            </tr>
            @if (row.children.length > 0 && !isCollapsed(row)) {
              @for (child of row.children; track $index; let ci = $index) {
                <tr class="child-row" [class.projected]="!child.confirmed">
                  <td class="expander-cell"></td>
                  <td class="child-index">{{ row._index }}.{{ ci + 1 }}</td>
                  <ng-container *ngTemplateOutlet="swingCells; context: { $implicit: child }" />
                </tr>
              }
            }
          }
        } @else {
          @for (swing of viewSwings(); track swing._index) {
            <tr [class.projected]="!swing.confirmed">
              <td>{{ swing._index }}</td>
              <ng-container *ngTemplateOutlet="swingCells; context: { $implicit: swing }" />
            </tr>
          }
        }
      </tbody>
    </table>
  } @else if (hasData()) {
    <div class="swing-table-empty" aria-live="polite">
      <mat-icon aria-hidden="true">filter_alt_off</mat-icon>
      <span>No swings match the current filters</span>
    </div>
  } @else {
    <div class="swing-table-empty" aria-live="polite">
      <mat-icon aria-hidden="true">show_chart</mat-icon>
      <span>No swings — enter a symbol to compute pivots</span>
    </div>
  }
</div>
  `,
  styles: [`
    :host { display: block; }
    .swing-table-section { display: flex; flex-direction: column; gap: 12px; }
    .swing-table-filters { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 0; align-items: flex-end; }
    .swing-table-filters .filter { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--mat-sys-on-surface-variant); text-transform: uppercase; }
    .swing-table-filters select, .swing-table-filters input { font-size: 13px; padding: 4px 8px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 4px; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); }
    .expand-collapse-all { font-size: 12px; padding: 4px 10px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 4px; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); cursor: pointer; }
    .expand-collapse-all:hover { background: var(--mat-sys-surface-container); }
    .swing-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .swing-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); color: var(--mat-sys-on-surface-variant); font-weight: 600; white-space: nowrap; }
    .swing-table th.sortable { cursor: pointer; user-select: none; }
    .swing-table th.sortable:hover { color: var(--mat-sys-on-surface); }
    .swing-table th.sortable mat-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; }
    .swing-table th.expander-col { width: 32px; padding: 8px 4px; }
    .swing-table td { padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .swing-table td.expander-cell { width: 32px; padding: 4px; }
    .swing-table td.child-index { color: var(--mat-sys-on-surface-variant); }
    .expander-btn { display: inline-flex; align-items: center; justify-content: center; border: none; background: transparent; cursor: pointer; padding: 0; color: var(--mat-sys-on-surface-variant); }
    .expander-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .swing-table tbody tr:hover { background: var(--mat-sys-surface-container); }
    .swing-table tbody tr.projected { font-style: italic; color: var(--mat-sys-on-surface-variant); border-left: 3px dashed var(--mat-sys-outline-variant); }
    .swing-table tbody tr.child-row { background: var(--mat-sys-surface-container-low); font-size: 12px; }
    .swing-table .positive { color: var(--mat-sys-success); }
    .swing-table .negative { color: var(--mat-sys-error); }
    .swing-table .direction-badge { display: inline-flex; align-items: center; gap: 4px; font-weight: 500; }
    .swing-table .direction-badge.up { color: var(--mat-sys-success); }
    .swing-table .direction-badge.down { color: var(--mat-sys-error); }
    .swing-table-loading, .swing-table-error, .swing-table-empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 24px; color: var(--mat-sys-on-surface-variant); }
    .swing-table-loading mat-icon, .swing-table-error mat-icon, .swing-table-empty mat-icon { font-size: 24px; width: 24px; height: 24px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwingTableComponent implements OnChanges {
  @Input() swings: Swing[] = [];
  @Input() smallSwings: Swing[] | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;

  private readonly swingsSignal = signal<Swing[]>([]);
  private readonly smallSwingsSignal = signal<Swing[] | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);

  private readonly sortBy = signal<SortKey>('index');
  private readonly sortDirection = signal<'asc' | 'desc'>('asc');
  private readonly directionFilter = signal<DirectionFilter>('all');
  private readonly dateFrom = signal<string>('');
  private readonly dateTo = signal<string>('');
  private readonly durationMin = signal<number | null>(null);
  private readonly durationMax = signal<number | null>(null);
  private readonly magnitudeMin = signal<number | null>(null);
  private readonly magnitudeMax = signal<number | null>(null);

  /** Collapsed row keys (parent `_order` values) — empty = all expanded.
   *  Cleared whenever the dataset changes so stale keys can't silently
   *  collapse a different row at the same timestamp on a new symbol. */
  private readonly collapsedKeys = signal<ReadonlySet<number>>(new Set());

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['swings']) {
      this.swingsSignal.set(this.swings);
      this.collapsedKeys.set(new Set());
    }
    if (changes['smallSwings']) {
      this.smallSwingsSignal.set(this.smallSwings);
      this.collapsedKeys.set(new Set());
    }
    if (changes['loading']) this.loadingSignal.set(this.loading);
    if (changes['error']) this.errorSignal.set(this.error);
  }

  readonly isLoading = computed(() => this.loadingSignal());
  readonly errorMessage = computed(() => this.errorSignal());

  /** Tree mode when a smallSwings array is bound (dual mode on). */
  readonly isTreeMode = computed(() => this.smallSwingsSignal() != null);

  /** Filtered + sorted swings ready for rendering (flat mode). */
  readonly viewSwings = computed<ViewSwing[]>(() => {
    const rows = this.applyFilters(this.swingsSignal().map((s, i) => ({ ...s, _index: i + 1 })));
    return this.applySort(rows);
  });

  /** Filtered + sorted top-level tree rows (tree mode). Children stay chronological. */
  readonly viewTreeRows = computed<ViewTreeRow[]>(() => {
    const merged = buildTreeSwings(this.swingsSignal(), this.smallSwingsSignal() ?? []);
    let parentIdx = 0;
    let orphanIdx = 0;
    const rows: ViewTreeRow[] = merged.map((r, i) => ({
      ...r,
      _order: i,
      _index: r.isOrphan ? ++orphanIdx : ++parentIdx,
    }));
    return this.applySort(this.applyFilters(rows));
  });

  readonly hasSwings = computed(() =>
    this.isTreeMode() ? this.viewTreeRows().length > 0 : this.viewSwings().length > 0,
  );
  readonly hasData = computed(
    () => this.swingsSignal().length > 0 || (this.smallSwingsSignal()?.length ?? 0) > 0,
  );

  // -------------------------------------------------------------------------
  // Tree expand/collapse
  // -------------------------------------------------------------------------

  readonly hasExpandableRows = computed(() => this.viewTreeRows().some((r) => r.children.length > 0));

  readonly allCollapsed = computed(() => {
    const expandable = this.viewTreeRows().filter((r) => r.children.length > 0);
    return expandable.length > 0 && expandable.every((r) => this.collapsedKeys().has(r._order));
  });

  isCollapsed(row: ViewTreeRow): boolean {
    return this.collapsedKeys().has(row._order);
  }

  toggleRow(row: ViewTreeRow): void {
    this.collapsedKeys.update((keys) => {
      const next = new Set(keys);
      if (next.has(row._order)) next.delete(row._order);
      else next.add(row._order);
      return next;
    });
  }

  onToggleAll(): void {
    if (this.allCollapsed()) {
      this.collapsedKeys.set(new Set());
    } else {
      const all = this.viewTreeRows()
        .filter((r) => r.children.length > 0)
        .map((r) => r._order);
      this.collapsedKeys.set(new Set(all));
    }
  }

  // -------------------------------------------------------------------------
  // Filter + sort (shared by both modes)
  // -------------------------------------------------------------------------

  private applyFilters<T extends Swing>(rows: T[]): T[] {
    const dir = this.directionFilter();
    if (dir !== 'all') rows = rows.filter((s) => s.direction === dir);

    const from = this.dateFrom();
    const to = this.dateTo();
    if (from) {
      const fromMs = new Date(from).getTime();
      if (!Number.isNaN(fromMs)) rows = rows.filter((s) => s.start.time >= fromMs);
    }
    if (to) {
      const toMs = new Date(to).getTime();
      // Interpret "Date To" as end of the selected day (inclusive).
      if (!Number.isNaN(toMs)) rows = rows.filter((s) => s.end.time <= toMs + 86_400_000 - 1);
    }

    const dMin = this.durationMin();
    const dMax = this.durationMax();
    if (dMin != null) rows = rows.filter((s) => s.duration >= dMin);
    if (dMax != null) rows = rows.filter((s) => s.duration <= dMax);

    const mMin = this.magnitudeMin();
    const mMax = this.magnitudeMax();
    if (mMin != null) rows = rows.filter((s) => s.magnitudeAbsolute >= mMin);
    if (mMax != null) rows = rows.filter((s) => s.magnitudeAbsolute <= mMax);

    return rows;
  }

  private applySort<T extends Swing & { _index: number; _order?: number }>(rows: T[]): T[] {
    const key = this.sortBy();
    const direction = this.sortDirection();
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        // In tree mode _order is the chronological merged position; in flat
        // mode _order is absent and _index IS the chronological position.
        case 'index': cmp = (a._order ?? a._index) - (b._order ?? b._index); break;
        case 'direction': cmp = a.direction.localeCompare(b.direction); break;
        case 'startDate': cmp = a.start.time - b.start.time; break;
        case 'endDate': cmp = a.end.time - b.end.time; break;
        case 'duration': cmp = a.duration - b.duration; break;
        case 'magnitudePercent': cmp = a.magnitudePercent - b.magnitudePercent; break;
        case 'magnitudeAbsolute': cmp = a.magnitudeAbsolute - b.magnitudeAbsolute; break;
        case 'startPrice': cmp = a.start.price - b.start.price; break;
        case 'endPrice': cmp = a.end.price - b.end.price; break;
        case 'volume': cmp = a.volume - b.volume; break;
      }
      return direction === 'asc' ? cmp : -cmp;
    });
  }

  onSort(key: SortKey): void {
    if (this.sortBy() === key) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(key);
      this.sortDirection.set('asc');
    }
  }

  sortIcon(key: SortKey): string {
    if (this.sortBy() !== key) return '';
    return this.sortDirection() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  // -------------------------------------------------------------------------
  // Filters
  // -------------------------------------------------------------------------

  onDirectionFilter(event: Event): void {
    this.directionFilter.set((event.target as HTMLSelectElement).value as DirectionFilter);
  }

  onDateFrom(event: Event): void {
    this.dateFrom.set((event.target as HTMLInputElement).value);
  }

  onDateTo(event: Event): void {
    this.dateTo.set((event.target as HTMLInputElement).value);
  }

  onDurationMin(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value === '') { this.durationMin.set(null); return; }
    const parsed = Number(value);
    this.durationMin.set(Number.isNaN(parsed) ? null : parsed);
  }

  onDurationMax(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value === '') { this.durationMax.set(null); return; }
    const parsed = Number(value);
    this.durationMax.set(Number.isNaN(parsed) ? null : parsed);
  }

  onMagnitudeMin(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value === '') { this.magnitudeMin.set(null); return; }
    const parsed = Number(value);
    this.magnitudeMin.set(Number.isNaN(parsed) ? null : parsed);
  }

  onMagnitudeMax(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value === '') { this.magnitudeMax.set(null); return; }
    const parsed = Number(value);
    this.magnitudeMax.set(Number.isNaN(parsed) ? null : parsed);
  }

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  formatDate(ms: number): string {
    return new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
  }

  formatPrice(value: number): string {
    return value.toFixed(2);
  }

  formatMagnitudePercent(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  }

  formatMagnitudeAbsolute(value: number): string {
    return value.toFixed(2);
  }

  formatVolume(value: number): string {
    return value.toLocaleString('en-US');
  }
}
