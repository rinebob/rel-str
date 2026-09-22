/// <reference types="jest" />
/**
 * Synthetic data generator — determinism and edge-case coverage for the
 * flex-chart sandbox (Topic #468 / Task #478).
 */
import { generateSyntheticBars, SYNTHETIC_PRESETS, SYNTHETIC_BAR_COUNT } from './synthetic-data';

describe('generateSyntheticBars', () => {
  it('is deterministic — same preset+seed produces identical bars', () => {
    const a = generateSyntheticBars('wide-ratio');
    const b = generateSyntheticBars('wide-ratio');
    expect(a).toEqual(b);
  });

  it('different seeds produce different series', () => {
    const a = generateSyntheticBars('wide-ratio', 100, 1);
    const b = generateSyntheticBars('wide-ratio', 100, 2);
    expect(a).not.toEqual(b);
  });

  it('honors the requested bar count', () => {
    expect(generateSyntheticBars('penny', 60)).toHaveLength(60);
    expect(generateSyntheticBars('wide-ratio')).toHaveLength(SYNTHETIC_BAR_COUNT);
  });

  it('produces strictly increasing trading days (no weekends)', () => {
    const bars = generateSyntheticBars('penny', 100);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].x.getTime()).toBeGreaterThan(bars[i - 1].x.getTime());
    }
    for (const b of bars) {
      expect([0, 6]).not.toContain(b.x.getDay());
      expect(b.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // date must agree with x's LOCAL calendar day, not its UTC day.
      const local = `${b.x.getFullYear()}-${String(b.x.getMonth() + 1).padStart(2, '0')}-${String(b.x.getDate()).padStart(2, '0')}`;
      expect(b.date).toBe(local);
    }
  });

  it('wide-ratio spans at least a 10x low-to-high range', () => {
    const bars = generateSyntheticBars('wide-ratio');
    const lo = Math.min(...bars.map((b) => b.low));
    const hi = Math.max(...bars.map((b) => b.high));
    expect(hi / lo).toBeGreaterThanOrEqual(10);
  });

  it('penny stays sub-$1 and positive', () => {
    const bars = generateSyntheticBars('penny');
    const hi = Math.max(...bars.map((b) => b.high));
    const lo = Math.min(...bars.map((b) => b.low));
    expect(hi).toBeLessThan(1);
    expect(lo).toBeGreaterThan(0);
  });

  it('non-positive injects bars with lows at or below zero', () => {
    const bars = generateSyntheticBars('non-positive');
    expect(bars.some((b) => b.low <= 0)).toBe(true);
    // The fully corrupt bar exists and is a real bar in the array.
    expect(bars.some((b) => b.open === 0 && b.close === 0)).toBe(true);
  });

  it('non-positive corruption does not poison the walk — exactly one fully-zeroed bar, tail stays alive', () => {
    const bars = generateSyntheticBars('non-positive');
    expect(bars.filter((b) => b.open === 0 && b.close === 0)).toHaveLength(1);
    expect(bars[bars.length - 1].close).toBeGreaterThan(0);
    expect(bars[300].close).toBeGreaterThan(0);
  });

  it.each(SYNTHETIC_PRESETS.map((p) => p.value))(
    'preset %s produces finite OHLC on every bar',
    (preset) => {
      for (const b of generateSyntheticBars(preset)) {
        for (const v of [b.open, b.high, b.low, b.close]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }
    },
  );
});
