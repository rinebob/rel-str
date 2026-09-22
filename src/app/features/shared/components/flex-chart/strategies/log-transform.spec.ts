/// <reference types="jest" />
/**
 * Log-transform + nice-tick helpers — pure math behind the manual log scale.
 */
import {
  LOG_AXIS_FLOOR,
  toLogAxis,
  fromLogAxis,
  nicePriceStep,
  nicePriceTicks,
} from './log-transform';

describe('log transform', () => {
  it('toLogAxis is log10 with floor clamp', () => {
    expect(toLogAxis(100)).toBeCloseTo(2);
    expect(toLogAxis(0)).toBeCloseTo(Math.log10(LOG_AXIS_FLOOR));
    expect(toLogAxis(-7)).toBeCloseTo(Math.log10(LOG_AXIS_FLOOR));
  });

  it('fromLogAxis inverts positive prices', () => {
    expect(fromLogAxis(toLogAxis(753.21))).toBeCloseTo(753.21);
  });
});

describe('nicePriceStep', () => {
  it('picks a 1/2/5 × 10^n step near range/targetCount', () => {
    // 227 range / 10 ≈ 23 → 50
    expect(nicePriceStep(549, 776)).toBe(50);
    // ~165/10 ≈ 16.5 → 20
    expect(nicePriceStep(10, 175)).toBe(20);
    // ~990/10 = 99 → 100
    expect(nicePriceStep(10, 1000)).toBe(100);
    // tight range 0.8/10 ≈ 0.08 → 0.1
    expect(nicePriceStep(10.0, 10.8)).toBeCloseTo(0.1);
  });

  it('handles degenerate and inverted ranges without NaN', () => {
    expect(nicePriceStep(500, 500)).toBeGreaterThan(0);
    expect(nicePriceStep(0, 0)).toBeGreaterThan(0);
  });
});

describe('nicePriceTicks', () => {
  it('returns round multiples of the step inside the range', () => {
    expect(nicePriceTicks(549, 776)).toEqual([550, 600, 650, 700, 750]);
  });

  it('covers decade-scale ranges with round prices', () => {
    const ticks = nicePriceTicks(10, 1000);
    expect(ticks).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
  });

  it('produces at least one tick for a tight range', () => {
    const ticks = nicePriceTicks(600, 601);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
  });
});
