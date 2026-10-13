import { compareSortable } from './table-sort.util';

describe('compareSortable', () => {
  it('compares numbers numerically, honoring direction', () => {
    expect(compareSortable(2, 10, 'asc')).toBeLessThan(0);
    expect(compareSortable(2, 10, 'desc')).toBeGreaterThan(0);
    expect(compareSortable(5, 5, 'asc')).toBe(0);
  });

  it('compares strings locale-aware', () => {
    expect(compareSortable('AAPL', 'MSFT', 'asc')).toBeLessThan(0);
    expect(compareSortable('AAPL', 'MSFT', 'desc')).toBeGreaterThan(0);
  });

  it('sorts nullish values last in both directions', () => {
    expect(compareSortable(null, 5, 'asc')).toBe(1);
    expect(compareSortable(null, 5, 'desc')).toBe(1);
    expect(compareSortable(5, undefined, 'desc')).toBe(-1);
    expect(compareSortable(null, null, 'asc')).toBe(0);
  });

  it('compares ISO date strings lexically', () => {
    expect(compareSortable('2026-01-15', '2026-03-01', 'asc')).toBeLessThan(0);
  });
});
