import { firstValueFrom, of, throwError } from 'rxjs';

import {
  MAX_WALK_BACK_DAYS,
  previousWeekday,
  resolveSession$,
  resolveSessionDate,
  walkBackDates,
} from './session-resolution.utils';

/** Build a Date whose Pacific wall-clock is the given time.
 *  PDT dates (Mar–Nov) are UTC-7; PST dates are UTC-8. Test cases below
 *  stick to Sep 2026 (PDT) unless marked otherwise. */
function ptTime(year: number, month: number, day: number, hour: number, minute = 0, dst = true): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + (dst ? 7 : 8), minute));
}

// Sep 2026: Mon 21, Tue 22, Wed 23, Thu 24, Fri 25, Sat 26, Sun 27, Mon 28
describe('resolveSessionDate', () => {
  it('returns the prior trading day before 1:00 PM PT', () => {
    // Tue 12:59 PM PT -> Mon
    expect(resolveSessionDate(ptTime(2026, 9, 22, 12, 59))).toBe('2026-09-21');
  });

  it('returns today at exactly 1:00 PM PT', () => {
    expect(resolveSessionDate(ptTime(2026, 9, 22, 13, 0))).toBe('2026-09-22');
  });

  it('returns today after 1:00 PM PT', () => {
    expect(resolveSessionDate(ptTime(2026, 9, 22, 16, 30))).toBe('2026-09-22');
  });

  it('pre-market Monday resolves to the prior Friday', () => {
    // Mon 9:30 AM PT -> Fri
    expect(resolveSessionDate(ptTime(2026, 9, 28, 9, 30))).toBe('2026-09-25');
  });

  it('post-close Saturday resolves to Saturday (walk-back lands on Friday)', () => {
    // Sat 2:00 PM PT -> Sat start; the walk itself skips the weekend
    expect(resolveSessionDate(ptTime(2026, 9, 26, 14, 0))).toBe('2026-09-26');
  });

  it('pre-close Sunday resolves to the prior Friday', () => {
    // Sun 10:00 AM PT -> Fri
    expect(resolveSessionDate(ptTime(2026, 9, 27, 10, 0))).toBe('2026-09-25');
  });

  it('treats midnight PT as pre-boundary (previous trading day)', () => {
    // Tue 12:30 AM PT -> Mon — exercises the hour12:'24' formatter quirk
    expect(resolveSessionDate(ptTime(2026, 9, 22, 0, 30))).toBe('2026-09-21');
  });

  it('handles PST (UTC-8) correctly', () => {
    // Dec 22 2026 (Tue) 12:30 PM PST -> Dec 21 (Mon)
    expect(resolveSessionDate(ptTime(2026, 12, 22, 12, 30, false))).toBe('2026-12-21');
    // Dec 22 2026 1:00 PM PST -> Dec 22
    expect(resolveSessionDate(ptTime(2026, 12, 22, 13, 0, false))).toBe('2026-12-22');
  });
});

describe('previousWeekday', () => {
  it('steps back one day for midweek dates', () => {
    expect(previousWeekday('2026-09-23')).toBe('2026-09-22');
  });

  it('skips the weekend from Monday to Friday', () => {
    expect(previousWeekday('2026-09-28')).toBe('2026-09-25');
  });

  it('skips Sunday back to Friday', () => {
    expect(previousWeekday('2026-09-27')).toBe('2026-09-25');
  });

  it('crosses month and year boundaries', () => {
    expect(previousWeekday('2027-01-01')).toBe('2026-12-31'); // Fri Jan 1 -> Thu Dec 31
    expect(previousWeekday('2026-09-01')).toBe('2026-08-31'); // Tue Sep 1 -> Mon Aug 31
  });
});

describe('walkBackDates', () => {
  it('yields the start date first when it is a weekday', () => {
    expect(walkBackDates('2026-09-22')[0]).toBe('2026-09-22');
  });

  it('adjusts a weekend start to the prior Friday', () => {
    expect(walkBackDates('2026-09-26')[0]).toBe('2026-09-25');
    expect(walkBackDates('2026-09-27')[0]).toBe('2026-09-25');
  });

  it('skips weekends while walking back', () => {
    const dates = walkBackDates('2026-09-28'); // Mon
    expect(dates.slice(0, 4)).toEqual(['2026-09-28', '2026-09-25', '2026-09-24', '2026-09-23']);
  });

  it('stops once the candidate is more than MAX_WALK_BACK_DAYS calendar days back', () => {
    const dates = walkBackDates('2026-09-28'); // Mon
    const last = dates[dates.length - 1];
    const spanDays = (Date.parse('2026-09-28') - Date.parse(last)) / 86_400_000;
    expect(spanDays).toBeLessThanOrEqual(MAX_WALK_BACK_DAYS);
    // 7 calendar days back from Mon Sep 28 = Mon Sep 21, which IS a weekday
    // and inside the cap; the next candidate (Fri Sep 18) is out.
    expect(dates).toContain('2026-09-21');
    expect(dates).not.toContain('2026-09-18');
  });
});

describe('resolveSession$', () => {
  it('resolves to the start date when the first fetch has data', async () => {
    const fetch$ = jest.fn(() => of([{ contractID: 'x' }]));
    const result = await firstValueFrom(
      resolveSession$('2026-09-22', fetch$, (c) => c.length > 0),
    );
    expect(result).toEqual({ date: '2026-09-22', data: [{ contractID: 'x' }] });
    expect(fetch$).toHaveBeenCalledTimes(1);
  });

  it('walks back until a snapshot has data, skipping weekends', async () => {
    // Start Sat Sep 26 -> Fri 25 empty, Thu 24 has data
    const fetch$ = jest.fn((date: string) =>
      of(date === '2026-09-24' ? [{ contractID: 'x' }] : []),
    );
    const result = await firstValueFrom(
      resolveSession$('2026-09-26', fetch$, (c: unknown[]) => c.length > 0),
    );
    expect(result?.date).toBe('2026-09-24');
    expect(fetch$).toHaveBeenCalledWith('2026-09-25');
    expect(fetch$).toHaveBeenCalledWith('2026-09-24');
    expect(fetch$).toHaveBeenCalledTimes(2); // never fetches the weekend
  });

  it('returns null when no candidate within the cap has data', async () => {
    const fetch$ = jest.fn(() => of([]));
    const result = await firstValueFrom(
      resolveSession$('2026-09-28', fetch$, (c: unknown[]) => c.length > 0),
    );
    expect(result).toBeNull();
    // Mon Sep 28 -> Fri 25, Thu 24, Wed 23, Tue 22, Mon 21 = 6 weekday candidates
    expect(fetch$).toHaveBeenCalledTimes(6);
  });

  it('fetches sequentially and stops after the first hit', async () => {
    const calls: string[] = [];
    const fetch$ = jest.fn((date: string) => {
      calls.push(date);
      return of(date === '2026-09-24' ? [1] : []);
    });
    await firstValueFrom(
      resolveSession$('2026-09-28', fetch$, (c: unknown[]) => c.length > 0),
    );
    expect(calls).toEqual(['2026-09-28', '2026-09-25', '2026-09-24']);
  });

  it('walks past a holiday: Tuesday post-close after a holiday Monday resolves to Friday', async () => {
    // Tue Sep 8 2026 post-close; Mon Sep 7 (Labor Day) returns no data
    const fetch$ = jest.fn((date: string) =>
      of(date === '2026-09-04' ? [{ contractID: 'x' }] : []),
    );
    const result = await firstValueFrom(
      resolveSession$('2026-09-08', fetch$, (c: unknown[]) => c.length > 0),
    );
    expect(result?.date).toBe('2026-09-04');
    expect(fetch$).toHaveBeenCalledWith('2026-09-08');
    expect(fetch$).toHaveBeenCalledWith('2026-09-07');
    expect(fetch$).toHaveBeenCalledWith('2026-09-04');
  });

  it('throws on a malformed start date instead of silently yielding null', async () => {
    const fetch$ = jest.fn(() => of([]));
    await expect(
      firstValueFrom(resolveSession$('not-a-date', fetch$, () => true)),
    ).rejects.toThrow(/invalid YYYY-MM-DD/);
    expect(fetch$).not.toHaveBeenCalled();
  });

  it('propagates fetch errors instead of walking past them', async () => {
    const fetch$ = jest.fn(() => throwError(() => new Error('boom')));
    await expect(
      firstValueFrom(resolveSession$('2026-09-22', fetch$, () => true)),
    ).rejects.toThrow('boom');
    expect(fetch$).toHaveBeenCalledTimes(1);
  });
});
