import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PositionsStore } from './positions.store';
import { PvOpenSummaryComponent } from './open-summary/open-summary.component';
import { PvOpenGridComponent } from './open-grid/open-grid.component';
import { PvClosedGridComponent } from './closed-grid/closed-grid.component';

@Component({
  selector: 'app-positions-view',
  standalone: true,
  imports: [CommonModule, PvOpenSummaryComponent, PvOpenGridComponent, PvClosedGridComponent],
  templateUrl: './positions-view.component.html',
  styleUrls: ['./positions-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PositionsViewComponent {
  readonly store = inject(PositionsStore);

  readonly closedLimit = signal(10);

  readonly visibleClosedLongs = computed(() => this.store.closedLongs().slice(0, this.closedLimit()));
  readonly visibleClosedShorts = computed(() => this.store.closedShorts().slice(0, this.closedLimit()));

  showMoreClosed(): void {
    this.closedLimit.update((n) => n + 10);
  }

  dow(day?: string | null): string {
    if (!day) return '';
    const d = new Date(day);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }
}
