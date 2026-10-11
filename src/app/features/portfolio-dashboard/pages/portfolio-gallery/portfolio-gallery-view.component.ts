/**
 * Portfolio Gallery View (#926/#950)
 *
 * portfolio-v2 page shell: account summary + facet header, a flat
 * market-cap-ordered card grid (grouped expandos land in #951), and the
 * loading / error / no-agentic-account / empty states. Live equity
 * positions only — one card per held position, no triage state.
 */
import { ChangeDetectionStrategy, Component, effect, inject, OnInit } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { PortfolioGalleryFacade } from './portfolio-gallery.facade';
import { GalleryCardChartStore } from '../../../savant-trader/stores/gallery-card-chart.store';
import { PortfolioGalleryHeaderComponent } from './portfolio-gallery-header.component';
import { fmtMoney, fmtNum } from '../../../savant-trader/utils/utils';
import { scheduleIdle, cancelIdle } from '../../../shared/utils/schedule-idle.util';

@Component({
  selector: 'app-portfolio-gallery-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    PortfolioGalleryHeaderComponent,
  ],
  templateUrl: './portfolio-gallery-view.component.html',
  styleUrl: './portfolio-gallery-view.component.scss',
})
export class PortfolioGalleryViewComponent implements OnInit {
  readonly facade = inject(PortfolioGalleryFacade);
  private readonly cardCharts = inject(GalleryCardChartStore);
  /** Null-tolerant wrappers over the shared formatters. */
  readonly money = (v: number | null | undefined): string => fmtMoney(v ?? undefined);
  readonly num = (v: number | null | undefined): string => fmtNum(v ?? undefined);

  constructor() {
    // Warm per-symbol daily bars on idle after first paint so the card
    // charts (#952) render without a data wait. The store dedupes per
    // symbol — reschedules are no-ops for cached entries.
    effect((onCleanup) => {
      const symbols = new Set(this.facade.flatCards().map((c) => c.symbol));
      if (!symbols.size) return;
      const id = scheduleIdle(() => this.cardCharts.prefetch(symbols));
      onCleanup(() => cancelIdle(id));
    });
  }

  ngOnInit(): void {
    this.facade.enterPage();
  }
}
