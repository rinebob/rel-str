import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin, of } from 'rxjs';
import { map } from 'rxjs/operators';
import type { OHLCDatum, Timeframe } from '../shared/types/rs.interfaces';

/**
 * RsDataService
 * Responsible for fetching OHLC and related data for symbols. This is a scaffold
 * that exposes typed methods; actual HTTP endpoints will be integrated later.
 */
@Injectable({ providedIn: 'root' })
export class RsDataService {
  private readonly http = inject(HttpClient);

  /**
   * Fetch OHLC data for a single symbol and timeframe.
   * Currently returns an empty array as a placeholder.
   */
  fetchOhlcForSymbol(symbol: string, timeframe: Timeframe): Observable<OHLCDatum[]> {
    // TODO: Integrate real API endpoint via HttpClient
    // # Reason: Placeholder to allow wiring UI/Store without choosing provider yet.
    return of<OHLCDatum[]>([]);
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
}
