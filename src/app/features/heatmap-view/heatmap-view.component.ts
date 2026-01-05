import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule, DecimalPipe } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { HeatmapViewStore } from './heatmap-view.store';

@Component({
  selector: 'app-heatmap-view',
  standalone: true,
  imports: [CommonModule, DecimalPipe, MatTableModule],
  templateUrl: './heatmap-view.component.html',
  styleUrls: ['./heatmap-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapViewComponent {
  private readonly store = inject(HeatmapViewStore);

  readonly vm = computed(() => this.store.vm());

  readonly dateColumnIds = computed(() => this.vm().headerCells.map((_, idx) => `d_${idx}`));

  readonly displayedColumns = computed(() => [
    'symbolDate',
    ...this.dateColumnIds(),
    'chart',
    'history',
  ]);

  readonly rows = computed(() => this.vm().rows);

  constructor() {
    // Temporary: auto-load a demo query until we wire this to real navigation/list selection.
    this.setDemoQuery();
  }

  // Temporary helper; real integration will supply a HeatmapQuery from higher-level navigation or list selection.
  setDemoQuery(): void {
    this.store.setQuery({
      listId: 'demo-list',
      baseline: 'SPY',
      symbols: ['AAPL', 'NVDA'],
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

  onChartClick(symbol: string): void {
    console.log('[HeatmapView] Chart click', symbol);
  }

  onHistoryClick(symbol: string): void {
    console.log('[HeatmapView] History click', symbol);
  }
}
