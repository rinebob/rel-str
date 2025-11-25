import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { PositionsStore } from '../positions.store';
import { MatSortModule, Sort } from '@angular/material/sort';
import { PositionDoc } from '../../../core/models/fe-position.types';

@Component({
  selector: 'app-pv-closed-grid',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatPaginatorModule, MatButtonToggleModule, MatSortModule],
  templateUrl: './closed-grid.component.html',
  styleUrls: ['./closed-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvClosedGridComponent {
  private readonly store = inject(PositionsStore);

  readonly positions = computed(() => this.store.closedFiltered());
  readonly totalCount = computed(() => this.store.closedFilteredCount());
  readonly pageIndex = computed(() => this.store.closedPageIndex());
  readonly pageSize = computed(() => this.store.closedPageSize());
  readonly displayedColumns = ['baseline', 'symbol', 'direction', 'entryPrice', 'exitPrice', 'netPnL', 'percentReturn', 'entryDay', 'exitDay'];

  readonly selectedRangeDays = signal<number | null>(30);
  readonly sortActive = signal<string>('baseline');
  readonly sortDirection = signal<'asc' | 'desc' | ''>('asc');

  readonly sortedPositions = computed<PositionDoc[]>(() => {
    const data = this.positions();
    const active = this.sortActive();
    const direction = this.sortDirection();

    if (!active || !direction) {
      return data;
    }

    const dir = direction === 'asc' ? 1 : -1;

    const getValue = (p: PositionDoc): string | number | null => {
      switch (active) {
        case 'baseline':
          return p.baseline ?? '';
        case 'symbol':
          return p.symbol ?? '';
        case 'direction':
          return p.direction ?? '';
        case 'netPnL':
          return p.netPnL ?? 0;
        case 'percentReturn':
          return p.percentReturn ?? 0;
        case 'entryDay':
          return p.entryDay ?? '';
        case 'exitDay':
          return p.exitDay ?? '';
        default:
          return null;
      }
    };

    return [...data].sort((a, b) => {
      const av = getValue(a);
      const bv = getValue(b);

      if (av == null && bv == null) return 0;
      if (av == null) return -1 * dir;
      if (bv == null) return 1 * dir;

      if (typeof av === 'number' && typeof bv === 'number') {
        const primary = (av - bv) * dir;
        if (primary !== 0 || active !== 'baseline') {
          return primary;
        }
      }

      const as = String(av);
      const bs = String(bv);
      const primaryStr = as.localeCompare(bs) * dir;
      if (primaryStr !== 0 || active !== 'baseline') {
        return primaryStr;
      }

      // For baseline sort, tie-break by symbol ascending
      const sa = a.symbol ?? '';
      const sb = b.symbol ?? '';
      return sa.localeCompare(sb);
    });
  });

  readonly hasPrev = computed(() => this.pageIndex() > 0);
  readonly hasNext = computed(() => {
    const index = this.pageIndex();
    const size = this.pageSize();
    const total = this.totalCount();
    return (index + 1) * size < total;
  });

  constructor() {
    this.setRangeDays(30);
  }

  setRangeDays(days: number | null): void {
    this.selectedRangeDays.set(days);
    if (days == null) {
      this.store.setClosedDateRange(null, null);
      return;
    }
    const now = Date.now();
    const from = now - days * 24 * 60 * 60 * 1000;
    this.store.setClosedDateRange(from, now);
  }

  prevPage(): void {
    if (!this.hasPrev()) return;
    this.store.setClosedPage(this.pageIndex() - 1);
  }

  nextPage(): void {
    if (!this.hasNext()) return;
    this.store.setClosedPage(this.pageIndex() + 1);
  }

  onPage(event: PageEvent): void {
    this.store.setClosedPagination(event.pageIndex, event.pageSize);
  }

  onSortChange(sort: Sort): void {
    this.sortActive.set(sort.active || '');
    this.sortDirection.set(sort.direction || '');
  }
}
