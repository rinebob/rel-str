import { parseIsoDateLocal } from './date.util';

describe('parseIsoDateLocal', () => {
  it('parses YYYY-MM-DD to a local-midnight Date', () => {
    const d = parseIsoDateLocal('2026-01-16')!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(16);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('keeps the local calendar day regardless of the host timezone offset', () => {
    // Date.parse('2026-01-16') returns UTC midnight — a Dec-15/Jan-16 boundary
    // shift west of Greenwich. The local constructor must not inherit that.
    const d = parseIsoDateLocal('2026-01-16')!;
    expect(d.getDate()).toBe(16);
  });

  it.each([
    '2026-13-01',  // month out of range
    '2026-02-31',  // rolls forward to Mar 3 — must not silently accept
    '2025-02-29',  // not a leap year
    '2026-1-16',   // unpadded
    'banana',
    '',
    '2026/01/16',
    '20260116',
  ])('rejects non-ISO or impossible dates — %s', (v) => {
    expect(parseIsoDateLocal(v)).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(parseIsoDateLocal('2024-02-29')).not.toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(parseIsoDateLocal('  2026-01-16  ')).not.toBeNull();
  });
});
