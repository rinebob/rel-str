import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, computed, effect, inject } from '@angular/core';
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

  @ViewChild('scrollContainer', { static: false })
  private scrollContainer?: ElementRef<HTMLDivElement>;

  readonly vm = computed(() => this.store.vm());

  constructor() {
    // Temporary: auto-load a demo query until we wire this to real navigation/list selection.
    this.setDemoQuery();

    effect(() => {
      const vm = this.vm();
      if (vm.status.state !== 'ready') {
        return;
      }

      const el = this.scrollContainer?.nativeElement;
      if (!el) {
        return;
      }

      queueMicrotask(() => {
        el.scrollLeft = el.scrollWidth;
      });
    });
  }

  // Temporary helper; real integration will supply a HeatmapQuery from higher-level navigation or list selection.
  setDemoQuery(): void {
    this.store.setQuery({
      listId: 'demo-list',
      baseline: 'SPY',
      symbols: ['AAPL', 'NVDA'],
      interval: 'DAILY',
      phaseMode: 'canonicalOnly',
      rangeDays: 365,
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
