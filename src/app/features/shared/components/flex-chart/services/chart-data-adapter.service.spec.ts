import { ChartDataAdapter } from './chart-data-adapter.service';
import { StIndicator } from '../flex-chart.types';
import type { FlexChartConfig, FlexChartDataset, IndicatorConfig } from '../flex-chart.types';
import { signal } from '@angular/core';

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
