import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { httpsCallableData } from '@angular/fire/functions';
import { Functions } from '@angular/fire/functions';
import type { OHLCDatum } from '../shared/types/rs.interfaces';
import { Timeframe } from '../shared/types/rs.interfaces';
import { BarsInterval } from '../../core/models/partner.types';

interface GetPairDailyBarsRequest {
  symbol: string;
  interval?: BarsInterval;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  adjusted?: boolean;
}

interface PartnerDailyBarDTO {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  issues?: string[];
}

interface GetPairDailyBarsResponse {
  bars: PartnerDailyBarDTO[];
}

/**
 * RsDataService
 * Responsible for fetching OHLC and related data for symbols across different timeframes.
 * Uses Firebase callable functions to fetch real data from SavantAPI.
 */
@Injectable({ providedIn: 'root' })
export class RsDataService {
  private readonly http = inject(HttpClient);
  private readonly functions = inject(Functions);

  /**
   * Fetch OHLC data for a single symbol and timeframe.
   * Uses the getPairDailyBars callable function which supports D/W/M intervals.
   */
  fetchOhlcForSymbol(symbol: string, timeframe: Timeframe): Observable<OHLCDatum[]> {
    // Map frontend Timeframe to backend interval
    const interval = this.mapTimeframeToInterval(timeframe);
    
    // Calculate date range (last 2 years of data)
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setFullYear(fromDate.getFullYear() - 2);
    
    const request: GetPairDailyBarsRequest = {
      symbol: symbol.toUpperCase(),
      interval,
      from: this.formatDate(fromDate),
      to: this.formatDate(toDate),
      adjusted: true
    };

    const getPairDailyBars = httpsCallableData<GetPairDailyBarsRequest, GetPairDailyBarsResponse>(
      this.functions,
      'getPairDailyBars'
    );

    return getPairDailyBars(request).pipe(
      map(response => {
        const bars = response?.bars || [];
        return bars.map(bar => this.convertToOHLCDatum(bar));
      })
    );
  }

  /**
   * Fetch OHLC data for multiple symbols in parallel, returning a map keyed by symbol.
   */
  fetchOhlcForSymbols(symbols: string[], timeframe: Timeframe): Observable<Record<string, OHLCDatum[]>> {
    if (!symbols.length) return of({});
    const calls = symbols.map((s) => this.fetchOhlcForSymbol(s, timeframe));
    return forkJoin(calls).pipe(
      map((results) => {
        const out: Record<string, OHLCDatum[]> = {};
        symbols.forEach((s, i) => (out[s] = results[i] ?? []));
        return out;
      })
    );
  }

  /**
   * Map frontend Timeframe enum to backend BarsInterval enum
   */
  private mapTimeframeToInterval(timeframe: Timeframe): BarsInterval {
    switch (timeframe) {
      case Timeframe.WEEKLY:
        return BarsInterval.WEEKLY;
      case Timeframe.MONTHLY:
        return BarsInterval.MONTHLY;
      case Timeframe.DAILY:
      default:
        return BarsInterval.DAILY;
    }
  }

  /**
   * Convert PartnerDailyBarDTO to OHLCDatum format expected by frontend
   */
  private convertToOHLCDatum(bar: PartnerDailyBarDTO): OHLCDatum {
    return {
      x: new Date(bar.date + 'T00:00:00Z'),
      date: bar.date,
      open: bar.open ?? 0,
      high: bar.high ?? 0,
      low: bar.low ?? 0,
      close: bar.close ?? 0,
      volume: bar.volume
    };
  }

  /**
   * Format date as YYYY-MM-DD string
   */
  private formatDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
