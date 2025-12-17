import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { PositionsStore, PositionsResultFilter, PositionsSideFilter, PositionsIntervalFilter } from '../positions.store';
import { PvOpenCardComponent } from '../open-card/open-card.component';
import { PositionDirection } from '../../../core/models/fe-position.types';
import { BarsInterval } from '../../../core/models/partner.types';

@Component({
  selector: 'app-pv-open-grid',
  standalone: true,
  imports: [CommonModule, MatChipsModule, MatExpansionModule, PvOpenCardComponent],
  templateUrl: './open-grid.component.html',
  styleUrls: ['./open-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvOpenGridComponent {
  private readonly store = inject(PositionsStore);

  // Expose enums for template bindings
  readonly SideFilter = PositionsSideFilter;
  readonly ResultFilter = PositionsResultFilter;
  readonly IntervalFilter = PositionsIntervalFilter;

  readonly sideFilter = computed(() => this.store.sideFilter());
  readonly resultFilter = computed(() => this.store.resultFilter());
  readonly intervalFilter = computed(() => this.store.intervalFilter());

  readonly filtered = computed(() => this.store.openFiltered());

  readonly sortedFiltered = computed(() =>
    [...this.filtered()].sort((a, b) => {
      const pa = (a.pair ?? '').toUpperCase();
      const pb = (b.pair ?? '').toUpperCase();
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return 0;
    }),
  );

  readonly monthlyOpen = computed(() =>
    this.sortedFiltered().filter((p) => p.interval === BarsInterval.MONTHLY),
  );

  readonly weeklyOpen = computed(() =>
    this.sortedFiltered().filter((p) => p.interval === BarsInterval.WEEKLY),
  );

  readonly dailyOpen = computed(() =>
    this.sortedFiltered().filter((p) => p.interval === BarsInterval.DAILY),
  );

  setSideFilter(value: PositionsSideFilter): void {
    this.store.setSideFilter(value);
  }

   setIntervalFilter(value: PositionsIntervalFilter): void {
     this.store.setIntervalFilter(value);
   }

  setResultFilter(value: PositionsResultFilter): void {
    this.store.setResultFilter(value);
  }
}
