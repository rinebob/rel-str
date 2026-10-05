import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FlexChartComponent } from './flex-chart.component';
import { CHART_PALETTES } from '@flex-chart/theme';

describe('FlexChartComponent logScale default', () => {
  let fixture: ComponentFixture<FlexChartComponent>;
  let component: FlexChartComponent;
  let originalResizeObserver: unknown;

  beforeAll(() => {
    originalResizeObserver = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    };
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlexChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlexChartComponent);
    component = fixture.componentRef.instance;
  });

  it('defaults logScale to true when the parent omits it', () => {
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [] });
    expect(component.effectiveConfig().logScale).toBe(true);
    // Observable effect: log mode hides generated gridlines via the strategy.
    expect(component.primaryYAxis().majorGridLines?.width).toBe(0);
  });

  it('respects logScale: false when the parent supplies it', () => {
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [], logScale: false });
    expect(component.effectiveConfig().logScale).toBe(false);
    expect(component.primaryYAxis().majorGridLines?.width).not.toBe(0);
  });

  it('defaults logScale to true when the parent passes undefined', () => {
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [], logScale: undefined });
    expect(component.effectiveConfig().logScale).toBe(true);
  });
});

// =============================================================================
// Appearance theming — Topic #213 / Task #733
//
// `appearance` selects the chart palette; dark is the product default and
// light must preserve the pre-theme chrome values.
// =============================================================================

describe('FlexChartComponent appearance', () => {
  let fixture: ComponentFixture<FlexChartComponent>;
  let component: FlexChartComponent;
  let originalResizeObserver: unknown;

  beforeAll(() => {
    originalResizeObserver = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    };
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlexChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlexChartComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('chartData', null);
  });

  it('defaults appearance to dark when the parent omits it', () => {
    fixture.componentRef.setInput('config', { indicators: [] });
    expect(component.effectiveConfig().appearance).toBe('dark');
    expect(component.palette()).toBe(CHART_PALETTES.dark);
  });

  it('selects the light palette when appearance is light', () => {
    fixture.componentRef.setInput('config', { indicators: [], appearance: 'light' });
    expect(component.effectiveConfig().appearance).toBe('light');
    expect(component.palette()).toBe(CHART_PALETTES.light);
  });

  it('paints primary axis labels with the palette axis text color', () => {
    fixture.componentRef.setInput('config', { indicators: [] });
    expect(component.primaryXAxis().labelStyle?.color).toBe(CHART_PALETTES.dark.axisText);
    expect(component.primaryYAxis().labelStyle?.color).toBe(CHART_PALETTES.dark.axisText);
  });

  it('paints primary axis labels light-appearance colors under light', () => {
    fixture.componentRef.setInput('config', { indicators: [], appearance: 'light' });
    expect(component.primaryXAxis().labelStyle?.color).toBe(CHART_PALETTES.light.axisText);
    expect(component.primaryYAxis().labelStyle?.color).toBe(CHART_PALETTES.light.axisText);
  });

  it('tags the chart wrapper with the appearance class and theme vars', () => {
    fixture.componentRef.setInput('config', { indicators: [] });
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('.flex-chart-wrapper') as HTMLElement;
    expect(wrapper.classList.contains('fc-dark')).toBe(true);
    expect(wrapper.classList.contains('fc-light')).toBe(false);
    expect(wrapper.style.getPropertyValue('--fc-bg')).toBe(CHART_PALETTES.dark.background);
    expect(wrapper.style.getPropertyValue('--fc-crosshair-line')).toBe(CHART_PALETTES.dark.crosshairLine);
  });

  it('switches the wrapper class and vars for the light appearance', () => {
    fixture.componentRef.setInput('config', { indicators: [], appearance: 'light' });
    fixture.detectChanges();
    const wrapper = fixture.nativeElement.querySelector('.flex-chart-wrapper') as HTMLElement;
    expect(wrapper.classList.contains('fc-light')).toBe(true);
    expect(wrapper.classList.contains('fc-dark')).toBe(false);
    expect(wrapper.style.getPropertyValue('--fc-bg')).toBe(CHART_PALETTES.light.background);
  });
});

// =============================================================================
// Rect-series overlap — Topic #213 / Task #739
//
// Syncfusion places every rect-type series (Candle, Column) in the same pane
// side-by-side within the category slot — 5 candle series carve each day into
// 5 strips. The chart opts out so all rect series overlap at the bar center.
// =============================================================================

describe('FlexChartComponent rect-series overlap', () => {
  let fixture: ComponentFixture<FlexChartComponent>;
  let component: FlexChartComponent;
  let originalResizeObserver: unknown;

  beforeAll(() => {
    originalResizeObserver = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    };
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlexChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlexChartComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('chartData', null);
    fixture.componentRef.setInput('config', { indicators: [] });
  });

  it('disables side-by-side placement so candles and histograms share the bar center', () => {
    expect(component.seriesPlacement.enableSideBySidePlacement).toBe(false);
  });
});

// =============================================================================
// mainPanePercent — Topic #213 / Task #735
//
// The main price pane's vertical share defaults to 60%; lower panes split the
// remainder. The pane-split math itself lives in ChartDataAdapter specs.
// =============================================================================

describe('FlexChartComponent mainPanePercent', () => {
  let fixture: ComponentFixture<FlexChartComponent>;
  let component: FlexChartComponent;
  let originalResizeObserver: unknown;

  beforeAll(() => {
    originalResizeObserver = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    };
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlexChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlexChartComponent);
    component = fixture.componentRef.instance;
    fixture.componentRef.setInput('chartData', null);
  });

  it('defaults mainPanePercent to 60 when the parent omits it', () => {
    fixture.componentRef.setInput('config', { indicators: [] });
    expect(component.effectiveConfig().mainPanePercent).toBe(60);
  });

  it('honors an explicit mainPanePercent', () => {
    fixture.componentRef.setInput('config', { indicators: [], mainPanePercent: 80 });
    expect(component.effectiveConfig().mainPanePercent).toBe(80);
  });
});

// =============================================================================
// Crosshair clamping regression
//
// If a series (e.g. ST Trend Bands from a larger bar set) stretches the captured
// visible range beyond the current dataset, the crosshair must not return a date
// past the last real bar.
// =============================================================================

describe('FlexChartComponent crosshair clamping', () => {
  let fixture: ComponentFixture<FlexChartComponent>;
  let component: FlexChartComponent;
  let originalResizeObserver: unknown;

  beforeAll(() => {
    originalResizeObserver = (globalThis as Record<string, unknown>).ResizeObserver;
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe = jest.fn();
      disconnect = jest.fn();
      unobserve = jest.fn();
    };
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).ResizeObserver = originalResizeObserver;
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FlexChartComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(FlexChartComponent);
    component = fixture.componentRef.instance;
  });

  it('clamps crosshair index to the last bar when the axis visible range is wider than the dataset', () => {
    const bars = Array.from({ length: 10 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      x: new Date(2026, 0, i + 1),
      open: 1,
      high: 2,
      low: 0.5,
      close: 1.5,
      volume: 1,
    }));
    fixture.componentRef.setInput('chartData', { bars, interval: '1d' } as any);
    fixture.componentRef.setInput('config', { indicators: [] });
    fixture.detectChanges();

    const facade = (component as any)['lifecycleFacade'];
    facade['chartStateSignal'].set({
      xAxis: {
        rect: { x: 0, y: 0, width: 100, height: 0 },
        visibleRange: { min: 0, max: 18, delta: 18 },
      },
      yAxis: {
        rect: { x: 0, y: 0, width: 100, height: 100 },
        visibleRange: { min: 0, max: 2, delta: 2 },
      },
    });

    // Cursor at the far right edge; raw index would be 18, but only 10 bars exist.
    component.onChartMouseMove({ x: 100, y: 200 } as any);

    expect(component.hoveredDate()).toBe('Jan 10, 2026');
    expect((component as any)['lastCrosshairIdx']).toBe(9);
  });
});
