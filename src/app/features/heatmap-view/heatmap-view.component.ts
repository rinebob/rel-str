import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HeatmapViewStore } from './heatmap-view.store';

@Component({
  selector: 'app-heatmap-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './heatmap-view.component.html',
  styleUrls: ['./heatmap-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapViewComponent {
  private readonly store = inject(HeatmapViewStore);

  readonly vm = computed(() => this.store.vm());

  // Temporary helper to allow manual triggering of a demo query during development.
  // Real integration will supply a HeatmapQuery from higher-level navigation or list selection.
  setDemoQuery(): void {
    this.store.setQuery({
      listId: 'demo-list',
      baseline: 'SPY',
      symbols: ['AAPL', 'MSFT', 'NVDA'],
      interval: 'DAILY',
      phaseMode: 'canonicalOnly',
      rangeDays: 20,
    });
  }

  onHeaderClick(columnIndex: number): void {
    const current = this.vm().sort;
    const direction =
      current.columnIndex === columnIndex && current.direction === 'desc' ? 'asc' : 'desc';

    this.store.setSort({ columnIndex, direction });
  }
}
