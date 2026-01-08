import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewChild, computed, effect, inject, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';

import { IntervalToggleComponent } from '../shared/components/interval-toggle/interval-toggle.component';
import { Timeframe } from '../shared/types/rs.interfaces';
import { HeatmapViewStore } from './heatmap-view.store';
import { RsAppStore } from '../store/rs-app.store';
import { HeatmapQuery } from './constants-heatmap-view';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-heatmap-view',
  standalone: true,
  imports: [CommonModule, IntervalToggleComponent],
  templateUrl: './heatmap-view.component.html',
  styleUrls: ['./heatmap-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapViewComponent {
  private readonly store = inject(HeatmapViewStore);
  private readonly rsAppStore = inject(RsAppStore);
  private readonly authStore = inject(AuthStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly Interval = Timeframe;

  @ViewChild('scrollContainer', { static: false })
  private scrollContainer?: ElementRef<HTMLDivElement>;

  @ViewChild('hScroll', { static: false })
  private hScroll?: ElementRef<HTMLDivElement>;

  readonly vm = computed(() => this.store.vm());

  // Width for proxy horizontal scrollbar, kept in sync with main scroll container width
  hScrollWidth = 0;

  // Guard to avoid recursive scroll event feedback between main grid and proxy scrollbar
  private syncingScroll = false;

  constructor() {
    // Load lists for the authenticated user, mirroring dashboard v2 behavior.
    this.authStore.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const user = this.authStore.user();
        if (user?.uid) {
          this.rsAppStore.getListsForUserV2(user.uid);
        }
      });

    // Auto-scroll to the most recent column when data is ready.
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
        this.hScrollWidth = el.scrollWidth;

        const proxy = this.hScroll?.nativeElement;
        if (proxy) {
          proxy.scrollLeft = el.scrollLeft;
        }
      });
    });

    // If lists are loaded but no list is selected yet, auto-select the first one.
    effect(() => {
      const lists = this.rsAppStore.allStockListsV2();
      if (!Array.isArray(lists) || lists.length === 0) {
        return;
      }

      const selected = this.rsAppStore.selectedStockListV2();
      if (selected?.name) {
        return;
      }

      this.rsAppStore.initializeListV2(lists[0]);
    });

    // Keep the heatmap query in sync with the currently selected stock list.
    let lastQueryKey: string | null = null;
    effect(() => {
      const list = this.rsAppStore.selectedStockListV2();
      if (!list?.name || !Array.isArray(list.symbols) || list.symbols.length === 0) {
        return;
      }

      // Read the current interval without tracking vm() as a dependency to avoid a feedback loop.
      const currentInterval = untracked(() => this.vm().query?.interval ?? Timeframe.DAILY);

      const query: HeatmapQuery = {
        listId: list.name,
        baseline: list.baseline,
        symbols: list.symbols.map((c) => c.symbol),
        interval: currentInterval,
        phaseMode: 'canonicalOnly',
        rangeDays: 365,
      };

      const key = JSON.stringify(query);
      if (key === lastQueryKey) {
        return;
      }

      lastQueryKey = key;
      this.store.setQuery(query);
    });
  }

  onMainScroll(): void {
    if (this.syncingScroll) return;
    const main = this.scrollContainer?.nativeElement;
    const proxy = this.hScroll?.nativeElement;
    if (!main || !proxy) return;
    this.syncingScroll = true;
    proxy.scrollLeft = main.scrollLeft;
    this.syncingScroll = false;
  }

  onHScroll(): void {
    if (this.syncingScroll) return;
    const main = this.scrollContainer?.nativeElement;
    const proxy = this.hScroll?.nativeElement;
    if (!main || !proxy) return;
    this.syncingScroll = true;
    main.scrollLeft = proxy.scrollLeft;
    this.syncingScroll = false;
  }

  onHeaderClick(columnIndex: number): void {
    const current = this.vm().sort;
    const direction =
      current.columnIndex === columnIndex && current.direction === 'desc' ? 'asc' : 'desc';

    this.store.setSort({ columnIndex, direction });
  }

  onLabelHeaderClick(): void {
    const current = this.vm().sort;
    const isLabelSorted = current.columnIndex === -1;
    const direction = isLabelSorted && current.direction === 'desc' ? 'asc' : 'desc';

    this.store.setSort({ columnIndex: -1, direction });
  }

  onChartClick(symbol: string): void {
    console.log('[HeatmapView] Chart click', symbol);
  }

  onHistoryClick(symbol: string): void {
    console.log('[HeatmapView] History click', symbol);
  }

  onIntervalChange(interval: Timeframe): void {
    const current = this.vm().query;
    if (!current || current.interval === interval) {
      return;
    }

    this.store.setQuery({
      ...current,
      interval,
    });
  }
}
