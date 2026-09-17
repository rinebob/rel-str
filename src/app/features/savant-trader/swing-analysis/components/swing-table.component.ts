/**
 * SwingTableComponent — sortable, filterable table of ZigZag swings.
 *
 * Columns: #, Direction, Start Date, End Date, Duration, Magnitude %,
 * Magnitude $, Start Price, End Price, Volume.
 * The last row (projected swing, `confirmed: false`) has distinct styling.
 * Pure signal-based sorting and filtering — no external library.
 *
 * Note: `input()` signals are not recognized in this repo's Jest setup
 * (jest-preset-angular). Inputs use `@Input()` decorators mirrored into
 * private signals via `OnChanges` so `computed()` reactivity works.
 */
import { ChangeDetectionStrategy, Component, computed, Input, OnChanges, signal, SimpleChanges } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import type { Swing } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

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

@Component({
  selector: 'app-swing-table',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule],
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

    <table class="swing-table">
      <thead>
        <tr>
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
        @for (swing of viewSwings(); track swing._index) {
          <tr [class.projected]="!swing.confirmed">
            <td>{{ swing._index }}</td>
            <td>
              <span class="direction-badge" [class.up]="swing.direction === 'up'" [class.down]="swing.direction === 'down'">
                {{ swing.direction === 'up' ? '▲' : '▼' }} {{ swing.direction }}
              </span>
            </td>
            <td>{{ formatDate(swing.start.time) }}</td>
            <td>{{ formatDate(swing.end.time) }}</td>
            <td>{{ swing.duration }}</td>
            <td [class.positive]="swing.magnitudePercent >= 0" [class.negative]="swing.magnitudePercent < 0">
              {{ formatMagnitudePercent(swing.magnitudePercent) }}
            </td>
            <td>{{ formatMagnitudeAbsolute(swing.magnitudeAbsolute) }}</td>
            <td>{{ formatPrice(swing.start.price) }}</td>
            <td>{{ formatPrice(swing.end.price) }}</td>
            <td>{{ formatVolume(swing.volume) }}</td>
          </tr>
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
    .swing-table-filters { display: flex; flex-wrap: wrap; gap: 12px; padding: 8px 0; }
    .swing-table-filters .filter { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--mat-sys-on-surface-variant); text-transform: uppercase; }
    .swing-table-filters select, .swing-table-filters input { font-size: 13px; padding: 4px 8px; border: 1px solid var(--mat-sys-outline-variant); border-radius: 4px; background: var(--mat-sys-surface); color: var(--mat-sys-on-surface); }
    .swing-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .swing-table th { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); color: var(--mat-sys-on-surface-variant); font-weight: 600; white-space: nowrap; }
    .swing-table th.sortable { cursor: pointer; user-select: none; }
    .swing-table th.sortable:hover { color: var(--mat-sys-on-surface); }
    .swing-table th.sortable mat-icon { font-size: 14px; width: 14px; height: 14px; vertical-align: middle; }
    .swing-table td { padding: 8px 12px; border-bottom: 1px solid var(--mat-sys-outline-variant); }
    .swing-table tbody tr:hover { background: var(--mat-sys-surface-container); }
    .swing-table tbody tr.projected { font-style: italic; color: var(--mat-sys-on-surface-variant); border-left: 3px dashed var(--mat-sys-outline-variant); }
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
  @Input() loading = false;
  @Input() error: string | null = null;

  private readonly swingsSignal = signal<Swing[]>([]);
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

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['swings']) this.swingsSignal.set(this.swings);
    if (changes['loading']) this.loadingSignal.set(this.loading);
    if (changes['error']) this.errorSignal.set(this.error);
  }

  readonly isLoading = computed(() => this.loadingSignal());
  readonly errorMessage = computed(() => this.errorSignal());

  /** Filtered + sorted swings ready for rendering. */
  readonly viewSwings = computed<ViewSwing[]>(() => {
    let rows = this.swingsSignal().map((s, i) => ({ ...s, _index: i + 1 }));

    // Direction filter
    const dir = this.directionFilter();
    if (dir !== 'all') rows = rows.filter((s) => s.direction === dir);

    // Date range filter
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

    // Duration range filter
    const dMin = this.durationMin();
    const dMax = this.durationMax();
    if (dMin != null) rows = rows.filter((s) => s.duration >= dMin);
    if (dMax != null) rows = rows.filter((s) => s.duration <= dMax);

    // Magnitude range filter (uses absolute magnitude)
    const mMin = this.magnitudeMin();
    const mMax = this.magnitudeMax();
    if (mMin != null) rows = rows.filter((s) => s.magnitudeAbsolute >= mMin);
    if (mMax != null) rows = rows.filter((s) => s.magnitudeAbsolute <= mMax);

    // Sort
    const key = this.sortBy();
    const direction = this.sortDirection();
    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      switch (key) {
        case 'index': cmp = a._index - b._index; break;
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

    return rows;
  });

  readonly hasSwings = computed(() => this.viewSwings().length > 0);
  readonly hasData = computed(() => this.swingsSignal().length > 0);

  // -------------------------------------------------------------------------
  // Sort
  // -------------------------------------------------------------------------

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
