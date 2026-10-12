/**
 * Tests for screenshot-capture builders — the storage path convention, the
 * `st-screenshots` index doc id, and the result assembler (Topic #746 /
 * Thread #747 / task #765; index id + symbol-prefixed filenames in #850).
 */

import {
  CaptureEvent,
  ChartInterval,
  PositionType,
  type CaptureArtifact,
} from './screenshot-capture-contracts';
import {
  buildCaptureChartResult,
  buildScreenshotIndexDocId,
  buildScreenshotStoragePath,
  type ScreenshotIndexIdSpec,
  type ScreenshotPathSpec,
} from './screenshot-capture-utils';

describe('buildScreenshotStoragePath', () => {
  const base: ScreenshotPathSpec = {
    symbol: 'goog',
    event: CaptureEvent.ORDER_FILLED,
    positionType: PositionType.STOCK,
    interval: ChartInterval.DAILY,
    ext: 'png',
    date: '2026-10-03',
    time: '143022',
  };

  it('builds st-trade-screenshots/{SYMBOL}/{SYMBOL}-{date}-{time}-{event}-{positionType}-{interval}.{ext}', () => {
    expect(buildScreenshotStoragePath(base)).toBe(
      'st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-daily.png',
    );
  });

  it('produces svg variants and weekly interval segments', () => {
    expect(
      buildScreenshotStoragePath({
        ...base,
        symbol: 'AAPL',
        event: CaptureEvent.MANUAL,
        interval: ChartInterval.WEEKLY,
        ext: 'svg',
      }),
    ).toBe('st-trade-screenshots/AAPL/AAPL-2026-10-03-143022-manual-stock-weekly.svg');
  });

  it('appends a sanitized 6-char refId segment when provided', () => {
    expect(buildScreenshotStoragePath({ ...base, refId: 'ORD-12345-X' })).toBe(
      'st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-ord123-daily.png',
    );
  });

  it('omits the ref segment when refId sanitizes to nothing', () => {
    expect(buildScreenshotStoragePath({ ...base, refId: '---' })).toBe(
      'st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-daily.png',
    );
  });

  it('passes a refId of 6 chars or fewer through untruncated, dots included', () => {
    expect(buildScreenshotStoragePath({ ...base, refId: 'abc123' })).toBe(
      'st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-abc123-daily.png',
    );
    expect(buildScreenshotStoragePath({ ...base, refId: 'V2.1' })).toBe(
      'st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-v2.1-daily.png',
    );
  });

  it('throws when the symbol contains no path-safe characters', () => {
    expect(() => buildScreenshotStoragePath({ ...base, symbol: '///' })).toThrow(
      /symbol contains no path-safe characters/,
    );
  });

  it('sanitizes symbol characters that would break the path shape', () => {
    expect(buildScreenshotStoragePath({ ...base, symbol: 'br/k b' })).toBe(
      'st-trade-screenshots/BRKB/BRKB-2026-10-03-143022-order-filled-stock-daily.png',
    );
    expect(buildScreenshotStoragePath({ ...base, symbol: 'brk.b' })).toBe(
      'st-trade-screenshots/BRK.B/BRK.B-2026-10-03-143022-order-filled-stock-daily.png',
    );
  });

  it('the time segment prevents same-day same-event overwrites', () => {
    const earlier = buildScreenshotStoragePath({ ...base, time: '090000' });
    const later = buildScreenshotStoragePath({ ...base, time: '143022' });
    expect(earlier).not.toBe(later);
  });

  it('groups under {SYMBOL}/{groupId}/ when a groupId is supplied', () => {
    expect(buildScreenshotStoragePath({ ...base, groupId: 'cohort-260915-aapl-01' })).toBe(
      'st-trade-screenshots/GOOG/cohort-260915-aapl-01/GOOG-2026-10-03-143022-order-filled-stock-daily.png',
    );
  });

  it('sanitizes groupId — keeps alphanumerics/dots/hyphens, strips the rest', () => {
    expect(buildScreenshotStoragePath({ ...base, groupId: 'COHORT_ABC/1' })).toBe(
      'st-trade-screenshots/GOOG/cohortabc1/GOOG-2026-10-03-143022-order-filled-stock-daily.png',
    );
    expect(buildScreenshotStoragePath({ ...base, groupId: 'grp.V2-1' })).toBe(
      'st-trade-screenshots/GOOG/grp.v2-1/GOOG-2026-10-03-143022-order-filled-stock-daily.png',
    );
  });

  it.each([['all-unsafe', '///'], ['dots only', '..'], ['hyphens+dots', '-.-'], ['empty', '']])(
    'omits the group directory when groupId has no alphanumeric: %s',
    (_label, groupId) => {
      expect(buildScreenshotStoragePath({ ...base, groupId })).toBe(
        'st-trade-screenshots/GOOG/GOOG-2026-10-03-143022-order-filled-stock-daily.png',
      );
    },
  );

  it('groupId folder and refId segment coexist independently', () => {
    expect(
      buildScreenshotStoragePath({ ...base, groupId: 'cohort-1', refId: 'pos-9' }),
    ).toBe(
      'st-trade-screenshots/GOOG/cohort-1/GOOG-2026-10-03-143022-order-filled-stock-pos9-daily.png',
    );
  });
});

describe('buildScreenshotIndexDocId', () => {
  const base: ScreenshotIndexIdSpec = {
    symbol: 'goog',
    event: CaptureEvent.ORDER_FILLED,
    interval: ChartInterval.DAILY,
    date: '2026-10-03',
    time: '143022',
  };

  it('builds {SYMBOL}-{date}-{time}-{event}-{interval}', () => {
    expect(buildScreenshotIndexDocId(base)).toBe(
      'GOOG-2026-10-03-143022-order-filled-daily',
    );
  });

  it('adds the sanitized ref segment (the hash slot) when refId is present', () => {
    expect(buildScreenshotIndexDocId({ ...base, refId: 'ORD-12345-X' })).toBe(
      'GOOG-2026-10-03-143022-order-filled-ord123-daily',
    );
    expect(buildScreenshotIndexDocId({ ...base, refId: '---' })).toBe(
      'GOOG-2026-10-03-143022-order-filled-daily',
    );
  });

  it('uppercases the symbol and carries the interval verbatim', () => {
    expect(
      buildScreenshotIndexDocId({ ...base, symbol: 'brk.b', interval: ChartInterval.WEEKLY }),
    ).toBe('BRK.B-2026-10-03-143022-order-filled-weekly');
  });

  it('throws when the symbol contains no path-safe characters', () => {
    expect(() => buildScreenshotIndexDocId({ ...base, symbol: '///' })).toThrow(
      /symbol contains no path-safe characters/,
    );
  });
});

describe('buildCaptureChartResult', () => {
  const daily: CaptureArtifact = {
    interval: ChartInterval.DAILY,
    svg: '<svg id="d"/>',
    svgPath: 'st-trade-screenshots/AAPL/AAPL-2026-10-03-143022-manual-stock-daily.svg',
    pngPath: 'st-trade-screenshots/AAPL/AAPL-2026-10-03-143022-manual-stock-daily.png',
  };
  const weekly: CaptureArtifact = {
    interval: ChartInterval.WEEKLY,
    svg: '<svg id="w"/>',
    svgPath: 'st-trade-screenshots/AAPL/AAPL-2026-10-03-143022-manual-stock-weekly.svg',
  };

  it('derives svg from the first artifact and flattens all paths', () => {
    const result = buildCaptureChartResult([daily, weekly]);
    expect(result.svg).toBe(daily.svg);
    expect(result.paths).toEqual([daily.svgPath, daily.pngPath, weekly.svgPath]);
    expect(result.artifacts).toEqual([daily, weekly]);
  });

  it('carries the PT date/time stamp when supplied', () => {
    const stamp = { date: '2026-10-03', time: '143022' };
    const result = buildCaptureChartResult([daily], stamp);
    expect(result.date).toBe('2026-10-03');
    expect(result.time).toBe('143022');
  });

  it('omits the stamp keys when not supplied', () => {
    const result = buildCaptureChartResult([daily]);
    expect('date' in result).toBe(false);
    expect('time' in result).toBe(false);
  });

  it('cannot diverge: paths always match the artifacts exactly', () => {
    const result = buildCaptureChartResult([weekly]);
    expect(result.svg).toBe(weekly.svg);
    expect(result.paths).toEqual([weekly.svgPath]);
  });

  it('handles the empty-artifacts edge without throwing', () => {
    const result = buildCaptureChartResult([]);
    expect(result.svg).toBe('');
    expect(result.paths).toEqual([]);
    expect(result.artifacts).toEqual([]);
  });
});
