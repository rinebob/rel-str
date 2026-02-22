import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import { callPartnerTimeSeries, type PartnerInterval } from '../partner-proxy';
import { persistWarning } from '../logging/warn';
import { ENABLE_CONSOLE_LOGGING, RsCloudFunctionName, RS_SYMBOL_CACHE_COLLECTION, RS_SYMBOL_CACHE_SYMBOLS_SUBCOL } from './webhooks-config';
import { db } from '../firebase-admin-init';

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

export interface RsSymbolCacheDoc {
  dailyBars: PartnerBar[] | null;
  weeklyBars: PartnerBar[] | null;
  monthlyBars: PartnerBar[] | null;
  fetchedAt: FirebaseFirestore.Timestamp;
  runId?: string;
}

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

  if (ENABLE_CONSOLE_LOGGING) {
    const rawBars = Array.isArray(data?.bars) ? data.bars : [];
    logger.info(
      `partner_timeseries_raw_payload symbol=${symbol} interval=${interval} from=${fromIso} to=${toIso} bars=${rawBars.length}`,
      {
        symbol,
        interval,
        from: fromIso,
        to: toIso,
        limit: (req as any).limit,
        barsCount: rawBars.length,
        // bars: rawBars,
      },
    );
  }

  const bars = Array.isArray(data?.bars) ? data.bars : [];
  if (bars.length > 0) {
    if (ENABLE_CONSOLE_LOGGING) {
      const firstT = Number((bars as any[])[0]?.t);
      const lastT = Number((bars as any[])[(bars as any[]).length - 1]?.t);
      const firstDay = Number.isFinite(firstT) ? new Date(firstT).toISOString().slice(0, 10) : undefined;
      const lastDay = Number.isFinite(lastT) ? new Date(lastT).toISOString().slice(0, 10) : undefined;
      logger.info(
        `partner_timeseries_response symbol=${symbol} interval=${interval} from=${fromIso} to=${toIso} bars=${(bars as any[]).length} firstDay=${firstDay || 'n/a'} lastDay=${lastDay || 'n/a'}`,
        {
          symbol,
          interval,
          from: fromIso,
          to: toIso,
          bars: (bars as any[]).length,
          firstDay,
          lastDay,
        },
      );
    }
    try {
    //   let anomalies = 0;
      for (const b of bars as any[]) {
        const day = String(b?.d || '');
        if (!day) continue;
        const todayClose = Number(b?.ac ?? b?.c ?? 0);
        const cp = Number(b?.cp);
        const issues: string[] = [];
        if (!(Number.isFinite(todayClose) && todayClose > 0)) issues.push('close_nonpositive_or_nonfinite');
        if (!Number.isFinite(cp) && Number.isFinite(todayClose) && todayClose > 0) issues.push('cp_nonfinite');
        if (issues.length) {
        //   anomalies++;
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
      // if (anomalies > 0) logger.info('partner_timeseries_bar_anomalies', { symbol, anomalies });
    } catch {}

    try {
      const cutoff = '2025-12-26';
      const tailBars = (bars as any[]).filter((b) => typeof b?.d === 'string' && b.d >= cutoff);
      if (tailBars.length > 0 && ENABLE_CONSOLE_LOGGING) {
        logger.info('partner_timeseries_tail_bars_from_cutoff', {
          symbol,
          interval,
          from: fromIso,
          to: toIso,
          cutoff,
          tailCount: tailBars.length,
          // tailBars,
        });
      }
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

/**
 * Fetch bars for a single interval (DAILY/WEEKLY/MONTHLY) for a symbol over a
 * fixed lookback window anchored on `marketDate` and cache the normalized
 * PartnerBar array into Firestore under
 * `rs-symbol-cache/{marketDate}/symbols/{symbol}`.
 *
 * Other cached intervals for the same `{marketDate, symbol}` are preserved by
 * reading any existing cache doc and only overwriting the bars field for the
 * requested interval.
 */
export async function fetchAndCacheSymbolSeries(
  marketDate: string,
  symbol: string,
  days: number,
  runId: string | undefined,
  interval: PartnerInterval,
): Promise<RsSymbolCacheDoc> {
  const clampedDays = Math.max(1, days);

  // Anchor the window on marketDate (UTC calendar days).
  const baseDate = new Date(`${marketDate}T00:00:00.000Z`);
  if (Number.isNaN(baseDate.getTime())) {
    throw new Error(`fetchAndCacheSymbolSeries_invalid_marketDate: ${marketDate}`);
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const fromDate = new Date(baseDate.getTime() - (clampedDays - 1) * msPerDay);

  const ymd = (d: Date): string => d.toISOString().slice(0, 10);
  const from = ymd(fromDate);
  const to = ymd(baseDate);

  const bars = await fetchDailyBarsRange(symbol, { from, to, interval });

  const cacheRef = db
    .collection(RS_SYMBOL_CACHE_COLLECTION)
    .doc(marketDate)
    .collection(RS_SYMBOL_CACHE_SYMBOLS_SUBCOL)
    .doc(symbol);

  const existingSnap = await cacheRef.get();
  const existing = (existingSnap.exists ? (existingSnap.data() as Partial<RsSymbolCacheDoc>) : {}) || {};

  const cacheDoc: RsSymbolCacheDoc = {
    dailyBars: interval === 'DAILY' ? (bars ?? null) : (existing.dailyBars ?? null),
    weeklyBars: interval === 'WEEKLY' ? (bars ?? null) : (existing.weeklyBars ?? null),
    monthlyBars: interval === 'MONTHLY' ? (bars ?? null) : (existing.monthlyBars ?? null),
    fetchedAt: FieldValue.serverTimestamp() as FirebaseFirestore.Timestamp,
    runId,
  };

  await cacheRef.set(cacheDoc, { merge: false });
  return cacheDoc;
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
