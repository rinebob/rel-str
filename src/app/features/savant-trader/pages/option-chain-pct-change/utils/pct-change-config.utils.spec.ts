/**
 * Unit tests for pct-change config pure utility functions.
 */
import {
  resolvePctChangeTargets,
  generateIntervalDates,
  buildConfigId,
} from './pct-change-config.utils';

describe('pct-change-config.utils', () => {

  describe('resolvePctChangeTargets', () => {
    const bars = [
      { d: '2025-04-07', c: 100 },
      { d: '2025-04-08', c: 101 },
      { d: '2025-04-09', c: 105 },
      { d: '2025-04-10', c: 103 },
      { d: '2025-04-11', c: 110 },
      { d: '2025-04-14', c: 108 },
      { d: '2025-04-15', c: 95 },
    ];

    it('finds first date reaching upward percentage', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, [5]);
      expect(dates).toEqual(['2025-04-09']);
    });

    it('finds first date reaching downward percentage', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, [-5]);
      expect(dates).toEqual(['2025-04-15']);
    });

    it('finds multiple percentages in order', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, [1, 5, 10]);
      expect(dates).toEqual(['2025-04-08', '2025-04-09', '2025-04-11']);
    });

    it('skips unreachable percentages', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, [5, 50]);
      expect(dates).toEqual(['2025-04-09']);
    });

    it('returns empty array when no percentages are reached', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, [50]);
      expect(dates).toEqual([]);
    });

    it('returns empty array for empty bars', () => {
      const dates = resolvePctChangeTargets([], '2025-04-07', 100, [5]);
      expect(dates).toEqual([]);
    });

    it('returns empty array for empty percentages', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, []);
      expect(dates).toEqual([]);
    });

    it('handles start date not in bars (uses bars after start)', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-06', 100, [5]);
      expect(dates).toEqual(['2025-04-09']);
    });

    it('handles exact percentage reached on start date', () => {
      const dates = resolvePctChangeTargets(bars, '2025-04-07', 100, [0]);
      expect(dates).toEqual(['2025-04-07']);
    });

    it('handles unsorted input bars', () => {
      const unsorted = [...bars].reverse();
      const dates = resolvePctChangeTargets(unsorted, '2025-04-07', 100, [5]);
      expect(dates).toEqual(['2025-04-09']);
    });

    it('handles close exactly equal to target', () => {
      const exactBars = [
        { d: '2025-04-07', c: 100 },
        { d: '2025-04-08', c: 105 },
      ];
      const dates = resolvePctChangeTargets(exactBars, '2025-04-07', 100, [5]);
      expect(dates).toEqual(['2025-04-08']);
    });

    it('returns empty when start date is after all bars', () => {
      const dates = resolvePctChangeTargets(bars, '2025-05-01', 100, [5]);
      expect(dates).toEqual([]);
    });
  });

  describe('generateIntervalDates', () => {
    it('generates correct dates for count=5, interval=5', () => {
      const dates = generateIntervalDates('2025-04-07', 5, 5);
      expect(dates).toEqual([
        '2025-04-07',
        '2025-04-12',
        '2025-04-17',
        '2025-04-22',
        '2025-04-27',
      ]);
    });

    it('handles count=1 (just start date)', () => {
      const dates = generateIntervalDates('2025-04-07', 1, 5);
      expect(dates).toEqual(['2025-04-07']);
    });

    it('handles interval=1 (consecutive days)', () => {
      const dates = generateIntervalDates('2025-04-07', 3, 1);
      expect(dates).toEqual(['2025-04-07', '2025-04-08', '2025-04-09']);
    });

    it('crosses month boundary correctly', () => {
      const dates = generateIntervalDates('2025-04-28', 3, 5);
      expect(dates).toEqual(['2025-04-28', '2025-05-03', '2025-05-08']);
    });

    it('crosses year boundary correctly', () => {
      const dates = generateIntervalDates('2025-12-28', 3, 5);
      expect(dates).toEqual(['2025-12-28', '2026-01-02', '2026-01-07']);
    });

    it('handles count=0 (empty array)', () => {
      const dates = generateIntervalDates('2025-04-07', 0, 5);
      expect(dates).toEqual([]);
    });

    it('does not skip weekends (calendar days)', () => {
      // 2025-04-04 is a Friday; +3 days = Monday 2025-04-07
      const dates = generateIntervalDates('2025-04-04', 3, 3);
      expect(dates).toEqual(['2025-04-04', '2025-04-07', '2025-04-10']);
    });
  });

  describe('buildConfigId', () => {
    it('builds correct ID format', () => {
      const id = buildConfigId('QQQ', '2025-04-07', 3, 'pct-change', 'abc123');
      expect(id).toBe('QQQ-2025-04-07-3-pct-change-abc123');
    });

    it('uppercases symbol', () => {
      const id = buildConfigId('qqq', '2025-04-07', 3, 'pct-change', 'abc123');
      expect(id).toBe('QQQ-2025-04-07-3-pct-change-abc123');
    });

    it('handles single target', () => {
      const id = buildConfigId('SPY', '2025-01-01', 1, 'user-dates', 'xyz789');
      expect(id).toBe('SPY-2025-01-01-1-user-dates-xyz789');
    });

    it('handles swing-extremes target type', () => {
      const id = buildConfigId('QQQ', '2025-04-07', 2, 'swing-extremes', 'def456');
      expect(id).toBe('QQQ-2025-04-07-2-swing-extremes-def456');
    });
  });
});
