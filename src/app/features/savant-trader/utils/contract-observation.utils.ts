import type { HistoricalOptionsContractV2Observation } from '../../../core/models/partner.types';

/** Parsed observation with numeric values for charting. */
export interface ParsedObservation {
  date: string;
  mark: number | null;
  bid: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}

export function parseNum(val: string | undefined): number | null {
  if (val == null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function parseObservations(series: HistoricalOptionsContractV2Observation[]): ParsedObservation[] {
  return series.map((obs) => ({
    date: obs.date,
    mark: parseNum(obs.mark),
    bid: parseNum(obs.bid),
    ask: parseNum(obs.ask),
    volume: parseNum(obs.volume),
    openInterest: parseNum(obs.open_interest),
    iv: parseNum(obs.implied_volatility),
    delta: parseNum(obs.delta),
    gamma: parseNum(obs.gamma),
    theta: parseNum(obs.theta),
    vega: parseNum(obs.vega),
    rho: parseNum(obs.rho),
  }));
}

/** Compute a padded date range from a contract's start/end dates and a pad-days count. */
export function paddedDateRange(startDate: string, endDate: string, padDays: number): { from: string; to: string } {
  if (padDays <= 0) return { from: startDate, to: endDate };
  const padMillis = padDays * 24 * 60 * 60 * 1000;
  const from = new Date(new Date(startDate + 'T00:00:00.000Z').getTime() - padMillis);
  const to = new Date(new Date(endDate + 'T00:00:00.000Z').getTime() + padMillis);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Generate null-valued padding observations for the given number of days on each side. */
export function padObservations(baseObs: ParsedObservation[], padDays: number): ParsedObservation[] {
  if (padDays <= 0 || baseObs.length === 0) return baseObs;

  const nullObs = (date: string): ParsedObservation => ({
    date, mark: null, bid: null, ask: null, volume: null, openInterest: null,
    iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
  });

  const firstDate = new Date(baseObs[0].date + 'T00:00:00.000Z');
  const leftObs: ParsedObservation[] = [];
  let d = new Date(firstDate);
  for (let i = 0; i < padDays; i++) {
    d = new Date(d.getTime() - 24 * 60 * 60 * 1000);
    leftObs.unshift(nullObs(d.toISOString().slice(0, 10)));
  }

  const lastDate = new Date(baseObs[baseObs.length - 1].date + 'T00:00:00.000Z');
  const rightObs: ParsedObservation[] = [];
  d = new Date(lastDate);
  for (let i = 0; i < padDays; i++) {
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
    rightObs.push(nullObs(d.toISOString().slice(0, 10)));
  }

  return [...leftObs, ...baseObs, ...rightObs];
}

/** Compute days to expiration from today (PT) to the expiration date. */
export function computeDte(expiration: string): number | null {
  if (!expiration) return null;
  const exp = new Date(`${expiration}T00:00:00.000Z`);
  const now = new Date();
  const diffMs = exp.getTime() - now.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/** Detect gaps in a daily date series (missing weekdays). */
export function computeGaps(series: HistoricalOptionsContractV2Observation[]): number {
  if (series.length < 2) return 0;
  let gaps = 0;
  for (let i = 1; i < series.length; i++) {
    const prev = new Date(`${series[i - 1].date}T00:00:00.000Z`);
    const curr = new Date(`${series[i].date}T00:00:00.000Z`);
    const dayDiff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
    if (dayDiff <= 1) continue;
    let missingWeekdays = 0;
    for (let d = 1; d < dayDiff; d++) {
      const checkDate = new Date(prev.getTime() + d * (1000 * 60 * 60 * 24));
      const dayOfWeek = checkDate.getUTCDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) missingWeekdays++;
    }
    gaps += missingWeekdays;
  }
  return gaps;
}

export function countNaNIV(series: HistoricalOptionsContractV2Observation[]): number {
  return series.filter((obs) => {
    const iv = parseNum(obs.implied_volatility);
    return iv === null;
  }).length;
}

export function countZeroVolume(series: HistoricalOptionsContractV2Observation[]): number {
  return series.filter((obs) => {
    const vol = parseNum(obs.volume);
    return vol === null || vol === 0;
  }).length;
}
