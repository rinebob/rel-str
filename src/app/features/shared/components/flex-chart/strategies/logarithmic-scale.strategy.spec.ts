/// <reference types="jest" />
/**
 * LogarithmicScaleStrategy — manual log transform on a Double axis.
 *
 * The built-in Syncfusion 'Logarithmic' valueType is a dead end (snaps to
 * powers of 10, ignores arbitrary min/max). This strategy instead emits a
 * plain Double axis whose values are log10(price) — transformed data is
 * bound to the series upstream, so extents/labels stay under our control.
 */
import { LogarithmicScaleStrategy } from './logarithmic-scale.strategy';
import type { PriceBar } from '../flex-chart.types';

function bar(low: number, high: number): PriceBar {
  return { date: '2026-01-01', x: new Date(2026, 0, 1), open: low, high, low, close: high };
}

describe('LogarithmicScaleStrategy', () => {
  const s = new LogarithmicScaleStrategy();

  it('transformValue is log10 with a floor clamp at 0.001', () => {
    expect(s.transformValue(100)).toBeCloseTo(2);
    expect(s.transformValue(1000)).toBeCloseTo(3);
    expect(s.transformValue(0)).toBeCloseTo(Math.log10(0.001));
    expect(s.transformValue(-42)).toBeCloseTo(Math.log10(0.001));
  });

  it('invertValue round-trips positive prices', () => {
    expect(s.invertValue(s.transformValue(753.21))).toBeCloseTo(753.21);
    expect(s.invertValue(2)).toBeCloseTo(100);
  });

  it('computeViewport returns log-space min/max over the visible bars with 3% padding', () => {
    const visible = [bar(600, 700), bar(566, 753)];
    const vp = s.computeViewport(visible);
    const lo = Math.log10(566);
    const hi = Math.log10(753);
    const pad = (hi - lo) * 0.03;
    expect(vp.min).toBeCloseTo(lo - pad);
    expect(vp.max).toBeCloseTo(hi + pad);
  });

  it('computeViewport handles empty visible bars', () => {
    const vp = s.computeViewport([]);
    expect(vp.min).toBe(0);
    expect(vp.max).toBe(1);
  });

  it('computeViewport degenerate flat range still yields a sane window', () => {
    const visible = [bar(500, 500)];
    const vp = s.computeViewport(visible);
    expect(vp.min).toBeLessThan(Math.log10(500));
    expect(vp.max).toBeGreaterThan(Math.log10(500));
  });

  it('computeViewport clamps non-positive lows to the floor', () => {
    const visible = [bar(0, 100)];
    const vp = s.computeViewport(visible);
    const lo = Math.log10(0.001);
    const hi = Math.log10(100);
    const pad = (hi - lo) * 0.03;
    expect(vp.min).toBeCloseTo(lo - pad);
    expect(vp.max).toBeCloseTo(hi + pad);
  });

  it('priceFromPixel returns the geometric midpoint at mid-height', () => {
    const range = { min: Math.log10(100), max: Math.log10(400), delta: Math.log10(400) - Math.log10(100) };
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(s.priceFromPixel(50, rect, range)).toBeCloseTo(200);
  });

  it('pixelFromPrice inverts priceFromPixel in price space', () => {
    const range = { min: Math.log10(100), max: Math.log10(400), delta: Math.log10(400) - Math.log10(100) };
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(s.pixelFromPrice(200, rect, range)).toBeCloseTo(50);
    expect(s.pixelFromPrice(100, rect, range)).toBeCloseTo(100);
    expect(s.pixelFromPrice(400, rect, range)).toBeCloseTo(0);
  });

  it('formatLabel receives log-space values and renders real prices', () => {
    expect(s.formatLabel(Math.log10(500))).toBe('$500');
    expect(s.formatLabel(3)).toBe('$1,000');
  });
});
