import { pctChangeToColor } from './color-mapping.utils';

describe('pctChangeToColor', () => {
  it('returns white for pctChange === 0', () => {
    const color = pctChangeToColor(0, -10, 10);
    expect(color).toBe('rgb(255, 255, 255)');
  });

  it('returns white for degenerate range (p5 === p95 === 0)', () => {
    const color = pctChangeToColor(5, 0, 0);
    expect(color).toBe('rgb(255, 255, 255)');
  });

  it('returns max green for pctChange at the positive scale boundary', () => {
    // scale = max(|p5|, |p95|) = 10. pctChange=10 → intensity=1 → max green.
    const color = pctChangeToColor(10, -10, 10);
    expect(color).toBe('rgb(0, 140, 60)');
  });

  it('returns max red for pctChange at the negative scale boundary', () => {
    // scale = max(|p5|, |p95|) = 10. pctChange=-10 → intensity=1 → max red.
    const color = pctChangeToColor(-10, -10, 10);
    expect(color).toBe('rgb(200, 0, 0)');
  });

  it('clips pctChange beyond scale to max green', () => {
    const color = pctChangeToColor(50, -10, 10);
    expect(color).toBe('rgb(0, 140, 60)');
  });

  it('clips pctChange beyond scale to max red', () => {
    const color = pctChangeToColor(-50, -10, 10);
    expect(color).toBe('rgb(200, 0, 0)');
  });

  it('interpolates white-to-green for positive pctChange', () => {
    // scale=10, pctChange=5 → intensity=0.5
    // r = round(255 + (0-255)*0.5) = 128
    // g = round(255 + (140-255)*0.5) = 198
    // b = round(255 + (60-255)*0.5) = 158
    const color = pctChangeToColor(5, -10, 10);
    expect(color).toBe('rgb(128, 198, 158)');
  });

  it('interpolates white-to-red for negative pctChange', () => {
    // scale=10, pctChange=-5 → intensity=0.5
    // r = round(255 + (200-255)*0.5) = 228
    // g = round(255 + (0-255)*0.5) = 128
    // b = round(255 + (0-255)*0.5) = 128
    const color = pctChangeToColor(-5, -10, 10);
    expect(color).toBe('rgb(228, 128, 128)');
  });

  it('returns a valid CSS color string', () => {
    const color = pctChangeToColor(5, -10, 10);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('never mixes red and green — positive values have no red channel decrease', () => {
    // Positive: red channel goes from 255 → 0, green from 255 → 140.
    // The green channel never drops below 140 for positive values.
    const color = pctChangeToColor(10, -10, 10);
    const g = parseInt(color.match(/rgb\(\d+, (\d+), \d+\)/)![1], 10);
    expect(g).toBeGreaterThanOrEqual(140);
  });

  it('never mixes red and green — negative values have no green channel increase', () => {
    // Negative: green channel goes from 255 → 0, red from 255 → 200.
    // The red channel never drops below 200 for negative values.
    const color = pctChangeToColor(-10, -10, 10);
    const r = parseInt(color.match(/rgb\((\d+), \d+, \d+\)/)![1], 10);
    expect(r).toBeGreaterThanOrEqual(200);
  });

  it('handles all-positive range (p5 > 0)', () => {
    // scale = max(2, 10) = 10. pctChange=10 → intensity=1 → max green.
    const atMax = pctChangeToColor(10, 2, 10);
    expect(atMax).toBe('rgb(0, 140, 60)');
    // pctChange=0 → white
    const atZero = pctChangeToColor(0, 2, 10);
    expect(atZero).toBe('rgb(255, 255, 255)');
  });

  it('handles all-negative range (p95 < 0)', () => {
    // scale = max(10, 2) = 10. pctChange=-10 → intensity=1 → max red.
    const atMax = pctChangeToColor(-10, -10, -2);
    expect(atMax).toBe('rgb(200, 0, 0)');
    // pctChange=0 → white
    const atZero = pctChangeToColor(0, -10, -2);
    expect(atZero).toBe('rgb(255, 255, 255)');
  });
});
