import { pctChangeToCellColors } from './color-mapping.utils';

/** Ramp assertions run against 'adaptive' mode — it uses the deep ramp
 *  (white → rgb(0,140,60) / rgb(200,0,0)). */
const bg = (pct: number, p5: number, p95: number) =>
  pctChangeToCellColors(pct, p5, p95, 'adaptive').bg;

describe('pctChangeToCellColors ramp', () => {
  it('returns white for pctChange === 0', () => {
    expect(bg(0, -10, 10)).toBe('rgb(255, 255, 255)');
  });

  it('returns white for degenerate range (p5 === p95 === 0)', () => {
    expect(bg(5, 0, 0)).toBe('rgb(255, 255, 255)');
  });

  it('returns max green for pctChange at the positive scale boundary', () => {
    // scale = max(|p5|, |p95|) = 10. pctChange=10 → intensity=1 → max green.
    expect(bg(10, -10, 10)).toBe('rgb(0, 140, 60)');
  });

  it('returns max red for pctChange at the negative scale boundary', () => {
    // scale = max(|p5|, |p95|) = 10. pctChange=-10 → intensity=1 → max red.
    expect(bg(-10, -10, 10)).toBe('rgb(200, 0, 0)');
  });

  it('clips pctChange beyond scale to max green', () => {
    expect(bg(50, -10, 10)).toBe('rgb(0, 140, 60)');
  });

  it('clips pctChange beyond scale to max red', () => {
    expect(bg(-50, -10, 10)).toBe('rgb(200, 0, 0)');
  });

  it('interpolates white-to-green for positive pctChange', () => {
    // scale=10, pctChange=5 → intensity=0.5
    // r = round(255 + (0-255)*0.5) = 128
    // g = round(255 + (140-255)*0.5) = 198
    // b = round(255 + (60-255)*0.5) = 158
    expect(bg(5, -10, 10)).toBe('rgb(128, 198, 158)');
  });

  it('interpolates white-to-red for negative pctChange', () => {
    // scale=10, pctChange=-5 → intensity=0.5
    // r = round(255 + (200-255)*0.5) = 228
    // g = round(255 + (0-255)*0.5) = 128
    // b = round(255 + (0-255)*0.5) = 128
    expect(bg(-5, -10, 10)).toBe('rgb(228, 128, 128)');
  });

  it('returns a valid CSS color string', () => {
    expect(bg(5, -10, 10)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('never mixes red and green — positive values have no red channel decrease', () => {
    // Positive: red channel goes from 255 → 0, green from 255 → 140.
    // The green channel never drops below 140 for positive values.
    const g = parseInt(bg(10, -10, 10).match(/rgb\(\d+, (\d+), \d+\)/)![1], 10);
    expect(g).toBeGreaterThanOrEqual(140);
  });

  it('never mixes red and green — negative values have no green channel increase', () => {
    // Negative: green channel goes from 255 → 0, red from 255 → 200.
    // The red channel never drops below 200 for negative values.
    const r = parseInt(bg(-10, -10, 10).match(/rgb\((\d+), \d+, \d+\)/)![1], 10);
    expect(r).toBeGreaterThanOrEqual(200);
  });

  it('handles all-positive range (p5 > 0)', () => {
    // scale = max(2, 10) = 10. pctChange=10 → intensity=1 → max green.
    expect(bg(10, 2, 10)).toBe('rgb(0, 140, 60)');
    // pctChange=0 → white
    expect(bg(0, 2, 10)).toBe('rgb(255, 255, 255)');
  });

  it('handles all-negative range (p95 < 0)', () => {
    // scale = max(10, 2) = 10. pctChange=-10 → intensity=1 → max red.
    expect(bg(-10, -10, -2)).toBe('rgb(200, 0, 0)');
    // pctChange=0 → white
    expect(bg(0, -10, -2)).toBe('rgb(255, 255, 255)');
  });
});

describe('pctChangeToCellColors', () => {
  it('adaptive: white text on fully saturated cells, dark text on light cells', () => {
    const dark = pctChangeToCellColors(10, -10, 10, 'adaptive');
    expect(dark.bg).toBe('rgb(0, 140, 60)');
    expect(dark.fg).toBe('#fff');
    expect(dark.shadow).toBe('none');

    const light = pctChangeToCellColors(2, -10, 10, 'adaptive');
    expect(light.fg).toBe('inherit');
    expect(light.shadow).toBe('none');
  });

  it('bright: brighter endpoints with default dark text', () => {
    const max = pctChangeToCellColors(10, -10, 10, 'bright');
    expect(max.bg).toBe('rgb(0, 200, 80)');
    expect(max.fg).toBe('inherit');
    expect(max.shadow).toBe('none');

    const min = pctChangeToCellColors(-10, -10, 10, 'bright');
    expect(min.bg).toBe('rgb(244, 67, 54)');
  });

  it('halo: keeps the deep ramp and adds a light halo on dark cells only', () => {
    const dark = pctChangeToCellColors(10, -10, 10, 'halo');
    expect(dark.bg).toBe('rgb(0, 140, 60)');
    expect(dark.fg).toBe('inherit');
    expect(dark.shadow).toContain('rgba(255,255,255');

    const light = pctChangeToCellColors(2, -10, 10, 'halo');
    expect(light.shadow).toBe('none');
  });
});
