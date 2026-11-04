/// <reference types="jest" />
/**
 * Specs for the study-range brush math (Task #1340, FE-4).
 * Pure functions — px ↔ category-index conversion, edge clamping,
 * corpus/label snapping — so the overlay never diverges from the axis.
 */
import {
  categoryIndexToPx,
  nearestIndexByDate,
  pxToCategoryIndex,
  resolveBrushRange,
  type AxisSpace,
} from './options-contract-chart-brush.utils';

const SPACE: AxisSpace = { x: 100, y: 20, width: 800, height: 300, min: 0, delta: 10 };
const LABELS = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];

describe('pxToCategoryIndex', () => {
  it('maps plot-area px to a rounded category index', () => {
    // width 800 / delta 10 → 80px per category; px 100 → idx 0, px 260 → idx 2
    expect(pxToCategoryIndex(100, SPACE, LABELS.length)).toBe(0);
    expect(pxToCategoryIndex(260, SPACE, LABELS.length)).toBe(2);
    expect(pxToCategoryIndex(255, SPACE, LABELS.length)).toBe(2);
  });

  it('respects a scrolled visibleRange (min > 0)', () => {
    const scrolled: AxisSpace = { x: 100, y: 20, width: 800, height: 300, min: 5, delta: 10 };
    // px 260 → min 5 + (160/800)*10 = 7
    expect(pxToCategoryIndex(260, scrolled, 20)).toBe(7);
  });

  it('clamps to the axis domain when the drag leaves the plot area', () => {
    expect(pxToCategoryIndex(50, SPACE, LABELS.length)).toBe(0);
    expect(pxToCategoryIndex(9999, SPACE, LABELS.length)).toBe(4);
  });
});

describe('categoryIndexToPx', () => {
  it('inverts pxToCategoryIndex for band/rect edges', () => {
    expect(categoryIndexToPx(0, SPACE)).toBe(100);
    expect(categoryIndexToPx(2, SPACE)).toBe(260);
    expect(categoryIndexToPx(7, { x: 100, y: 20, width: 800, height: 300, min: 5, delta: 10 })).toBe(260);
  });

  it('returns the plot origin on a degenerate (delta 0) visible range', () => {
    expect(categoryIndexToPx(3, { ...SPACE, delta: 0 })).toBe(100);
  });
});

describe('nearestIndexByDate', () => {
  it('finds the exact member index', () => {
    expect(nearestIndexByDate('2026-06-03', LABELS)).toBe(2);
  });

  it('picks the nearer member for a non-member date', () => {
    const tradingDays = ['2026-06-05', '2026-06-08']; // Sat/Sun gap
    expect(nearestIndexByDate('2026-06-06', tradingDays)).toBe(0);
    expect(nearestIndexByDate('2026-06-07', tradingDays)).toBe(1);
  });

  it('clamps out-of-domain dates to the ends', () => {
    expect(nearestIndexByDate('2020-01-01', LABELS)).toBe(0);
    expect(nearestIndexByDate('2099-01-01', LABELS)).toBe(4);
  });
});

describe('resolveBrushRange', () => {
  const CORPUS = ['2026-06-02', '2026-06-04'];

  it('snaps both edges to the nearest corpus member and orders them', () => {
    // px 250→340 = idx 2..3 = labels 06-03,06-04 → corpus 06-02..06-04.
    // 06-03 is equidistant (1d each way) — tie resolves to the earlier date.
    const r = resolveBrushRange(340, 250, SPACE, LABELS, CORPUS);
    expect(r).toEqual({ start: '2026-06-02', end: '2026-06-04' });
  });

  it('falls back to axis labels when corpus is empty (drawer never ran)', () => {
    const r = resolveBrushRange(180, 340, SPACE, LABELS, []);
    expect(r).toEqual({ start: '2026-06-02', end: '2026-06-04' });
  });

  it('clamps a drag that starts/ends outside the plot area', () => {
    const r = resolveBrushRange(-500, 9999, SPACE, LABELS, []);
    expect(r).toEqual({ start: '2026-06-01', end: '2026-06-05' });
  });

  it('returns null when the axis has no categories — no undefined emission', () => {
    expect(resolveBrushRange(180, 340, SPACE, [], [])).toBeNull();
    expect(resolveBrushRange(180, 340, SPACE, [], CORPUS)).toBeNull();
  });

  it('sorts an unsorted corpus before snapping', () => {
    const unsorted = ['2026-06-04', '2026-06-02'];
    const r = resolveBrushRange(340, 250, SPACE, LABELS, unsorted);
    expect(r).toEqual({ start: '2026-06-02', end: '2026-06-04' });
  });
});
