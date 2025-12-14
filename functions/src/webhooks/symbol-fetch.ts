import { logger } from 'firebase-functions/v2';
import { callPartnerTimeSeries, type PartnerInterval } from '../partner-proxy';
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

/** Range-based options for historical windows.
 *
 *  New call sites should prefer explicit `from`/`to` only.
 *
 *  All callers must resolve any duration presets (e.g. "last N days" or
 *  "N years back") into explicit calendar windows before constructing this
 *  options object.
 */
export interface FetchRangeOptions {
  interval?: PartnerInterval;
  from: string;      // YYYY-MM-DD UTC
  to: string;        // YYYY-MM-DD UTC
  adjusted?: boolean;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export async function fetchDailyBarsRange(symbol: string, opts: FetchRangeOptions): Promise<PartnerBar[]> {
  const interval: PartnerInterval = opts.interval ?? 'DAILY';

  // Call partner API for the explicit [from,to] window provided by the caller.
  const fromIso = String(opts.from).slice(0, 10);
  const toIso = String(opts.to).slice(0, 10);

  const req: any = {
    symbol,
    interval,
    from: fromIso,
    to: toIso,
    adjusted: opts.adjusted ?? true,
  };

  let data: any;
  try {
    data = await callPartnerTimeSeries(req);
  } catch (e: any) {
    logger.error('callPartnerTimeSeries_failed', {
      symbol,
      interval,
      from: fromIso,
      to: toIso,
      message: e?.message,
      status: e?.response?.status,
      statusText: e?.response?.statusText,
      url: e?.response?.url,
    });
    throw e;
  }

  const rawBars = Array.isArray(data?.bars) ? data.bars : [];
  logger.info('partner_timeseries_raw_payload', {
    symbol,
    interval,
    from: fromIso,
    to: toIso,
    limit: req.limit,
    barsCount: rawBars.length,
  //   bars: rawBars,
  });

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
              window: { from: fromIso, to: toIso },
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
      bars: 0,
    });
  }

  // Apply DAILY normalization 
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
  opts: FetchRangeOptions,
  minMsBetweenCalls = Number(process.env.PARTNER_SYMBOL_MIN_MS_BETWEEN_CALLS) || 0
): Promise<Map<string, PartnerBar[]>> {
  const out = new Map<string, PartnerBar[]>();
  const queue = symbols.slice();

  async function worker(wid: number) {
    while (queue.length) {
      const sym = queue.shift()!;
      try {
        const bars = await fetchDailyBarsRange(sym, {
          from: opts.from,
          to: opts.to,
          interval: opts.interval,
        });
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
