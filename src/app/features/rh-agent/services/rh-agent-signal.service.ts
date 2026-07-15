/**
 * RH Agent Signal Service
 *
 * Focused service for symbol profiles, signal queries, and signal history.
 * Extracted from the monolithic RhAgentService.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, query, where, doc, getDoc, getDocs, orderBy } from '@angular/fire/firestore';
import { Observable, from, of, map, take } from 'rxjs';

import {
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
} from './rh-agent.types';
import { mapSymbolProfile } from '../utils/rh-agent.utils';

@Injectable({
  providedIn: 'root',
})
export class RhAgentSignalService {
  private functions = inject(Functions);
  private firestore = inject(Firestore);
  private injector = inject(EnvironmentInjector);

  /**
   * Primary grouped review query — run-centric.
   * Returns symbol profiles with a signal produced by the given runId for the given timeframe.
   */
  getSymbolsWithSignals(runId: string, timeframe: 'W' | 'D'): Observable<RhAgentSymbolProfile[]> {
    return from(runInInjectionContext(this.injector, () => {
      const callable = httpsCallable<{ runId: string; timeframe: 'W' | 'D' }, { symbols: RhAgentSymbolProfile[] }>(this.functions, 'rhAgentGetSymbolsWithSignals');
      return callable({ runId, timeframe });
    })).pipe(map((r) => r.data.symbols));
  }

  /**
   * All enabled tracked symbols — direct Firestore read, no callable.
   * Used for the "Show all symbols" toggle in grouped review.
   */
  getAllSymbols(): Observable<RhAgentSymbolProfile[]> {
    const ref = collection(this.firestore, 'rh-agent-symbols');
    const q = query(ref, where('enabled', '==', true));
    // Raw Firestore docs contain Timestamp fields; we map them to strings below.
    return (runInInjectionContext(this.injector, () => collectionData(q, { idField: 'symbol' })) as Observable<Record<string, unknown>[]>).pipe(
      map(docs => docs.map(d => mapSymbolProfile(d)))
    );
  }

  /**
   * Enabled symbols added to rh-agent-symbols within the last N days. Used by
   * chart-review to surface newly tracked symbols for quick review.
   *
   * createdAt is stored as an ISO string, so the cutoff is also an ISO string.
   *
   * Source is now normalized to RhAgentSymbolSource at write time, so no extra
   * client-side source filter is required.
   */
  getSymbolsAddedSince(daysAgo: number): Observable<RhAgentSymbolProfile[]> {
    const ref = collection(this.firestore, 'rh-agent-symbols');
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
  getUnbackfilledSymbols(excludedSymbols: string[]): Observable<RhAgentSymbolProfile[]> {
    const ref = collection(this.firestore, 'rh-agent-symbols');
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
   * Signals for a specific run from rh-agent-symbols/{symbol}/run-ids/{runId}.
   * Used by grouped review to show only the signals produced by the active run.
   */
  getSymbolSignalsForRun(symbol: string, runId: string): Observable<RhAgentSignalItem[]> {
    const runDocRef = doc(this.firestore, 'rh-agent-symbols', symbol, 'run-ids', runId);
    return from(runInInjectionContext(this.injector, () => getDoc(runDocRef))).pipe(
      map((snap: any) => {
        if (!snap.exists()) return [];
        const d = snap.data();
        const signals: RhAgentSignalItem[] = [];

        // Signals are stored as dot-notation top-level fields: signals.D_ST_TREND_RIDER_V1_LONG etc.
        for (const key of Object.keys(d)) {
          if (!key.startsWith('signals.')) continue;
          const entry = d[key];
          if (!entry || typeof entry !== 'object') continue;
          if (!entry['signalType']) continue;
          signals.push({
            id: entry['barDate'] ?? runId,
            symbol,
            barDate: entry['barDate'] ?? '',
            marketDate: entry['marketDate'] ?? d['marketDate'] ?? '',
            runId,
            timeframe: entry['timeframe'] ?? 'D',
            direction: entry['direction'] ?? 'LONG',
            signalType: entry['signalType'],
            status: entry['status'] ?? 'INTERIM',
            indicators: entry['indicators'] ?? {},
          });
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
    historyCache: Record<string, RhAgentSignalItem[]>
  ): Observable<RhAgentSignalItem[]> {
    const runKey = `${symbol.toUpperCase()}::${runId}`;
    if (historyCache[runKey]?.length) {
      return of(historyCache[runKey]!);
    }
    return this.getSymbolSignalsForRun(symbol, runId).pipe(take(1));
  }

  /**
   * Per-symbol signal history from the canonical signal-history subcollection.
   * Reads directly from Firestore: rh-agent-symbols/{symbol}/signal-history/*
   * Returns all signals sorted by barDate desc.
   */
  getSymbolSignalHistoryFromHistory(symbol: string): Observable<RhAgentSignalItem[]> {
    const symbolDocRef = doc(this.firestore, 'rh-agent-symbols', symbol);
    const signalHistoryRef = collection(symbolDocRef, 'signal-history');

    const recentQuery = query(signalHistoryRef, orderBy('date', 'desc'));
    return from(runInInjectionContext(this.injector, () => getDocs(recentQuery))).pipe(
      map((snapshot) => {
        const signals: RhAgentSignalItem[] = [];
        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();

          const rawSignalEntry = (entry: unknown): Partial<RhAgentSignalItem> | null => {
            if (!entry || typeof entry !== 'object') return null;
            const e = entry as Record<string, unknown>;
            if (!e['signalType'] || typeof e['signalType'] !== 'string') return null;
            return e as Partial<RhAgentSignalItem>;
          };

          const entries: Partial<RhAgentSignalItem>[] = [];

          if (d['signals'] && typeof d['signals'] === 'object') {
            for (const entry of Object.values(d['signals'])) {
              const parsed = rawSignalEntry(entry);
              if (parsed) entries.push(parsed);
            }
          }

          for (const key of Object.keys(d)) {
            if (key.startsWith('signals.') && typeof d[key] === 'object') {
              const parsed = rawSignalEntry(d[key]);
              if (parsed) entries.push(parsed);
            }
          }

          for (const entry of entries) {
            signals.push({
              id: docSnap.id,
              symbol: d['symbol'] ?? symbol,
              barDate: entry.barDate ?? docSnap.id,
              marketDate: entry.marketDate ?? '',
              runId: d['sourceRunId'] ?? d['runId'] ?? '',
              timeframe: entry.timeframe ?? (String(entry.signalType ?? '').startsWith('W_') ? 'W' : 'D'),
              direction: (entry as any).action ?? entry.direction ?? 'LONG',
              signalType: entry.signalType!,
              status: 'CONFIRMED',
              indicators: entry.indicators ?? {},
            });
          }
        }
        signals.sort((a, b) => b.barDate.localeCompare(a.barDate));
        return signals;
      })
    );
  }
}
