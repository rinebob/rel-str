import { onCall } from 'firebase-functions/v2/https';
import * as logger from 'firebase-functions/logger';

import { fetchDailyBarsRange, PartnerBar } from './webhooks/symbol-fetch';

/**
 * Supported bar intervals for Savant / RS chart OHLC requests.
 * Keep in sync with frontend BarsInterval in src/app/core/models/partner.types.ts
 */
export enum BarsInterval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

/** Public DTO for OHLCV bars exposed to the FE.
 * The caller must provide an explicit [from,to] calendar window; any
 * yearsBack-style sugar is resolved on the caller side.
 */
export interface GetPairDailyBarsRequest {
  symbol: string;
  interval?: BarsInterval;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface PartnerDailyBarDTO {
  /** Canonical trading day (YYYY-MM-DD, UTC). */
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  /** Issues detected while normalizing this bar (e.g., missing/invalid OHLC). */
  issues?: string[];
}

export interface GetPairDailyBarsResponse {
  bars: PartnerDailyBarDTO[];
}

export function normalizePartnerDailyBar(b: PartnerBar): PartnerDailyBarDTO {
  const date = String((b as any)?.d || '').trim();
  const open = Number((b as any)?.o);
  const high = Number((b as any)?.h);
  const low = Number((b as any)?.l);
  const close = Number((b as any)?.c);
  const volume = Number((b as any)?.v);

  const issues: string[] = [];
  if (!date) issues.push('missing_date');
  if (!Number.isFinite(open)) issues.push('open_nonfinite');
  if (!Number.isFinite(high)) issues.push('high_nonfinite');
  if (!Number.isFinite(low)) issues.push('low_nonfinite');
  if (!Number.isFinite(close)) issues.push('close_nonfinite');

  const base: PartnerDailyBarDTO = { date };
  if (Number.isFinite(open)) base.open = open;
  if (Number.isFinite(high)) base.high = high;
  if (Number.isFinite(low)) base.low = low;
  if (Number.isFinite(close)) base.close = close;
  if (Number.isFinite(volume) && volume > 0) base.volume = volume;
  if (issues.length) base.issues = issues;
  return base;
}

/**
 * getPairDailyBars — Fetch normalized daily OHLCV bars for a symbol via SavantAPI.
 *
 * This wraps partnerTimeSeriesV2 behind a callable and returns a stable DTO for FE
 * consumption. Bars with incomplete or invalid OHLC are included with `issues[]`
 * so the FE can treat them as gaps rather than fabricating candles.
 *
 * Note: Weekends and market holidays simply have no bars in the upstream
 * time series; they are not considered "missing" and are not flagged.
 */
export const getPairDailyBars = onCall(
  { region: 'us-central1' },
  async (req): Promise<GetPairDailyBarsResponse> => {
    const { symbol, interval, from, to } = (req.data || {}) as GetPairDailyBarsRequest;
    const sym = String(symbol || '').trim().toUpperCase();

    if (!sym) {
      return { bars: [] };
    }

    try {
      const bars = await fetchDailyBarsRange(sym, {
        interval: interval ?? 'DAILY',
        from,
        to,
      });

      const dto: PartnerDailyBarDTO[] = (Array.isArray(bars) ? bars : []).map((b: PartnerBar) => normalizePartnerDailyBar(b));

      logger.info('getPairDailyBars', { symbol: sym, count: dto.length });
      return { bars: dto };
    } catch (e: any) {
      logger.error('getPairDailyBars_error', { symbol: sym, message: e?.message });
      return { bars: [] };
    }
  },
);
