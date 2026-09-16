import { pctChangeToColor } from './color-mapping.utils';

describe('pctChangeToColor', () => {
  it('returns neutral color for pctChange === 0', () => {
    const color = pctChangeToColor(0, -10, 10);
    expect(color).toBe('rgb(245, 245, 245)');
  });

  it('returns max red for pctChange === p5', () => {
    const color = pctChangeToColor(-10, -10, 10);
    expect(color).toBe('rgb(255, 0, 0)');
  });

  it('returns max green for pctChange === p95', () => {
    const color = pctChangeToColor(10, -10, 10);
    expect(color).toBe('rgb(0, 255, 0)');
  });

  it('clips pctChange below p5 to max red', () => {
    const color = pctChangeToColor(-50, -10, 10);
    expect(color).toBe('rgb(255, 0, 0)');
  });

  it('clips pctChange above p95 to max green', () => {
    const color = pctChangeToColor(50, -10, 10);
    expect(color).toBe('rgb(0, 255, 0)');
  });

  it('interpolates red-to-neutral for pctChange between p5 and 0', () => {
    // p5 = -10, pctChange = -5 → halfway between red and neutral
    const color = pctChangeToColor(-5, -10, 10);
    // t = 0.5 → r=250 (round(255 + (245-255)*0.5)), g=123, b=123
    expect(color).toBe('rgb(250, 123, 123)');
  });

  it('interpolates neutral-to-green for pctChange between 0 and p95', () => {
    // p95 = 10, pctChange = 5 → halfway between neutral and green
    const color = pctChangeToColor(5, -10, 10);
    // t = 0.5 → r=123 (round(245 + (0-245)*0.5)), g=250, b=123
    expect(color).toBe('rgb(123, 250, 123)');
  });

  it('returns a valid CSS color string', () => {
    const color = pctChangeToColor(5, -10, 10);
    expect(color).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });

  it('returns neutral for degenerate range (p5 === p95)', () => {
    const color = pctChangeToColor(5, 0, 0);
    expect(color).toBe('rgb(245, 245, 245)');
  });

  it('handles all-positive range (p5 > 0) — direct red-to-green', () => {
    // p5=2, p95=10. One-sided: direct red-to-green.
    // pctChange=2 → t=0 → max red
    const atP5 = pctChangeToColor(2, 2, 10);
    expect(atP5).toBe('rgb(255, 0, 0)');
    // pctChange=10 → t=1 → max green
    const atP95 = pctChangeToColor(10, 2, 10);
    expect(atP95).toBe('rgb(0, 255, 0)');
    // pctChange=6 → t=0.5 → rgb(128, 128, 0)
    const mid = pctChangeToColor(6, 2, 10);
    expect(mid).toBe('rgb(128, 128, 0)');
  });

  it('handles all-negative range (p95 < 0) — direct red-to-green', () => {
    // p5=-10, p95=-2. One-sided: direct red-to-green.
    // pctChange=-10 → t=0 → max red
    const atP5 = pctChangeToColor(-10, -10, -2);
    expect(atP5).toBe('rgb(255, 0, 0)');
    // pctChange=-2 → t=1 → max green
    const atP95 = pctChangeToColor(-2, -10, -2);
    expect(atP95).toBe('rgb(0, 255, 0)');
    // pctChange=-6 → t=0.5 → rgb(128, 128, 0)
    const mid = pctChangeToColor(-6, -10, -2);
    expect(mid).toBe('rgb(128, 128, 0)');
  });

  it('handles p5 === 0 — one-sided, pctChange at 0 maps to red', () => {
    // p5=0, p95=10. One-sided (0 is not < 0).
    // pctChange=0 → t=0 → max red
    const atZero = pctChangeToColor(0, 0, 10);
    expect(atZero).toBe('rgb(255, 0, 0)');
    // pctChange=5 → t=0.5 → rgb(128, 128, 0)
    const mid = pctChangeToColor(5, 0, 10);
    expect(mid).toBe('rgb(128, 128, 0)');
  });

  it('handles p95 === 0 — one-sided, pctChange at 0 maps to green', () => {
    // p5=-10, p95=0. One-sided (0 is not > 0).
    // pctChange=0 → t=1 → max green
    const atZero = pctChangeToColor(0, -10, 0);
    expect(atZero).toBe('rgb(0, 255, 0)');
    // pctChange=-5 → t=0.5 → rgb(128, 128, 0)
    const mid = pctChangeToColor(-5, -10, 0);
    expect(mid).toBe('rgb(128, 128, 0)');
  });
});
