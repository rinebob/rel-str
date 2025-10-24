import { logger } from 'firebase-functions/v2';
import { callPartnerTimeSeries } from '../partner-proxy';

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
    logger.info('partner_timeseries_response', { symbol, interval, from: fromIso, to: toIso, limit, bars: bars.length, firstDay, lastDay });
  } else {
    logger.info('partner_timeseries_response_empty', { symbol, interval, from: fromIso, to: toIso, limit, bars: 0 });
  }
  return bars as PartnerBar[];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
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
