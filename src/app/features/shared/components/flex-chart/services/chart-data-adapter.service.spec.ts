import { ChartDataAdapter } from './chart-data-adapter.service';
import { CHART_PALETTES } from '@flex-chart/theme';
import { StIndicator } from '../flex-chart.types';
import type { FlexChartConfig, FlexChartDataset, IndicatorConfig, IndicatorPane } from '../flex-chart.types';
import { signal } from '@angular/core';
import { toLogAxis } from '@flex-chart/scale-math';
import type { BandSeriesData } from '../indicators/st-trend-bands.indicator';
import {
  ST_TREND_BANDS_INDICATOR,
  ST_TREND_STRENGTH_INDICATOR,
  ST_STD_DEV_LINES_INDICATOR,
  ST_TRIGGER_BANDS_INDICATOR,
  buildDefaultConfig,
} from '../indicators/indicator-registry';
import type { TriggerBandPoint } from '../indicators/st-trigger-bands.indicator';

// =============================================================================
// Test helpers
// =============================================================================

function makeBars(count: number): FlexChartDataset {
  const bars = [];
  for (let i = 0; i < count; i++) {
    const base = 100;
    const swing = Math.sin(i * 0.5) * 20;
    bars.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      x: new Date(2026, 0, i + 1),
      open: base + swing - 1,
      high: base + swing + 2,
      low: base + swing - 2,
      close: base + swing,
      volume: 1000,
    });
  }
  return { bars, interval: '1d' } as unknown as FlexChartDataset;
}

function makeZigZagConfig(id: string, lineColor?: string): IndicatorConfig {
  const params: Record<string, number | string | boolean> = {
    devThreshold: 5,
    leftDepth: 2,
    rightDepth: 2,
    allowZigZagOnOneBar: true,
    projectionPivots: false,
  };
  if (lineColor) params['lineColor'] = lineColor;
  return {
    id,
    type: StIndicator.ST_ZIGZAG,
    pane: 'overlay',
    seriesType: 'line',
    params,
    options: { name: 'ST-ZIGZAG' },
  };
}

function makeTrendBandConfig(bandData?: BandSeriesData[]): IndicatorConfig {
  const cfg = buildDefaultConfig(ST_TREND_BANDS_INDICATOR);
  return bandData ? { ...cfg, bandData } : cfg;
}

function makeBandData(indices: number[], dates: Date[], bandCount = 4): BandSeriesData[] {
  const colors: [string, string][] = [
    ['#ffeb3b', '#2196f3'],
    ['#ffeb3b', '#2196f3'],
    ['#ff9800', '#1565c0'],
    ['#ff9800', '#1565c0'],
  ];
  return Array.from({ length: bandCount }, (_, bandIdx) => ({
    bandIndex: bandIdx + 1,
    bullColor: colors[bandIdx][0],
    bearColor: colors[bandIdx][1],
    data: indices.map((index, i) => ({
      index,
      date: dates[i],
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100.5 + index,
    })),
  }));
}

function setupAdapter(data: FlexChartDataset | null, config: FlexChartConfig): ChartDataAdapter {
  const adapter = new ChartDataAdapter();
  adapter.connect(signal(data), signal(config));
  return adapter;
}

// =============================================================================
// ChartDataAdapter.zigZagSeries — multi-instance support
// =============================================================================

describe('ChartDataAdapter.zigZagSeries', () => {
  it('returns empty array when no ST_ZIGZAG configs exist', () => {
    const data = makeBars(20);
    const config: FlexChartConfig = { indicators: [] };
    const adapter = setupAdapter(data, config);
    expect(adapter.zigZagSeries()).toEqual([]);
  });

  it('returns empty array when data is null', () => {
    const config: FlexChartConfig = { indicators: [makeZigZagConfig('zz1')] };
    const adapter = setupAdapter(null, config);
    expect(adapter.zigZagSeries()).toEqual([]);
  });

  it('returns array of length 1 for a single ST_ZIGZAG config (backward compat)', () => {
    const data = makeBars(20);
    const config: FlexChartConfig = { indicators: [makeZigZagConfig('zz1')] };
    const adapter = setupAdapter(data, config);
    const result = adapter.zigZagSeries();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns array of length 2 for two ST_ZIGZAG configs', () => {
    const data = makeBars(20);
    const config: FlexChartConfig = {
      indicators: [
        makeZigZagConfig('zz1', '#1976d2'),
        makeZigZagConfig('zz2', '#ff0000'),
      ],
    };
    const adapter = setupAdapter(data, config);
    const result = adapter.zigZagSeries();
    expect(result).toHaveLength(2);
  });

  it('produces distinct keys for each instance', () => {
    const data = makeBars(20);
    const config: FlexChartConfig = {
      indicators: [
        makeZigZagConfig('zz1'),
        makeZigZagConfig('zz2'),
      ],
    };
    const adapter = setupAdapter(data, config);
    const result = adapter.zigZagSeries();
    const allKeys = result.flatMap(zz => zz.lines.map(l => l.key));
    const uniqueKeys = new Set(allKeys);
    expect(allKeys.length).toBe(uniqueKeys.size);
  });

  it('passes lineColor from params through to the series', () => {
    const data = makeBars(20);
    const config: FlexChartConfig = {
      indicators: [makeZigZagConfig('zz1', '#00ff00')],
    };
    const adapter = setupAdapter(data, config);
    const result = adapter.zigZagSeries();
    if (result[0].lines.length > 0) {
      expect(result[0].lines[0].color).toBe('#00ff00');
    }
  });

  it('namespaces line keys with the indicator instance id', () => {
    const data = makeBars(20);
    const config: FlexChartConfig = {
      indicators: [makeZigZagConfig('my-zz')],
    };
    const adapter = setupAdapter(data, config);
    const result = adapter.zigZagSeries();
    if (result[0].lines.length > 0) {
      expect(result[0].lines[0].key.startsWith('my-zz-')).toBe(true);
    }
  });
});

// =============================================================================
// Log transform — ST indicator series (Topic #468 / Task #482)
//
// Overlays on the price pane are prices, so every y/OHLC field lands in
// log10 space under logScale. Lower-pane ST indicators (trend strength,
// zones) are in native units and must pass through untransformed.
// =============================================================================

describe('ChartDataAdapter — log transform of ST indicators', () => {
  it('zigzag line prices land in log space under logScale', () => {
    const data = makeBars(40);
    const cfg = (log: boolean): FlexChartConfig => ({
      indicators: [makeZigZagConfig('zz1')],
      logScale: log,
    });
    const linear = setupAdapter(data, cfg(false)).zigZagSeries();
    const log = setupAdapter(data, cfg(true)).zigZagSeries();
    expect(log).toHaveLength(1);
    expect(linear[0].lines.length).toBeGreaterThan(0);
    for (let i = 0; i < linear[0].lines.length; i++) {
      expect(log[0].lines[i].data.map((p) => p.y)).toEqual(
        linear[0].lines[i].data.map((p) => toLogAxis(p.y)),
      );
    }
  });

  it('std-dev lines land in log space under logScale', () => {
    // period defaults to 50 — the fixture must clear it.
    const data = makeBars(120);
    const cfg = (log: boolean): FlexChartConfig => ({
      indicators: [buildDefaultConfig(ST_STD_DEV_LINES_INDICATOR)],
      logScale: log,
    });
    const linear = setupAdapter(data, cfg(false)).stdDevLineSeries();
    const log = setupAdapter(data, cfg(true)).stdDevLineSeries();
    expect(linear.lines.length).toBeGreaterThan(0);
    expect(log.lines.length).toBe(linear.lines.length);
    for (let i = 0; i < linear.lines.length; i++) {
      expect(log.lines[i].data.map((p) => p.y)).toEqual(
        linear.lines[i].data.map((p) => toLogAxis(p.y)),
      );
    }
  });

  it('trend-band candles land in log space under logScale', () => {
    const data = makeBars(40);
    const cfg = (log: boolean): FlexChartConfig => ({
      indicators: [buildDefaultConfig(ST_TREND_BANDS_INDICATOR)],
      logScale: log,
    });
    const linear = setupAdapter(data, cfg(false)).trendBandSeries();
    const log = setupAdapter(data, cfg(true)).trendBandSeries();
    expect(linear.length).toBeGreaterThan(0);
    expect(log.length).toBe(linear.length);
    for (let i = 0; i < linear.length; i++) {
      const linearPoints = linear[i].data.filter((p) => p.open != null);
      const logPoints = log[i].data.filter((p) => p.open != null);
      for (const f of ['open', 'high', 'low', 'close'] as const) {
        expect(logPoints.map((p) => p[f])).toEqual(
          linearPoints.map((p) => toLogAxis(p[f] as number)),
        );
      }
    }
  });

});

// =============================================================================
// ST Trend Bands — index bounds and crosshair alignment regression
//
// Trend-band data can arrive from the callable pre-computed against a larger
// bar set than the clipped chart currently displays. The adapter must rebase
// by date and drop any point that falls outside the current category range,
// otherwise Syncfusion expands the Category X-axis and the custom crosshair
// reads an off-by-N date.
// =============================================================================

describe('ChartDataAdapter.trendBandSeries — index bounds and date alignment', () => {
  it('keeps fallback band indices within [0, bars.length - 1]', () => {
    const data = makeBars(40);
    const adapter = setupAdapter(data, { indicators: [makeTrendBandConfig()] });
    const bands = adapter.trendBandSeries();
    expect(bands.length).toBe(4);
    for (const band of bands) {
      const indices = band.data.map((p) => p.index);
      expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...indices)).toBeLessThan(data.bars.length);
    }
  });

  it('category bar count equals the original bar count', () => {
    const data = makeBars(40);
    const adapter = setupAdapter(data, { indicators: [makeTrendBandConfig()] });
    expect(adapter.categoryBars()).toHaveLength(data.bars.length);
  });

  it('drops callable band points whose stored index is beyond the current bar range', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const data = makeBars(10);
    // Pretend the backend computed against 18 bars and stored raw indices 0..17.
    const dates = Array.from({ length: 18 }, (_, i) => new Date(2026, 0, i + 1));
    const indices = dates.map((_, i) => i);
    const bandData = makeBandData(indices, dates);
    const adapter = setupAdapter(data, { indicators: [makeTrendBandConfig(bandData)] });
    const bands = adapter.trendBandSeries();
    for (const band of bands) {
      const indices = band.data.map((p) => p.index);
      expect(indices.length).toBeLessThanOrEqual(data.bars.length);
      expect(Math.max(...indices)).toBeLessThan(data.bars.length);
      expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
    }
    warnSpy.mockRestore();
  });

  it('rebases callable band points by date when stored indices came from a larger bar set', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const data = makeBars(10); // dates 2026-01-01 .. 2026-01-10
    // Backend indices are offset by +100, but the dates still match the current bars.
    const dates = data.bars.map((b) => b.x);
    const indices = dates.map((_, i) => i + 100);
    const bandData = makeBandData(indices, dates);
    const adapter = setupAdapter(data, { indicators: [makeTrendBandConfig(bandData)] });
    const bands = adapter.trendBandSeries();
    for (const band of bands) {
      expect(band.data.map((p) => p.index)).toEqual(dates.map((_, i) => i));
    }
    warnSpy.mockRestore();
  });

  it('sorts band data by index even when the callable response is newest-first', () => {
    const data = makeBars(10);
    const dates = data.bars.map((b) => b.x);
    // Send the points in reverse date order, as some backend responses do.
    const reversedDates = [...dates].reverse();
    const reversedIndices = reversedDates.map((_, i) => data.bars.length - 1 - i);
    const bandData = makeBandData(reversedIndices, reversedDates);
    const adapter = setupAdapter(data, { indicators: [makeTrendBandConfig(bandData)] });
    const bands = adapter.trendBandSeries();
    for (const band of bands) {
      expect(band.data.map((p) => p.index)).toEqual(dates.map((_, i) => i));
    }
  });

});

// =============================================================================
// Appearance theming — Topic #213 / Task #733
//
// chartAxes paints the lower-pane chrome (axis line, gridlines, label text)
// from the resolved palette. Dark is the default; light preserves the
// pre-theme greys.
// =============================================================================

describe('ChartDataAdapter — appearance theming', () => {
  it('paints lower axes with the dark palette when appearance is omitted', () => {
    const adapter = setupAdapter(makeBars(10), { indicators: [] });
    const axis = adapter.chartAxes()[0];
    expect(axis.lineStyle.color).toBe(CHART_PALETTES.dark.axisLine);
    expect(axis.majorGridLines.color).toBe(CHART_PALETTES.dark.gridLine);
    expect(axis.labelStyle.color).toBe(CHART_PALETTES.dark.axisText);
  });

  it('preserves the pre-theme greys under the light appearance', () => {
    const adapter = setupAdapter(makeBars(10), { indicators: [], appearance: 'light' });
    const axis = adapter.chartAxes()[0];
    expect(axis.lineStyle.color).toBe('#9e9e9e');
    expect(axis.majorGridLines.color).toBe('rgba(158,158,158,0.3)');
    expect(axis.labelStyle.color).toBe('#686868');
  });

  it('remaps emitted per-point colors to the dark palette (trend-strength histogram)', () => {
    const data = makeBars(60);
    const config: FlexChartConfig = {
      indicators: [buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR)],
    };
    const adapter = setupAdapter(data, config);
    const colors = adapter.computedSeries()[0].data
      .map((p) => p.color)
      .filter((c): c is string => !!c);
    expect(colors.length).toBeGreaterThan(0);
    expect(colors).not.toContain('#2196f3');
    expect(colors).toContain('#3da5ff');
  });

  it('remaps emitted colors through precomputed config.data (signal dots)', () => {
    const dotIndicator: IndicatorConfig = {
      id: 'dots',
      type: StIndicator.SIGNAL_DOTS,
      pane: 'lower-1',
      seriesType: 'scatter',
      params: {},
      options: {},
      data: [
        { x: new Date(2026, 0, 5), y: 5, color: '#4caf50' },
        { x: new Date(2026, 0, 6), y: -5, color: '#f44336' },
      ],
    };
    const adapter = setupAdapter(makeBars(10), { indicators: [dotIndicator] });
    const colors = adapter.computedSeries()[0].data.map((p) => p.color);
    expect(colors).toEqual(['#33d17a', '#ff5252']);
  });

  it('leaves explicit non-vocabulary colors untouched in dark mode', () => {
    const dotIndicator: IndicatorConfig = {
      id: 'dots',
      type: StIndicator.SIGNAL_DOTS,
      pane: 'lower-1',
      seriesType: 'scatter',
      params: {},
      options: { color: '#123456' },
      data: [{ x: new Date(2026, 0, 5), y: 5, color: '#123456' }],
    };
    const adapter = setupAdapter(makeBars(10), { indicators: [dotIndicator] });
    const series = adapter.computedSeries()[0];
    expect(series.data[0].color).toBe('#123456');
    expect(series.config.options.color).toBe('#123456');
  });

  it('keeps emitted indicator colors identical under the light appearance', () => {
    const data = makeBars(60);
    const config: FlexChartConfig = {
      indicators: [buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR)],
      appearance: 'light',
    };
    const adapter = setupAdapter(data, config);
    const colors = adapter.computedSeries()[0].data
      .map((p) => p.color)
      .filter((c): c is string => !!c);
    expect(colors).toContain('#2196f3');
  });

  it('remaps trend-band candle colors under the dark appearance', () => {
    const data = makeBars(40);
    const config: FlexChartConfig = {
      indicators: [buildDefaultConfig(ST_TREND_BANDS_INDICATOR)],
    };
    const adapter = setupAdapter(data, config);
    const bands = adapter.trendBandSeries();
    expect(bands.length).toBeGreaterThan(0);
    // Band 3/4 up color: '#ff9800' → band yellow; down '#1565c0' → band blue.
    expect(bands[2].bullColor).toBe('#ffeb3b');
    expect(bands[2].bearColor).toBe('#3da5ff');
  });

  it('remaps baked defaultOptions series colors (options.color / color2)', () => {
    const data = makeBars(60);
    const config: FlexChartConfig = {
      indicators: [buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR)],
    };
    const adapter = setupAdapter(data, config);
    const options = adapter.computedSeries()[0].config.options;
    expect(options.color).toBe('#3da5ff');
    expect(options.color2).toBe('#4d8dff');
  });
});

// =============================================================================
// chartRows — mainPanePercent split (Task #735)
//
// Row heights: [lower-1..lower-4, main]. Inactive lower panes collapse to 0%;
// the remainder after `mainPanePercent` splits evenly across active panes and
// the Math.floor residue lands back on the main pane.
// =============================================================================

describe('ChartDataAdapter.chartRows — mainPanePercent', () => {
  const lowerIndicator = (id: string, pane: IndicatorPane): IndicatorConfig => ({
    ...buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR),
    id,
    pane,
  });

  const rowHeights = (config: FlexChartConfig, bars = 60) =>
    setupAdapter(makeBars(bars), config).chartRows().map((r) => r.height);

  it('collapses all lower panes to 0% and gives main 100% with no indicators', () => {
    expect(rowHeights({ indicators: [] })).toEqual(['0%', '0%', '0%', '0%', '100%']);
  });

  it('defaults the main pane to 60% and one active lower pane to 40%', () => {
    expect(rowHeights({ indicators: [lowerIndicator('ts', 'lower-1')] })).toEqual([
      '40%', '0%', '0%', '0%', '60%',
    ]);
  });

  it('splits the remainder evenly across three active panes; floor residue lands on main', () => {
    const result = rowHeights({
      indicators: [
        lowerIndicator('a', 'lower-1'),
        lowerIndicator('b', 'lower-2'),
        lowerIndicator('c', 'lower-3'),
      ],
    });
    // 40% / 3 → 13% each, main takes 100 - 39 = 61%.
    expect(result).toEqual(['13%', '13%', '13%', '0%', '61%']);
  });

  it('honors an explicit mainPanePercent override', () => {
    const result = rowHeights({
      indicators: [lowerIndicator('ts', 'lower-1')],
      mainPanePercent: 80,
    });
    expect(result).toEqual(['20%', '0%', '0%', '0%', '80%']);
  });

  it('clamps out-of-range values so no row goes negative or zero-height', () => {
    expect(rowHeights({ indicators: [lowerIndicator('ts', 'lower-1')], mainPanePercent: 0 })).toEqual([
      '80%', '0%', '0%', '0%', '20%',
    ]);
    expect(rowHeights({ indicators: [lowerIndicator('ts', 'lower-1')], mainPanePercent: 200 })).toEqual([
      '5%', '0%', '0%', '0%', '95%',
    ]);
  });

  it('paints every row border in the palette paneDivider color', () => {
    const rows = setupAdapter(makeBars(60), {
      indicators: [lowerIndicator('ts', 'lower-1')],
    }).chartRows();
    for (const row of rows) {
      expect(row.border).toEqual({ color: CHART_PALETTES.dark.paneDivider, width: 1 });
    }
  });
});

describe('ChartDataAdapter — log transform of ST indicators', () => {
  it('lower-pane ST indicator series stay in native units under logScale', () => {
    const data = makeBars(40);
    const cfg = (log: boolean): FlexChartConfig => ({
      indicators: [buildDefaultConfig(ST_TREND_STRENGTH_INDICATOR)],
      logScale: log,
    });
    const linear = setupAdapter(data, cfg(false)).computedSeries();
    const log = setupAdapter(data, cfg(true)).computedSeries();
    expect(linear.length).toBe(1);
    expect(linear[0].data.length).toBeGreaterThan(0);
    // No transform — identical data regardless of scale.
    expect(log[0].data).toEqual(linear[0].data);
  });
});

// =============================================================================
// ChartDataAdapter.triggerBandSeries - two state-coloured band lines (#879, revised to MultiColoredLine after sandbox UAT)
// =============================================================================

describe('ChartDataAdapter.triggerBandSeries', () => {
  function triggerConfig(points?: TriggerBandPoint[]): IndicatorConfig {
    const cfg = buildDefaultConfig(ST_TRIGGER_BANDS_INDICATOR);
    return points ? { ...cfg, triggerBandData: points } : cfg;
  }

  function pointsFor(data: FlexChartDataset): TriggerBandPoint[] {
    // Bar 0 carries null band values, like the engine's 3-bar warm-up.
    return data.bars.map((bar, i) => ({
      date: bar.x,
      upper: i === 0 ? null : bar.high + 1,
      lower: i === 0 ? null : bar.low - 1,
      upperState: i % 5 === 3 ? 'pullback' : i % 7 === 6 ? 'breakout' : 'neutral',
      lowerState: i % 4 === 2 ? 'pullback' : 'neutral',
    }));
  }

  it('is empty when no trigger-bands indicator is configured', () => {
    const adapter = setupAdapter(makeBars(20), { indicators: [] });
    expect(adapter.triggerBandSeries()).toEqual([]);
  });

  it('is empty when the indicator has no callable data yet', () => {
    const adapter = setupAdapter(makeBars(20), { indicators: [triggerConfig()] });
    expect(adapter.triggerBandSeries()).toEqual([]);
  });

  it('is empty when there is no dataset', () => {
    const adapter = setupAdapter(null, { indicators: [triggerConfig([])] });
    expect(adapter.triggerBandSeries()).toEqual([]);
  });

  it('maps callable points onto the bar index axis, step-expanded hinge + level rows', () => {
    const data = makeBars(20);
    const adapter = setupAdapter(data, { indicators: [triggerConfig(pointsFor(data))] });
    const lines = adapter.triggerBandSeries();
    expect(lines.map((l) => l.key)).toEqual(['trigger-upper', 'trigger-lower']);
    const upper = lines.find((l) => l.band === 'upper')!;
    // Level row at each valued bar carries that bar's band value; the bar-0
    // warm-up row stays null.
    expect(upper.data[0].y).toBeNull();
    for (let i = 1; i < 20; i++) {
      const level = upper.data.filter((p) => p.index === i && p.y === data.bars[i].high + 1);
      expect(level).toHaveLength(1);
    }
  });

  it('prices land in log space under logScale; gaps stay null', () => {
    const data = makeBars(20);
    const cfg = (log: boolean): FlexChartConfig => ({
      indicators: [triggerConfig(pointsFor(data))],
      logScale: log,
    });
    const linear = setupAdapter(data, cfg(false)).triggerBandSeries();
    const log = setupAdapter(data, cfg(true)).triggerBandSeries();
    expect(log).toHaveLength(linear.length);
    for (let i = 0; i < linear.length; i++) {
      expect(log[i].data.map((p) => p.y)).toEqual(
        linear[i].data.map((p) => (p.y === null ? null : toLogAxis(p.y))),
      );
    }
    expect(linear.some((l) => l.data.some((p) => p.y === null))).toBe(true);
  });

  it('does not appear as a computed main-pane series with data (no calculator, no generic line)', () => {
    const data = makeBars(20);
    const adapter = setupAdapter(data, { indicators: [triggerConfig(pointsFor(data))] });
    const mine = adapter.mainPaneSeries().find((s) => s.config.type === StIndicator.ST_TRIGGER_BANDS);
    expect(mine?.data ?? []).toEqual([]);
  });
});