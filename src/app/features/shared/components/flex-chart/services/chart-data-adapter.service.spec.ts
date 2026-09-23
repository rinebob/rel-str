import { ChartDataAdapter } from './chart-data-adapter.service';
import { StIndicator } from '../flex-chart.types';
import type { FlexChartConfig, FlexChartDataset, IndicatorConfig } from '../flex-chart.types';
import { signal } from '@angular/core';
import { toLogAxis } from '../strategies/log-transform';
import {
  ST_TREND_BANDS_INDICATOR,
  ST_TREND_STRENGTH_INDICATOR,
  ST_STD_DEV_LINES_INDICATOR,
  buildDefaultConfig,
} from '../indicators/indicator-registry';

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
      for (const f of ['open', 'high', 'low', 'close'] as const) {
        expect(log[i].data.map((p) => p[f])).toEqual(
          linear[i].data.map((p) => toLogAxis(p[f])),
        );
      }
    }
  });

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
