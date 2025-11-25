import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatChipsModule } from '@angular/material/chips';
import { PositionsStore, PositionsResultFilter, PositionsSideFilter } from '../positions.store';
import { PvOpenCardComponent } from '../open-card/open-card.component';
import { PositionDirection } from '../../../core/models/fe-position.types';

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
  readonly SideFilter = PositionsSideFilter;
  readonly ResultFilter = PositionsResultFilter;

  readonly sideFilter = computed(() => this.store.sideFilter());
  readonly resultFilter = computed(() => this.store.resultFilter());

  readonly filtered = computed(() => this.store.openFiltered());

  setSideFilter(value: PositionsSideFilter): void {
    this.store.setSideFilter(value);
  }

  setResultFilter(value: PositionsResultFilter): void {
    this.store.setResultFilter(value);
  }
}
