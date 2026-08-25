/**
 * Savant Trader Signal Service
 *
 * Focused service for symbol profiles, signal queries, and signal history.
 * Extracted from the monolithic StService.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, doc, getDoc, getDocs, orderBy, DocumentData } from '@angular/fire/firestore';
import { Observable, from, of, map, take } from 'rxjs';

import {
  type StSymbolProfile,
  type StSignalItem,
} from './types';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import { mapSymbolProfile } from '../utils/utils';
import { Collection } from '../../../core/common/constants';

function isSignalTimeframe(value: unknown): value is SignalTimeframe {
  return value === SignalTimeframe.DAILY || value === SignalTimeframe.WEEKLY;
}

function isSignalDirection(value: unknown): value is SignalDirection {
  return value === SignalDirection.LONG || value === SignalDirection.SHORT;
}

function isIndicatorRecord(value: unknown): value is Record<string, number | string | null> {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([, v]) => v === null || typeof v === 'number' || typeof v === 'string'
  );
}

interface SignalEntryContext {
  id: string;
  symbol: string;
  runId: string;
  /** Canonical market date for all signals in the source document. */
  marketDate: string;
  status: SignalStatus;
}

function collectSignalEntries(data: DocumentData): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];

  const signals = data['signals'];
  if (signals && typeof signals === 'object') {
    for (const value of Object.values(signals as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        entries.push(value as Record<string, unknown>);
      }
    }
  }

  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('signals.') && value && typeof value === 'object') {
      entries.push(value as Record<string, unknown>);
    }
  }

  return entries;
}

function parseSignalEntry(raw: unknown, ctx: SignalEntryContext): StSignalItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const signalType = e['signalType'];
  const barDate = e['barDate'];
  if (typeof signalType !== 'string' || typeof barDate !== 'string') return null;

  const timeframe = e['timeframe'];
  if (!isSignalTimeframe(timeframe)) {
    throw new Error(`[SignalService] Signal entry has invalid "timeframe": ${String(timeframe)}`);
  }

  const direction = e['direction'];
  if (!isSignalDirection(direction)) {
    throw new Error(`[SignalService] Signal entry has invalid "direction": ${String(direction)}`);
  }

  const indicators = e['indicators'];
  if (!isIndicatorRecord(indicators)) {
    throw new Error(`[SignalService] Signal entry has invalid "indicators"`);
  }

  const close = e['close'];
  if (close !== undefined && typeof close !== 'number') {
    throw new Error(`[SignalService] Signal entry has invalid "close": ${String(close)}`);
  }

  return {
    id: ctx.id,
    symbol: ctx.symbol,
    barDate,
    marketDate: ctx.marketDate,
    runId: ctx.runId,
    timeframe,
    direction,
    signalType,
    status: ctx.status,
    indicators,
    closePrice: close,
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
    const ref = collection(this.firestore, Collection.ST_SYMBOLS);
    const q = query(ref, where('enabled', '==', true));
    // Raw Firestore docs contain Timestamp fields; we map them to strings below.
    return (runInInjectionContext(this.injector, () => collectionData(q, { idField: 'symbol' })) as Observable<Record<string, unknown>[]>).pipe(
      map(docs => docs.map(d => mapSymbolProfile(d)))
    );
  }

  /**
   * Enabled symbols added to savant-trader/data/symbols within the last N days. Used by
   * chart-review to surface newly tracked symbols for quick review.
   *
   * createdAt is stored as an ISO string, so the cutoff is also an ISO string.
   *
   * Source is now normalized to StSymbolSource at write time, so no extra
   * client-side source filter is required.
   */
  getSymbolsAddedSince(daysAgo: number): Observable<StSymbolProfile[]> {
    const ref = collection(this.firestore, Collection.ST_SYMBOLS);
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
    const ref = collection(this.firestore, Collection.ST_SYMBOLS);
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
   * Signals for a specific run from savant-trader/data/symbols/{symbol}/run-ids/{runId}.
   * Used by grouped review to show only the signals produced by the active run.
   */
  getSymbolSignalsForRun(symbol: string, runId: string): Observable<StSignalItem[]> {
    const runDocRef = doc(this.firestore, Collection.ST_SYMBOLS, symbol, 'run-ids', runId);
    return from(runInInjectionContext(this.injector, () => getDoc(runDocRef))).pipe(
      map((snap) => {
        if (!snap.exists()) return [];
        const d = snap.data();
        const signals: StSignalItem[] = [];
        const marketDate = d['marketDate'];
        if (typeof marketDate !== 'string' || marketDate.length === 0) {
          throw new Error(`[SignalService] Run doc ${runId} for ${symbol} is missing marketDate`);
        }

        for (const entry of collectSignalEntries(d)) {
          const barDate = entry['barDate'];
          if (typeof barDate !== 'string' || barDate.length === 0) continue;
          const signal = parseSignalEntry(entry, {
            id: barDate,
            symbol,
            runId,
            marketDate,
            status: SignalStatus.INTERIM,
          });
          if (signal) signals.push(signal);
        }

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
   * Per-symbol signal history from the canonical signal-history subcollection.
   * Reads directly from Firestore: savant-trader/data/symbols/{symbol}/signal-history/*
   * Returns all signals sorted by barDate desc.
   */
  getSymbolSignalHistoryFromHistory(symbol: string): Observable<StSignalItem[]> {
    const symbolDocRef = doc(this.firestore, Collection.ST_SYMBOLS, symbol);
    const signalHistoryRef = collection(symbolDocRef, 'signal-history');

    const recentQuery = query(signalHistoryRef, orderBy('date', 'desc'));
    return from(runInInjectionContext(this.injector, () => getDocs(recentQuery))).pipe(
      map((snapshot) => {
        const signals: StSignalItem[] = [];
        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();
          const runId = typeof d['sourceRunId'] === 'string'
            ? d['sourceRunId']
            : typeof d['runId'] === 'string'
              ? d['runId']
              : undefined;
          if (typeof runId !== 'string' || runId.length === 0) {
            throw new Error(`[SignalService] Signal history doc ${docSnap.id} for ${symbol} is missing runId`);
          }
          const marketDate = d['marketDate'];
          if (typeof marketDate !== 'string' || marketDate.length === 0) {
            throw new Error(`[SignalService] Signal history doc ${docSnap.id} for ${symbol} is missing marketDate`);
          }

          for (const entry of collectSignalEntries(d)) {
            const barDate = entry['barDate'];
            if (typeof barDate !== 'string' || barDate.length === 0) continue;
            const signal = parseSignalEntry(entry, {
              id: docSnap.id,
              symbol,
              runId,
              marketDate,
              status: SignalStatus.CONFIRMED,
            });
            if (signal) signals.push(signal);
          }
        }
        signals.sort((a, b) => b.barDate.localeCompare(a.barDate));
        return signals;
      })
    );
  }
}
