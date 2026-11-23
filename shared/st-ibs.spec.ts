/**
 * @topic #261 — Trading Indicator Library, Thread #1665
 * @task #1675 — SHARED: computeIbs + availability
 *
 * Internal Bar Strength — IBS = (C-L)/(H-L) — pure function contract:
 * value semantics on completed bars plus availability (number | undefined)
 * on the developing D/W bar relative to an injected ET clock.
 */
// Import through the '@st/ibs' alias — pins the jest moduleNameMapper
// wiring (TEST doc's app-side alias check); the BE path is pinned by
// functions/scripts/verify/indicator-lib-ibs-1675.ts via tsx.
import { computeIbs } from '@st/ibs';

describe('computeIbs — value semantics', () => {
  // Table from the shared test plan — expected values computed by hand,
  // not by the implementation.
  it.each([
    ['interior close', 110, 100, 108, 0.8],
    ['close at high', 110, 100, 110, 1.0],
    ['close at low', 110, 100, 100, 0.0],
    ['close at midpoint', 110, 100, 105, 0.5],
  ])('%s → %f', (_name, high, low, close, expected) => {
    expect(
      computeIbs({ high, low, close, date: '2026-11-20' }, 'D', {
        now: new Date('2026-11-23T13:00:00Z'),
      }),
    ).toBeCloseTo(expected, 6);
  });

  it('zero-range bar returns 0.5', () => {
    expect(
      computeIbs({ high: 100, low: 100, close: 100, date: '2026-11-20' }, 'D', {
        now: new Date('2026-11-23T13:00:00Z'),
      }),
    ).toBe(0.5);
  });

  it('inverted range (high < low) returns 0.5', () => {
    expect(
      computeIbs({ high: 99, low: 100, close: 99.5, date: '2026-11-20' }, 'D', {
        now: new Date('2026-11-23T13:00:00Z'),
      }),
    ).toBe(0.5);
  });
});

describe('computeIbs — daily availability', () => {
  // 2026-11-24 is a Tuesday; EST is UTC-5, so 17:00Z = 12:00 ET.
  const bar = { high: 110, low: 100, close: 108, date: '2026-11-24' };

  it('returns undefined before default activation (11:59 ET)', () => {
    expect(computeIbs(bar, 'D', { now: new Date('2026-11-24T16:59:00Z') })).toBeUndefined();
  });

  it('returns a value at activation boundary (12:00 ET)', () => {
    expect(computeIbs(bar, 'D', { now: new Date('2026-11-24T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('returns undefined early morning (08:00 ET)', () => {
    expect(computeIbs(bar, 'D', { now: new Date('2026-11-24T13:00:00Z') })).toBeUndefined();
  });

  it('returns a value post-close (18:00 ET)', () => {
    expect(computeIbs(bar, 'D', { now: new Date('2026-11-24T23:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('returns a value for a completed bar (yesterday) even pre-activation', () => {
    const yesterday = { ...bar, date: '2026-11-23' };
    expect(computeIbs(yesterday, 'D', { now: new Date('2026-11-24T13:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('returns a value for a future-dated bar', () => {
    const future = { ...bar, date: '2026-11-25' };
    expect(computeIbs(future, 'D', { now: new Date('2026-11-24T13:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('honors activateAtEtMin override (10:00 ET)', () => {
    expect(
      computeIbs(bar, 'D', { now: new Date('2026-11-24T15:00:00Z'), activateAtEtMin: 600 }),
    ).toBeCloseTo(0.8, 6);
    expect(
      computeIbs(bar, 'D', { now: new Date('2026-11-24T14:59:00Z'), activateAtEtMin: 600 }),
    ).toBeUndefined();
  });

  it('returns a value when bar carries no date', () => {
    expect(
      computeIbs({ high: 110, low: 100, close: 108 }, 'D', {
        now: new Date('2026-11-24T13:00:00Z'),
      }),
    ).toBeCloseTo(0.8, 6);
  });

  it('returns a value with ctx omitted for a past-dated bar', () => {
    expect(computeIbs({ ...bar, date: '2026-11-20' }, 'D')).toBeCloseTo(0.8, 6);
  });
});

describe('computeIbs — weekly availability', () => {
  // Week of 2026-11-23 (Mon) through 2026-11-27 (Fri). 17:00Z = noon ET.
  const thisWeekBar = { high: 110, low: 100, close: 108, date: '2026-11-27' };

  it('returns undefined on Monday (before default Wednesday activation)', () => {
    expect(computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-23T17:00:00Z') })).toBeUndefined();
  });

  it('returns undefined on Tuesday', () => {
    expect(computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-24T17:00:00Z') })).toBeUndefined();
  });

  it('returns a value on Wednesday (activation boundary)', () => {
    expect(computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-25T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('returns a value on Friday', () => {
    expect(computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-27T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('returns a value for a prior-week bar even on Monday', () => {
    const priorWeek = { ...thisWeekBar, date: '2026-11-20' };
    expect(computeIbs(priorWeek, 'W', { now: new Date('2026-11-23T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('treats a Monday-dated bar of the current week as developing', () => {
    const mondayBar = { ...thisWeekBar, date: '2026-11-23' };
    expect(computeIbs(mondayBar, 'W', { now: new Date('2026-11-24T17:00:00Z') })).toBeUndefined();
  });

  it('honors activateAtWeekday override (4 = Thursday)', () => {
    expect(
      computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-25T17:00:00Z'), activateAtWeekday: 4 }),
    ).toBeUndefined();
    expect(
      computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-26T17:00:00Z'), activateAtWeekday: 4 }),
    ).toBeCloseTo(0.8, 6);
  });

  it('returns a value for a malformed bar date', () => {
    const malformed = { ...thisWeekBar, date: 'not-a-date' };
    expect(computeIbs(malformed, 'W', { now: new Date('2026-11-23T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('returns a value for an out-of-range bar date (rolls over without the guard)', () => {
    const rolled = { ...thisWeekBar, date: '2026-13-40' };
    expect(computeIbs(rolled, 'W', { now: new Date('2026-11-23T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('Sunday is the trading-week tail — current-week bar defined (monotonic gate)', () => {
    // Saturday (weekday 6) is defined; Sunday must not dip back to
    // undefined — no session follows Friday's close until Monday.
    expect(computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-28T17:00:00Z') })).toBeCloseTo(0.8, 6);
    expect(computeIbs(thisWeekBar, 'W', { now: new Date('2026-11-29T17:00:00Z') })).toBeCloseTo(0.8, 6);
  });

  it('availability precedes the zero-range guard — developing zero-range bar is unavailable', () => {
    const flatToday = { high: 100, low: 100, close: 100, date: '2026-11-24' };
    expect(computeIbs(flatToday, 'D', { now: new Date('2026-11-24T13:00:00Z') })).toBeUndefined();
    expect(computeIbs(flatToday, 'D', { now: new Date('2026-11-24T17:00:00Z') })).toBe(0.5);
  });
});
