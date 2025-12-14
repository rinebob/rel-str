import { Interval, RsDirection } from '../types/signal.types';

export function yearOf(day: string): string {
  return String(day || '').slice(0, 4);
}

export function getDowCodeFromDate(d: Date): string {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] as const;
  const idx = d.getUTCDay();
  const code = days[idx];
  if (code === undefined) {
    throw new Error(`getDowCodeFromDate: invalid day index ${idx}`);
  }
  return code.toUpperCase();
}

export function getIntervalCode(interval: Interval): string {
  const map: Record<Interval, string> = {
    [Interval.DAILY]: 'D',
    [Interval.WEEKLY]: 'W',
    [Interval.MONTHLY]: 'M',
  };
  return map[interval];
}

export function buildPositionId(
  day: string,
  timestamp: number,
  pair: string,
  interval: Interval,
  direction: RsDirection,
): string {
  const d = new Date(timestamp);
  const dow = getDowCodeFromDate(d);
  const ymd = String(day || '').replace(/-/g, '');
  const intervalCode = getIntervalCode(interval);
  const dirCode = String(direction).toUpperCase();
  return `${ymd}-${dow}-${intervalCode}-${pair}-${dirCode}`;
}
