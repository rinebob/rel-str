import {
  ST_ANCHORED_VWAP_INDICATOR,
  ST_INDICATOR_OPTIONS,
  buildDefaultConfig,
  computeAnchoredVwapSeries,
} from './indicator-registry';
import { computeIndicators } from '../flex-chart-calculations';
import { StIndicator } from '../flex-chart.types';
import type { PriceBar } from '../flex-chart.types';

function bars(n: number): PriceBar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i / 3) * 20;
    return { date: `d${i}`, x: new Date(2026, 0, 1 + i), open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
  });
}

describe('indicator registry — ST Anchored VWAP', () => {
  it('is in the ST indicator menu, once', () => {
    expect(ST_INDICATOR_OPTIONS.filter((o) => o.type === StIndicator.ST_ANCHORED_VWAP)).toEqual([
      ST_ANCHORED_VWAP_INDICATOR,
    ]);
  });

  it('exports the series builder through the registry', () => {
    expect(computeAnchoredVwapSeries(bars(5), {})).toHaveLength(12);
  });

  it('builds a valid default config: overlay line series with every declared param', () => {
    const cfg = buildDefaultConfig(ST_ANCHORED_VWAP_INDICATOR);
    expect(cfg.id).toBe('st-anchored-vwap-default');
    expect(cfg.type).toBe(StIndicator.ST_ANCHORED_VWAP);
    expect(cfg.pane).toBe('overlay');
    expect(cfg.seriesType).toBe('line');
    expect(cfg.options.axisScale).toBe('price');
    expect(Object.keys(cfg.params)).toEqual(ST_ANCHORED_VWAP_INDICATOR.params.map((p) => p.key));
    expect(computeAnchoredVwapSeries(bars(40), cfg.params)).toHaveLength(12);
  });

  it('is tolerated by computeIndicators without a calculator: no throw, no generic points', () => {
    const cfg = buildDefaultConfig(ST_ANCHORED_VWAP_INDICATOR);
    expect(computeIndicators(bars(40), [cfg])).toEqual([{ id: cfg.id, config: cfg, data: [] }]);
  });
});
