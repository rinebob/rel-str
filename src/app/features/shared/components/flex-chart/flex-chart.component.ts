/**
 * Flex Chart Component
 *
 * Flexible multi-pane chart with configurable indicators.
 * Supports dynamic indicator panes and various technical indicators.
 */
import {
  Component,
  input,
  output,
  viewChild,
  effect,
  ChangeDetectionStrategy,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  NgZone,
  afterNextRender,
} from '@angular/core';
import {
  ChartModule,
  ChartComponent as SfChartComponent,
  CandleSeriesService,
  LineSeriesService,
  AreaSeriesService,
  ColumnSeriesService,
  RangeAreaSeriesService,
  ScatterSeriesService,
  DateTimeService,
  CategoryService,
  ZoomService,
  ScrollBarService,
  LegendService,
  StripLineService,
  LogarithmicService,
  IZoomCompleteEventArgs,
  IMouseEventArgs,
} from '@syncfusion/ej2-angular-charts';

import type {
  FlexChartDataset,
  FlexChartConfig,
} from './flex-chart.types';
import { ChartIntervalKey, StIndicator } from './flex-chart.types';
import { ChartViewportStore } from './store/chart-viewport.store';
import { ChartYAxisViewportController } from './services/chart-y-axis-viewport-controller.service';
import { ChartLifecycleFacade } from './services/chart-lifecycle-facade.service';
import { ChartDataAdapter } from './services/chart-data-adapter.service';
import type { SfAxisLabelRenderArgs, SfChartInstance } from './services/chart-instance.types';
import { ChartSyncOverlayComponent } from './components/chart-sync-overlay.component';

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  imports: [ChartModule, ChartSyncOverlayComponent],
  providers: [
    ChartViewportStore,
    ChartYAxisViewportController,
    ChartLifecycleFacade,
    ChartDataAdapter,
    CandleSeriesService,
    LogarithmicService,
    LineSeriesService,
    AreaSeriesService,
    ColumnSeriesService,
    RangeAreaSeriesService,
    ScatterSeriesService,
    DateTimeService,
    CategoryService,
    ZoomService,
    ScrollBarService,
    LegendService,
    StripLineService,
  ],
  templateUrl: './flex-chart.component.html',
  styleUrl: './flex-chart.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlexChartComponent implements OnDestroy {
  readonly StIndicator = StIndicator;

  private readonly el = inject(ElementRef);
  private readonly zone = inject(NgZone);
  private readonly viewport = inject(ChartViewportStore);
  private readonly yAxisController = inject(ChartYAxisViewportController);
  private readonly lifecycleFacade = inject(ChartLifecycleFacade);
  private readonly dataAdapter = inject(ChartDataAdapter);
  private resizeObserver: ResizeObserver | null = null;

  private readonly chart = viewChild<SfChartComponent>('chart');

  // Cached DOM refs for the hovered crosshair lines and price label. Caching avoids
  // relying on viewChild signal updates when running outside Angular zone.
  private hoverVLineEl: HTMLElement | null = null;
  private hoverHLineEl: HTMLElement | null = null;
  private priceLabelEl: HTMLElement | null = null;

  // Raf handles for smooth hovered crosshair positioning outside Angular change detection
  private pendingPriceLabelRaf: number | null = null;
  private pendingHoverCrosshairRaf: number | null = null;
  private pendingResizeRaf: number | null = null;

  // Narrow viewChild Syncfusion component to the runtime properties we actually touch.
  // This is the only place an assertion crosses from SfChartComponent to our facade.
  private readonly typedChart = computed<SfChartInstance | null>(() => {
    const chart = this.chart();
    return chart ? (chart as unknown as SfChartInstance) : null;
  });

  // Throttle crosshair store/broadcast updates to bar-index or rounded-price changes
  private lastCrosshairIdx = -1;
  private lastCrosshairPriceRounded: number | null = null;

  // Inputs
  chartData = input.required<FlexChartDataset | null>();
  config = input<FlexChartConfig>({ indicators: [] });
  height = input<string>('400px');
  syncCrosshairDate = input<Date | null>(null);
  syncCrosshairPrice = input<number | null>(null);

  // Outputs
  crosshairDateChange = output<Date | null>();
  crosshairPriceChange = output<number | null>();

  // Disable all series animations
  noAnimation = { enable: false };

  // Store-derived helpers (kept as aliases for readability inside the component)
  hoveredDate = this.viewport.crosshairDateLabel;
  hoveredPrice = this.viewport.crosshairPriceLabel;
  hoveredPriceTop = this.viewport.hoveredPriceTop;

  // Data transformation delegated to ChartDataAdapter
  categoryBars = this.dataAdapter.categoryBars;
  computedSeries = this.dataAdapter.computedSeries;
  mainPaneSeries = this.dataAdapter.mainPaneSeries;
  trendBandSeries = this.dataAdapter.trendBandSeries;
  lowerPanes = this.dataAdapter.lowerPanes;
  chartAxes = this.dataAdapter.chartAxes;
  chartRows = this.dataAdapter.chartRows;


  // Chart configuration - Category axis removes gaps (like TradingView)
  // NOTE: zoomFactor/zoomPosition are NOT included here — they are imperative state
  // applied once by applyInitialZoom(). Including them would cause Syncfusion to
  // reset the user's scroll position whenever this computed re-fires.
  primaryXAxis = computed(() => {
    // Re-evaluate when the dataset changes so Syncfusion rebuilds the category axis
    // for a new symbol/interval. The axis config itself is constant.
    this.chartData()?.bars.length;

    return {
      valueType: 'Category',
      majorGridLines: { width: 0 },
      edgeLabelPlacement: 'Shift',
    };
  });

  onAxisLabelRender(args: SfAxisLabelRenderArgs): void {
    if (args.axis.name === 'primaryXAxis') {
      const data = this.chartData();
      const idx = Math.round(Number(args.value));
      if (!data || Number.isNaN(idx) || !data.bars[idx]) return;

      const date = data.bars[idx].x;
      const interval = this.config().interval;
      const format: Intl.DateTimeFormatOptions = interval === ChartIntervalKey.MONTHLY
        ? { month: 'short', year: '2-digit' }
        : { month: 'short', day: 'numeric' };
      args.text = date.toLocaleDateString('en-US', format);
      return;
    }

    if (args.axis.name === 'primaryYAxis') {
      const value = Number(args.value);
      if (Number.isNaN(value)) return;

      args.text = this.yAxisController.formatLabel(args.axis.valueType === 'Logarithmic', value);
    }
  }

  // primaryYAxis declarative config. The actual min/max (or zoomFactor/zoomPosition for log)
  // are applied imperatively by the lifecycle facade so the component does not mutate the chart.
  primaryYAxis = computed(() =>
    this.yAxisController.buildAxisConfig(!!this.config().logScale, this.lowerPanes().length),
  );

  zoomSettings = computed(() => {
    const showToolbar = this.config().showZoomToolbar !== false;
    return {
      enableSelectionZooming: showToolbar,
      enableScrollbar: this.config().enableScrollbar !== false,
      enableMouseWheelZooming: false,
      mode: 'X',
      enablePan: showToolbar,
      showToolbar,
      toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
      toolbarPosition: { horizontalAlignment: 'Near', verticalAlignment: 'Top' },
    };
  });

  // Disable Syncfusion's built-in crosshair — we draw our own lines so we control
  // the render path and can sync the same position across sibling charts.
  crosshair = {
    enable: false,
  };

  constructor() {
    afterNextRender(() => {
      const native = this.el.nativeElement;
      this.hoverVLineEl = native.querySelector('.crosshair-line-v');
      this.hoverHLineEl = native.querySelector('.crosshair-line-h');
      this.priceLabelEl = native.querySelector('.crosshair-price-label');
    });

    this.lifecycleFacade.connectAndActivate(this.typedChart, this.chartData, this.config, this.dataAdapter.computedSeries);
    this.dataAdapter.connect(this.chartData, this.config);

    // Sync incoming crosshair values (from parent input/output binding) into the store
    // so the overlay component can render them. Skip when this chart is hovered.
    // Updating on null is required so crosshair lines clear when the mouse leaves the source chart.
    effect(() => {
      const syncDate = this.syncCrosshairDate();
      const syncPrice = this.syncCrosshairPrice();
      if (!this.viewport.hovered()) {
        this.viewport.setCrosshair(syncDate, syncPrice);
      }
    });

    effect(() => {
      const data = this.chartData();
      if (data && data.bars.length > 0) {
        this.viewport.resetViewport();
        this.lastCrosshairIdx = -1;
        this.lastCrosshairPriceRounded = null;
      }
    });

    // Watch for container resize (e.g. fullscreen toggle) and refresh chart.
    // Throttle with requestAnimationFrame so multiple consecutive resize events
    // do not trigger repeated Syncfusion refreshes.
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.pendingResizeRaf) cancelAnimationFrame(this.pendingResizeRaf);
        this.pendingResizeRaf = requestAnimationFrame(() => {
          this.pendingResizeRaf = null;
          this.lifecycleFacade.refresh();
        });
      });
      this.resizeObserver.observe(this.el.nativeElement);
    });
  }

  ngOnDestroy(): void {
    if (this.pendingResizeRaf) cancelAnimationFrame(this.pendingResizeRaf);
    this.resizeObserver?.disconnect();
  }

  onChartMouseMove(event: IMouseEventArgs): void {
    // Run the fast path outside Angular change detection. Only re-enter the zone
    // when a store value actually changes.
    this.zone.runOutsideAngular(() => {
      const data = this.chartData();
      const state = this.lifecycleFacade.chartState();
      if (!data || data.bars.length === 0 || !state) return;

      let crosshairIdx = -1;
      let crosshairDate: Date | null = null;
      let crosshairPrice: number | null = null;

      // Map mouse X to the nearest bar index using the facade-captured axis snapshot
      const xAxis = state.xAxis;
      const pixelX = event.x - xAxis.rect.x;
      if (pixelX >= 0 && pixelX <= xAxis.rect.width) {
        const { min, delta } = xAxis.visibleRange;
        const idx = Math.round(min + (pixelX / xAxis.rect.width) * delta);
        if (idx >= 0 && idx < data.bars.length) {
          crosshairIdx = idx;
          crosshairDate = new Date(data.bars[idx].x);
        }
      }

      // Compute price from primary Y-axis under the mouse pointer, or fall back to the
      // hovered bar's close price when the cursor is in a lower indicator pane. This gives
      // a meaningful price to sync to the other charts so the horizontal crosshair can
      // propagate even when the mouse is not in the primary price pane.
      const yAxis = state.yAxis;
      const pixelY = event.y - yAxis.rect.y;
      const insidePrimaryY = pixelY >= 0 && pixelY <= yAxis.rect.height;
      if (insidePrimaryY) {
        crosshairPrice = this.yAxisController.priceFromPixel(
          yAxis.valueType === 'Logarithmic',
          pixelY,
          yAxis.rect,
          yAxis.visibleRange,
        );
      } else if (crosshairIdx !== -1) {
        const bar = data.bars[crosshairIdx];
        if (bar) crosshairPrice = bar.close;
      }

      // Move the hovered crosshair lines whenever the cursor is inside the chart's
      // X bounds — this includes the lower indicator panes.
      // The price label only follows when the cursor is inside the primary Y-axis.
      const insideX = pixelX >= 0 && pixelX <= xAxis.rect.width;
      if (insideX) {
        this.positionHoverCrosshair(event.x, event.y);
        if (insidePrimaryY) {
          this.positionPriceLabel(event.y);
        } else {
          this.hidePriceLabel();
        }
      } else {
        this.hideHoverCrosshair();
        this.hidePriceLabel();
      }

      // Sync to other charts whenever the hovered bar or rounded price changes.
      const priceRounded = crosshairPrice !== null ? Math.round(crosshairPrice) : null;
      const crosshairChanged =
        crosshairIdx !== -1 &&
        (crosshairIdx !== this.lastCrosshairIdx || priceRounded !== this.lastCrosshairPriceRounded);

      if (crosshairChanged || !this.viewport.hovered()) {
        this.zone.run(() => {
          if (!this.viewport.hovered()) {
            this.viewport.setHovered(true);
          }
          if (crosshairChanged) {
            this.lastCrosshairIdx = crosshairIdx;
            this.lastCrosshairPriceRounded = priceRounded;
            this.viewport.setHoveredPriceTop(event.y);
            if (crosshairDate) this.viewport.setCrosshairDate(crosshairDate);
            if (crosshairPrice !== null) this.viewport.setCrosshairPrice(crosshairPrice);
            this.broadcastCrosshair(crosshairDate, crosshairPrice);
          }
        });
      }
    });
  }

  onChartMouseLeave(): void {
    this.cancelPriceLabelRaf();
    this.cancelHoverCrosshairRaf();
    this.hideHoverCrosshair();
    this.viewport.setHovered(false);
    this.viewport.clearCrosshair();
    this.viewport.setHoveredPriceTop(null);
    this.lastCrosshairIdx = -1;
    this.lastCrosshairPriceRounded = null;
    this.broadcastCrosshair(null, null);
  }

  private positionHoverCrosshair(x: number, y: number): void {
    if (this.pendingHoverCrosshairRaf) {
      cancelAnimationFrame(this.pendingHoverCrosshairRaf);
    }
    this.pendingHoverCrosshairRaf = requestAnimationFrame(() => {
      this.pendingHoverCrosshairRaf = null;
      const vLine = this.hoverVLineEl;
      const hLine = this.hoverHLineEl;
      if (vLine && hLine) {
        vLine.style.display = 'block';
        hLine.style.display = 'block';
        vLine.style.left = `${x}px`;
        hLine.style.top = `${y}px`;
      }
    });
  }

  private hideHoverCrosshair(): void {
    if (this.hoverVLineEl) this.hoverVLineEl.style.display = 'none';
    if (this.hoverHLineEl) this.hoverHLineEl.style.display = 'none';
  }

  private cancelHoverCrosshairRaf(): void {
    if (this.pendingHoverCrosshairRaf) {
      cancelAnimationFrame(this.pendingHoverCrosshairRaf);
      this.pendingHoverCrosshairRaf = null;
    }
  }

  private positionPriceLabel(y: number): void {
    if (this.pendingPriceLabelRaf) {
      cancelAnimationFrame(this.pendingPriceLabelRaf);
    }
    this.pendingPriceLabelRaf = requestAnimationFrame(() => {
      this.pendingPriceLabelRaf = null;
      const label = this.priceLabelEl;
      if (label) {
        label.style.display = '';
        label.style.top = `${y}px`;
      }
    });
  }

  private hidePriceLabel(): void {
    if (this.priceLabelEl) {
      this.priceLabelEl.style.display = 'none';
    }
  }

  private cancelPriceLabelRaf(): void {
    if (this.pendingPriceLabelRaf) {
      cancelAnimationFrame(this.pendingPriceLabelRaf);
      this.pendingPriceLabelRaf = null;
    }
  }

  private broadcastCrosshair(date: Date | null, price: number | null): void {
    this.crosshairDateChange.emit(date);
    this.crosshairPriceChange.emit(price);
  }

  onChartLoaded(): void {
    // Refresh the captured axis state now that the chart has finished rendering
    // and the axis rects are available. This is required before mouse-move can
    // position the custom crosshair overlay.
    this.lifecycleFacade.refreshChartState();
  }

  onZoomComplete(event: IZoomCompleteEventArgs): void {
    if (!event.currentVisibleRange) return;
    this.lifecycleFacade.snapYAxisToVisibleRange(
      event.currentVisibleRange.min ?? 0,
      event.currentVisibleRange.max ?? 0,
    );
  }

  onScrollEnd(): void {
    this.lifecycleFacade.snapYAxisToCurrentVisibleRange();
  }
}
