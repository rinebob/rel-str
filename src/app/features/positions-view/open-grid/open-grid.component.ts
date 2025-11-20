import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { PositionsStore } from '../positions.store';
import { PvOpenCardComponent } from '../open-card/open-card.component';
import { PositionSide } from '../../../core/models/position.types';

export enum OpenSideFilter {
  ALL = 'all',
  LONG = 'long',
  SHORT = 'short',
}

export enum OpenResultFilter {
  ALL = 'all',
  WINNERS = 'winners',
  LOSERS = 'losers',
}

@Component({
  selector: 'app-pv-open-grid',
  standalone: true,
  imports: [CommonModule, MatChipsModule, PvOpenCardComponent],
  templateUrl: './open-grid.component.html',
  styleUrls: ['./open-grid.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PvOpenGridComponent {
  private readonly store = inject(PositionsStore);

  // Expose enums for template bindings
  readonly SideFilter = OpenSideFilter;
  readonly ResultFilter = OpenResultFilter;

  readonly sideFilter = signal<OpenSideFilter>(OpenSideFilter.ALL);
  readonly resultFilter = signal<OpenResultFilter>(OpenResultFilter.ALL);

  readonly filtered = computed(() => {
    return this.store.openList().filter((p) => {
      const isLong = p.side === PositionSide.LONG;
      const side = this.sideFilter();
      const res = this.resultFilter();

      const currentChange = p.currentChange;
      const inferredChange =
        p.currentPrice != null && p.entryPrice != null
          ? p.currentPrice - p.entryPrice
          : 0;
      const change = currentChange ?? inferredChange;

      if (side === OpenSideFilter.LONG && !isLong) return false;
      if (side === OpenSideFilter.SHORT && isLong) return false;

      if (res === OpenResultFilter.WINNERS && change <= 0) return false;
      if (res === OpenResultFilter.LOSERS && change >= 0) return false;

      return true;
    });
  });

  setSideFilter(value: OpenSideFilter): void {
    this.sideFilter.set(value);
  }

  setResultFilter(value: OpenResultFilter): void {
    this.resultFilter.set(value);
  }
}
