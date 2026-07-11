/**
 * Chart Sync Overlay Component
 *
 * Renders the cross-chart crosshair synchronization lines (vertical and horizontal)
 * inside a single chart wrapper. It receives the synchronized date and price from a
 * sibling chart and positions the overlay lines using the chart's current axis state.
 *
 * This component intentionally owns the sync overlay DOM so that FlexChartComponent
 * does not need to query its own DOM for crosshair positioning.
 */

import {
  Component,
  input,
  effect,
  ElementRef,
  inject,
  NgZone,
  afterNextRender,
  ChangeDetectionStrategy,
  computed,
} from '@angular/core';
import { ChartViewportStore } from '../store/chart-viewport.store';
import { ChartYAxisViewportController } from '../services/chart-y-axis-viewport-controller.service';
import { ChartLifecycleFacade } from '../services/chart-lifecycle-facade.service';

/** Minimal bar shape needed for binary-search date lookup */
export interface OverlayBar {
  date: Date;
  index: number;
}

@Component({
  selector: 'app-chart-sync-overlay',
  standalone: true,
  template: `
    <div class="crosshair-sync-line-v" #vLine></div>
    <div class="crosshair-sync-line-h" #hLine></div>
  `,
  styleUrl: './chart-sync-overlay.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartSyncOverlayComponent {
  /** Category bars, used for O(log n) date-to-index lookup */
  bars = input.required<OverlayBar[]>();

  private readonly el = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly viewport = inject(ChartViewportStore);
  private readonly yAxisController = inject(ChartYAxisViewportController);
  private readonly lifecycleFacade = inject(ChartLifecycleFacade);
  private vLineEl: HTMLElement | null = null;
  private hLineEl: HTMLElement | null = null;

  /** Precomputed sorted timestamps for binary search */
  private readonly barTimestamps = computed(() =>
    this.bars().map((b) => ({ time: b.date.getTime(), index: b.index })),
  );

  constructor() {
    // Cache the overlay line elements once the DOM is ready.
    afterNextRender(() => {
      this.vLineEl = this.el.nativeElement.querySelector('.crosshair-sync-line-v');
      this.hLineEl = this.el.nativeElement.querySelector('.crosshair-sync-line-h');
    });

    // Position the overlay lines whenever the sync values or captured axis state change.
    // The axis state signal is kept up-to-date by the lifecycle facade, so the overlay
    // repositions itself when the chart is zoomed or scrolled without reading the chart.
    effect(() => {
      const syncDate = this.viewport.crosshairDate();
      const syncPrice = this.viewport.crosshairPrice();
      const hovered = this.viewport.hovered();
      const state = this.lifecycleFacade.chartState();

      if (hovered || !syncDate || syncPrice === null || !state) {
        this.hideLines();
        return;
      }

      const xAxis = state.xAxis;
      const yAxis = state.yAxis;
      const closestIdx = this.findClosestIndex(syncDate.getTime());
      const pixelX = xAxis.rect.x + ((closestIdx - xAxis.visibleRange.min) / xAxis.visibleRange.delta) * xAxis.rect.width;
      const pixelY = this.yAxisController.pixelFromPrice(
        yAxis.valueType === 'Logarithmic',
        syncPrice,
        yAxis.rect,
        yAxis.visibleRange,
      );

      const inBounds =
        pixelX >= xAxis.rect.x &&
        pixelX <= xAxis.rect.x + xAxis.rect.width &&
        pixelY >= yAxis.rect.y &&
        pixelY <= yAxis.rect.y + yAxis.rect.height;

      this.zone.runOutsideAngular(() => {
        if (!this.vLineEl || !this.hLineEl) return;
        if (inBounds) {
          this.vLineEl.style.display = 'block';
          this.hLineEl.style.display = 'block';
          this.vLineEl.style.left = `${pixelX}px`;
          this.hLineEl.style.top = `${pixelY}px`;
        } else {
          this.vLineEl.style.display = 'none';
          this.hLineEl.style.display = 'none';
        }
      });
    });
  }

  private hideLines(): void {
    this.zone.runOutsideAngular(() => {
      if (this.vLineEl) this.vLineEl.style.display = 'none';
      if (this.hLineEl) this.hLineEl.style.display = 'none';
    });
  }

  /** Find the bar index closest to the target timestamp using binary search */
  private findClosestIndex(targetTime: number): number {
    const times = this.barTimestamps();
    if (times.length === 0) return 0;

    let lo = 0;
    let hi = times.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const midTime = times[mid].time;
      if (midTime === targetTime) return times[mid].index;
      if (midTime < targetTime) lo = mid + 1;
      else hi = mid - 1;
    }

    if (hi < 0) return times[lo]?.index ?? 0;
    if (lo >= times.length) return times[hi]?.index ?? times.length - 1;

    const leftDiff = targetTime - times[hi].time;
    const rightDiff = times[lo].time - targetTime;
    return leftDiff <= rightDiff ? times[hi].index : times[lo].index;
  }
}
