import { logger } from 'firebase-functions/v2';
import { callPartnerTimeSeries } from '../partner-proxy';
import { persistWarning } from '../logging/warn';
import { RsCloudFunctionName } from './webhooks-config';

export type PartnerBar = {
  d?: string;
  t?: number;
  ac?: number;
  c?: number;
  pc?: number;
  cp?: number;
  ip?: number;
  ipc?: number;
  it?: string;
};

export interface FetchConfig {
  interval?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  days?: number;   // last N calendar days (default 30)
  limit?: number;  // API safety cap (default 30)
}

/** Range-based options for explicit historical windows. */
export interface FetchRangeOptions {
  interval?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  from?: string;      // YYYY-MM-DD UTC
  to?: string;        // YYYY-MM-DD UTC
  yearsBack?: number; // e.g. 1, 2, 5; converts to from = today - years*365
  days?: number;      // fallback when from/to not provided
  limit?: number;     // API cap
}

export async function fetchDailyBarsRaw(symbol: string, days = 30, limit = 30, interval: FetchConfig['interval'] = 'DAILY'): Promise<PartnerBar[]> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const toIso = to.toISOString().slice(0, 10);
  const fromIso = from.toISOString().slice(0, 10);
  const data = (await callPartnerTimeSeries({ symbol, interval, from: fromIso, to: toIso, limit })) as any;
  const bars = Array.isArray(data?.bars) ? data.bars : [];
  if (bars.length > 0) {
    const firstT = Number(bars[0]?.t);
    const lastT = Number(bars[bars.length - 1]?.t);
    const firstDay = Number.isFinite(firstT) ? new Date(firstT).toISOString().slice(0, 10) : undefined;
    const lastDay = Number.isFinite(lastT) ? new Date(lastT).toISOString().slice(0, 10) : undefined;
    logger.info('partner_timeseries_response', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      limit,
      bars: bars.length,
      firstDay,
      lastDay,
    });
    try {
      let anomalies = 0;
      for (const b of bars as any[]) {
        const day = String(b?.d || '');
        if (!day) continue;
        const todayClose = Number(b?.ac ?? b?.c ?? 0);
        const cp = Number(b?.cp);
        const issues: string[] = [];
        if (!(Number.isFinite(todayClose) && todayClose > 0)) issues.push('close_nonpositive_or_nonfinite');
        if (!Number.isFinite(cp) && Number.isFinite(todayClose) && todayClose > 0) issues.push('cp_nonfinite');
        if (issues.length) {
          anomalies++;
          try {
            await persistWarning('sa_bar_anomaly', {
              function: RsCloudFunctionName.PROCESS_DATA_READY,
              symbol,
              day,
              issues,
              window: { from: fromIso, to: toIso, limit },
            });
          } catch {}
        }
      }
      if (anomalies > 0) logger.info('partner_timeseries_bar_anomalies', { symbol, anomalies });
    } catch {}
  } else {
    logger.info('partner_timeseries_response_empty', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      limit,
      bars: 0,
    });
  }
  return bars as PartnerBar[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Fetch bars for an explicit window using from/to or yearsBack.
 * Normalization (cp/ch/pc) is identical to fetchDailyBarsRaw.
 */
export async function fetchDailyBarsRange(symbol: string, opts: FetchRangeOptions = {}): Promise<PartnerBar[]> {
  const interval = opts.interval ?? 'DAILY';
  // Resolve window
  let toDate: Date;
  let fromDate: Date;
  if (opts.to) {
    toDate = new Date(`${opts.to}T00:00:00.000Z`);
  } else {
    toDate = new Date();
  }
  if (opts.from) {
    fromDate = new Date(`${opts.from}T00:00:00.000Z`);
  } else if (Number.isFinite(opts.yearsBack as number)) {
    const years = Number(opts.yearsBack);
    fromDate = new Date(toDate.getTime() - years * 365 * 24 * 60 * 60 * 1000);
  } else {
    const days = Number.isFinite(opts.days as number) ? Number(opts.days) : 30;
    fromDate = new Date(toDate.getTime() - days * 24 * 60 * 60 * 1000);
  }
  const toIso = toDate.toISOString().slice(0, 10);
  const fromIso = fromDate.toISOString().slice(0, 10);
  // Partner DAILY endpoint effectively caps the number of bars it will return
  // when using from/to+limit (FIXED_LIMIT ~ 30). For multi-year windows driven
  // by yearsBack we instead prefer the partner-provided range parameter so we
  // can request e.g. '2y' of history in a single call.

  let data: any;
  let effectiveLimit: number | undefined;
  if (!opts.from && !opts.to && Number.isFinite(opts.yearsBack as number)) {
    const years = Math.max(1, Math.round(Number(opts.yearsBack)));
    const range = `${years}y`;
    data = await callPartnerTimeSeries({ symbol, interval, range });

    const rawBars = Array.isArray((data as any)?.bars) ? (data as any).bars : [];
    logger.info('partner_timeseries_raw_payload', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      range,
      barsCount: rawBars.length,
    //   bars: rawBars,
    });
  } else {
    // Derive a sensible default limit for explicit from/to or days windows:
    // - If caller provided an explicit limit, honor it.
    // - Otherwise fall back to days/30 as before.
    const explicitLimit = Number.isFinite(opts.limit as number) ? Number(opts.limit) : undefined;
    const fallbackLimitFromDays = Number.isFinite(opts.days as number) ? Number(opts.days) : 30;
    const limit = explicitLimit ?? fallbackLimitFromDays;
    effectiveLimit = limit;
    data = await callPartnerTimeSeries({ symbol, interval, from: fromIso, to: toIso, limit });

    const rawBars = Array.isArray((data as any)?.bars) ? (data as any).bars : [];
    logger.info('partner_timeseries_raw_payload', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      limit,
      barsCount: rawBars.length,
    //   bars: rawBars,
    });
  }

  const bars = Array.isArray(data?.bars) ? data.bars : [];
  if (bars.length > 0) {
    const firstT = Number(bars[0]?.t);
    const lastT = Number(bars[bars.length - 1]?.t);
    const firstDay = Number.isFinite(firstT) ? new Date(firstT).toISOString().slice(0, 10) : undefined;
    const lastDay = Number.isFinite(lastT) ? new Date(lastT).toISOString().slice(0, 10) : undefined;
    logger.info('partner_timeseries_response', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      limit: effectiveLimit,
      bars: bars.length,
      firstDay,
      lastDay,
    });
    try {
      let anomalies = 0;
      for (const b of bars as any[]) {
        const day = String(b?.d || '');
        if (!day) continue;
        const todayClose = Number(b?.ac ?? b?.c ?? 0);
        const cp = Number(b?.cp);
        const issues: string[] = [];
        if (!(Number.isFinite(todayClose) && todayClose > 0)) issues.push('close_nonpositive_or_nonfinite');
        if (!Number.isFinite(cp) && Number.isFinite(todayClose) && todayClose > 0) issues.push('cp_nonfinite');
        if (issues.length) {
          anomalies++;
          try {
            await persistWarning('sa_bar_anomaly', {
              function: RsCloudFunctionName.PROCESS_DATA_READY,
              symbol,
              day,
              issues,
              window: { from: fromIso, to: toIso, limit: effectiveLimit },
            });
          } catch {}
        }
      }
      if (anomalies > 0) logger.info('partner_timeseries_bar_anomalies', { symbol, anomalies });
    } catch {}
  } else {
    logger.info('partner_timeseries_response_empty', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      limit: effectiveLimit,
      bars: 0,
    });
  }

  // Apply the same DAILY normalization as fetchDailyBarsRaw
  if (interval === 'DAILY' && bars.length > 0) {
    const isWeekend = (dayStr?: string) => {
      if (!dayStr) return false;
      const dow = new Date(dayStr + 'T00:00:00.000Z').getUTCDay();
      return dow === 0 || dow === 6;
    };
    bars.sort((a: any, b: any) => String(a?.d || '').localeCompare(String(b?.d || '')));
    let derivedCount = 0;
    for (let i = 0; i < bars.length; i++) {
      const curr = bars[i] as any;
      const day = String(curr?.d || '');
      if (!day || isWeekend(day)) continue;
      let j = i - 1;
      let prev: any | undefined;
      while (j >= 0 && !prev) {
        const pd = String(bars[j]?.d || '');
        if (pd && !isWeekend(pd)) prev = bars[j];
        j--;
      }
      const todayClose = Number(curr?.ac ?? curr?.c ?? 0);
      const prevClose = Number(prev?.ac ?? prev?.c ?? 0);
      if (Number.isFinite(todayClose) && todayClose > 0 && Number.isFinite(prevClose) && prevClose > 0) {
        if (!Number.isFinite(Number(curr?.cp))) {
          curr.cp = Number((((todayClose - prevClose) / prevClose) * 100).toFixed(6));
          derivedCount++;
        }
        if (!Number.isFinite(Number(curr?.ch))) {
          curr.ch = Number((todayClose - prevClose).toFixed(6));
        }
        if (!Number.isFinite(Number(curr?.pc))) {
          curr.pc = Number(prevClose.toFixed(6));
        }
      }
    }
    if (derivedCount > 0) logger.info('partner_timeseries_derived_cp', { symbol, interval, derivedCount });
  }

  return bars as PartnerBar[];
}

export async function fetchAllSymbols(
  symbols: string[],
  concurrency = Number(process.env.PARTNER_SYMBOL_CONCURRENCY) || 8,
  opts: FetchConfig = { interval: 'DAILY', days: 30, limit: 30 },
  minMsBetweenCalls = Number(process.env.PARTNER_SYMBOL_MIN_MS_BETWEEN_CALLS) || 0
): Promise<Map<string, PartnerBar[]>> {
  const out = new Map<string, PartnerBar[]>();
  const queue = symbols.slice();

  async function worker(wid: number) {
    while (queue.length) {
      const sym = queue.shift()!;
      try {
        const bars = await fetchDailyBarsRaw(sym, opts.days ?? 30, opts.limit ?? 30, opts.interval ?? 'DAILY');
        out.set(sym, bars);
      } catch (e: any) {
        logger.error('symbol_fetch_failed', { symbol: sym, message: e?.message, status: e?.response?.status });
      } finally {
        if (minMsBetweenCalls > 0) await sleep(minMsBetweenCalls);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, symbols.length)) }, (_, idx) => worker(idx));
  await Promise.all(workers);
  return out;
}
