/**
 * Savant Trader Signal Service
 *
 * Focused service for symbol profiles, signal queries, and signal history.
 * Extracted from the monolithic StService.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, getDocs, orderBy, DocumentData } from '@angular/fire/firestore';
import { Observable, from, of, map, take } from 'rxjs';

import {
  type StSymbolProfile,
  type StSignalItem,
} from './types';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import { mapSymbolProfile } from '../utils/utils';
import { ST_SIGNALS_ROOT, ST_SYMBOLS_ROOT } from '@st/collections';

function isSignalTimeframe(value: unknown): value is SignalTimeframe {
  return value === SignalTimeframe.DAILY || value === SignalTimeframe.WEEKLY;
}

function isSignalStatus(value: unknown): value is SignalStatus {
  return value === SignalStatus.INTERIM || value === SignalStatus.CONFIRMED;
}

function isIndicatorRecord(value: unknown): value is Record<string, number | string | null> {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([, v]) => v === null || typeof v === 'number' || typeof v === 'string'
  );
}

/**
 * Map a canonical st-signals occurrence doc to StSignalItem (#1019).
 * Deliberately stricter than the legacy entry parser (which skipped
 * malformed entries): a malformed doc in the sole signal record is a
 * writer bug and fails the read loudly rather than hiding a signal.
 */
function stSignalDocToItem(docId: string, d: DocumentData, runId: string): StSignalItem {
  const barDate = d['barDate'];
  const signalType = d['signalType'];
  if (typeof barDate !== 'string' || barDate.length === 0) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "barDate"`);
  }
  if (typeof signalType !== 'string' || signalType.length === 0) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "signalType"`);
  }

  const symbol = d['symbol'];
  if (typeof symbol !== 'string' || symbol.length === 0) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "symbol"`);
  }

  const marketDate = d['marketDate'];
  if (typeof marketDate !== 'string' || marketDate.length === 0) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "marketDate"`);
  }

  const timeframe = d['timeframe'];
  if (!isSignalTimeframe(timeframe)) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "timeframe": ${String(timeframe)}`);
  }

  // Canonical direction is the lowercase TradeSide; the FE enum is uppercase.
  const direction = String(d['direction'] ?? '').toUpperCase();
  if (direction !== SignalDirection.LONG && direction !== SignalDirection.SHORT) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "direction": ${String(d['direction'])}`);
  }

  const status = d['status'];
  if (!isSignalStatus(status)) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "status": ${String(status)}`);
  }

  const indicators = d['indicators'];
  if (!isIndicatorRecord(indicators)) {
    throw new Error(`[SignalService] st-signals doc ${docId} has invalid "indicators"`);
  }

  return {
    id: barDate,
    symbol,
    barDate,
    marketDate,
    runId,
    timeframe,
    direction,
    signalType,
    status,
    indicators,
  };
}

@Injectable({
  providedIn: 'root',
})
export class SignalService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);
  private injector = inject(EnvironmentInjector);

  /**
   * Primary grouped review query â€” run-centric.
   * Returns symbol profiles with a signal produced by the given runId for the given timeframe.
   */
  getSymbolsWithSignals(runId: string, timeframe: SignalTimeframe): Observable<StSymbolProfile[]> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<{ runId: string; timeframe: SignalTimeframe }, { symbols: StSymbolProfile[] }>(this.functions, 'stGetSymbolsWithSignals');
      return callable({ runId, timeframe });
    })).pipe(map((r) => r.data.symbols));
  }

  /**
   * All enabled tracked symbols â€” direct Firestore read, no callable.
   * Used for the "Show all symbols" toggle in grouped review.
   */
  getAllSymbols(): Observable<StSymbolProfile[]> {
    const ref = collection(this.firestore, ST_SYMBOLS_ROOT);
    const q = query(ref, where('enabled', '==', true));
    // Raw Firestore docs contain Timestamp fields; we map them to strings below.
    return (runInInjectionContext(this.injector, () => collectionData(q, { idField: 'symbol' })) as Observable<Record<string, unknown>[]>).pipe(
      map(docs => docs.map(d => mapSymbolProfile(d)))
    );
  }

  /**
   * Enabled symbols added to st-symbols within the last N days. Used by
   * chart-review to surface newly tracked symbols for quick review.
   *
   * createdAt is stored as an ISO string, so the cutoff is also an ISO string.
   *
   * Source is now normalized to StSymbolSource at write time, so no extra
   * client-side source filter is required.
   */
  getSymbolsAddedSince(daysAgo: number): Observable<StSymbolProfile[]> {
    const ref = collection(this.firestore, ST_SYMBOLS_ROOT);
    const cutoff = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const q = query(ref, where('enabled', '==', true), where('createdAt', '>=', cutoff));
    return (runInInjectionContext(this.injector, () => collectionData(q, { idField: 'symbol' })) as Observable<Record<string, unknown>[]>).pipe(
      map(docs => docs.map(d => mapSymbolProfile(d)))
    );
  }

  /**
   * Enabled symbols that have no createdAt/source (i.e., orphan/unbackfilled docs)
   * and are not present in any of the supplied list symbol sets. This surfaces
   * manually added symbols that have not yet been backfilled/organized.
   */
  getUnbackfilledSymbols(excludedSymbols: string[]): Observable<StSymbolProfile[]> {
    const ref = collection(this.firestore, ST_SYMBOLS_ROOT);
    const q = query(ref, where('enabled', '==', true));
    const excluded = new Set(excludedSymbols.map((s) => s.toUpperCase()));
    return (runInInjectionContext(this.injector, () => collectionData(q, { idField: 'symbol' })) as Observable<Record<string, unknown>[]>).pipe(
      map(docs =>
        docs
          .map(d => mapSymbolProfile(d))
          .filter(p => !excluded.has(p.symbol.toUpperCase()) && !p.createdAt)
      )
    );
  }

  /**
   * Signals a specific run (re)detected for a symbol — st-signals occurrences
   * with runId in runIds[] (#1019; supersedes the run-ids/{runId} doc).
   * Used by grouped review to show only the signals produced by the active run.
   * Carries the canonical status (INTERIM until the nightly confirm).
   */
  getSymbolSignalsForRun(symbol: string, runId: string): Observable<StSignalItem[]> {
    const ref = collection(this.firestore, ST_SIGNALS_ROOT);
    const q = query(ref, where('symbol', '==', symbol), where('runIds', 'array-contains', runId));
    return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(
      map((snapshot) => {
        const signals = snapshot.docs.map((docSnap) => stSignalDocToItem(docSnap.id, docSnap.data(), runId));
        signals.sort((a, b) => b.barDate.localeCompare(a.barDate));
        return signals;
      })
    );
  }

  /**
   * Signals for a specific run, preferring the in-memory history cache when it
   * already contains signals for the requested symbol/run pair.
   */
  getCurrentRunSignalsForSymbol(
    symbol: string,
    runId: string,
    historyCache: Record<string, StSignalItem[]>
  ): Observable<StSignalItem[]> {
    const runKey = `${symbol.toUpperCase()}::${runId}`;
    if (historyCache[runKey]?.length) {
      return of(historyCache[runKey]!);
    }
    return this.getSymbolSignalsForRun(symbol, runId).pipe(take(1));
  }

  /**
   * Per-symbol signal history from canonical st-signals (#1019 — supersedes
   * the nightly-only signal-history subcollection; INTERIM occurrences are
   * now included with their real status). Returns all signals sorted by
   * barDate desc.
   */
  getSymbolSignalHistoryFromHistory(symbol: string): Observable<StSignalItem[]> {
    const ref = collection(this.firestore, ST_SIGNALS_ROOT);
    const recentQuery = query(ref, where('symbol', '==', symbol), orderBy('barDate', 'desc'));
    return from(runInInjectionContext(this.injector, () => getDocs(recentQuery))).pipe(
      map((snapshot) => {
        const signals = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          const sourceRunId = d['sourceRunId'];
          if (typeof sourceRunId !== 'string' || sourceRunId.length === 0) {
            throw new Error(`[SignalService] st-signals doc ${docSnap.id} for ${symbol} is missing sourceRunId`);
          }
          return stSignalDocToItem(docSnap.id, d, sourceRunId);
        });
        signals.sort((a, b) => b.barDate.localeCompare(a.barDate));
        return signals;
      })
    );
  }
}
