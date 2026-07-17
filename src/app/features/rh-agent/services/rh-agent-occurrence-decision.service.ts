/**
 * RH Agent Occurrence Decision Service
 *
 * Persists durable user decisions (ACCEPT / REJECT) for specific signal
 * occurrences and records when an accepted occurrence is executed.
 * Each decision is keyed by the source run, symbol, timeframe, and signal type
 * so multiple intraday occurrences do not overwrite one another.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  onSnapshot,
  Query,
  QueryDocumentSnapshot,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import {
  RhAgentSignalItem,
  RhAgentOccurrenceDecision,
  DurableDecisionType,
} from './rh-agent.types';
import { requireUserId, buildRhAgentOccurrenceDecisionId } from './rh-agent-firestore-helpers';
import { RhAgentReviewDecision, SignalDirection, SignalTimeframe } from '../common/rh-agent.constants';

export interface PersistOccurrenceDecisionInput {
  runId: string;
  marketDate: string;
  signal: RhAgentSignalItem;
  decisionType: DurableDecisionType;
  notes?: string;
}

@Injectable({
  providedIn: 'root',
})
export class RhAgentOccurrenceDecisionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  private readonly decisionsCollection = collection(this.firestore, Collection.RH_OCCURRENCE_DECISIONS);

  /** Persist a decision for a single signal occurrence. */
  persistDecision(input: PersistOccurrenceDecisionInput): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const symbol = input.signal.symbol.toUpperCase();
        const id = buildRhAgentOccurrenceDecisionId(input.runId, symbol, input.signal.timeframe, input.signal.signalType);
        const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);

        const nowIso = new Date().toISOString();

        await writeBatch(this.firestore)
          .set(docRef, {
            userId,
            runId: input.runId,
            marketDate: input.marketDate,
            symbol,
            timeframe: input.signal.timeframe,
            direction: input.signal.direction,
            signalType: input.signal.signalType,
            barDate: input.signal.barDate,
            decisionType: input.decisionType,
            decidedAt: nowIso,
            isCurrentInLatestRun: true,
            notes: input.notes ?? null,
            indicators: input.signal.indicators ?? {},
            updatedAt: nowIso,
          }, { merge: true })
          .commit();
      })),
      map(() => undefined)
    );
  }

  /** Persist the same decision type for multiple signal occurrences in one batch. */
  persistDecisionsBatch(runId: string, marketDate: string, signals: RhAgentSignalItem[], decisionType: DurableDecisionType): Observable<void> {
    if (signals.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const nowIso = new Date().toISOString();
        const batch = writeBatch(this.firestore);
        for (const signal of signals) {
          const symbol = signal.symbol.toUpperCase();
          const id = buildRhAgentOccurrenceDecisionId(runId, symbol, signal.timeframe, signal.signalType);
          const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);
          batch.set(docRef, {
            userId,
            runId,
            marketDate,
            symbol,
            timeframe: signal.timeframe,
            direction: signal.direction,
            signalType: signal.signalType,
            barDate: signal.barDate,
            decisionType,
            decidedAt: nowIso,
            isCurrentInLatestRun: true,
            notes: null,
            indicators: signal.indicators ?? {},
            updatedAt: nowIso,
          }, { merge: true });
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete a decision for a specific occurrence. */
  deleteDecision(runId: string, symbol: string, timeframe: SignalTimeframe, signalType: string): Observable<void> {
    return this.deleteDecisionsBatch(runId, [{ symbol, timeframe, signalType }]);
  }

  /** Delete occurrence decisions by their full Firestore doc IDs. */
  deleteDecisionIds(ids: string[]): Observable<void> {
    if (ids.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const batch = writeBatch(this.firestore);
        for (const id of ids) {
          const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);
          batch.delete(docRef);
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Delete decisions for multiple occurrences of the same run. */
  deleteDecisionsBatch(
    runId: string,
    keys: { symbol: string; timeframe: SignalTimeframe; signalType: string }[]
  ): Observable<void> {
    if (keys.length === 0) return of(undefined);
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() => runInInjectionContext(this.injector, async () => {
        const batch = writeBatch(this.firestore);
        for (const key of keys) {
          const symbol = key.symbol.toUpperCase();
          const id = buildRhAgentOccurrenceDecisionId(runId, symbol, key.timeframe, key.signalType);
          const docRef = doc(this.firestore, Collection.RH_OCCURRENCE_DECISIONS, id);
          batch.delete(docRef);
        }
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Load all occurrence decisions for a specific source run, sorted by symbol/timeframe/signalType. */
  loadDecisionsForRun(runId: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return this.runQuery(q);
      }),
      map((decisions) => decisions.sort(this.sortDecisions))
    );
  }

  /** Load all decisions that are still current in the latest completed run, optionally filtered by symbol. */
  loadCurrentDecisions(symbol?: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const constraints: ReturnType<typeof where>[] = [
          where('userId', '==', userId),
          where('isCurrentInLatestRun', '==', true),
        ];
        if (symbol) {
          constraints.push(where('symbol', '==', symbol.toUpperCase()));
        }
        const q = query(this.decisionsCollection, ...constraints);
        return this.runQuery(q);
      }),
      map((decisions) => decisions.sort(this.sortDecisions))
    );
  }

  /**
   * Mark every decision for the given source run as no longer current.
   * Called when a newer run becomes the latest completed run.
   */
  markRunDecisionsNotCurrent(runId: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('runId', '==', runId),
          where('isCurrentInLatestRun', '==', true)
        );
        const snapshot = await getDocs(q);
        if (snapshot.empty) return;
        const nowIso = new Date().toISOString();
        const batch = writeBatch(this.firestore);
        snapshot.docs.forEach((d) => batch.update(d.ref, { isCurrentInLatestRun: false, updatedAt: nowIso }));
        await batch.commit();
      })),
      map(() => undefined)
    );
  }

  /** Load occurrence decisions across a market-date range. */
  loadDecisionsForDateRange(startDate: string, endDate: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('marketDate', '>=', startDate),
          where('marketDate', '<=', endDate)
        );
        return this.runQuery(q);
      }),
      map((decisions) => decisions.sort(this.sortDecisions))
    );
  }

  /** Subscribe to real-time updates for decisions in a specific run. */
  listenToDecisionsForRun(runId: string): Observable<RhAgentOccurrenceDecision[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return new Observable<RhAgentOccurrenceDecision[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(this.toDecisions(snapshot.docs).sort(this.sortDecisions));
          }, (error) => subscriber.error(error));
          return () => unsubscribe();
        });
      })
    );
  }

  private sortDecisions(a: RhAgentOccurrenceDecision, b: RhAgentOccurrenceDecision): number {
    return (
      a.symbol.localeCompare(b.symbol) ||
      a.timeframe.localeCompare(b.timeframe) ||
      a.signalType.localeCompare(b.signalType)
    );
  }

  private runQuery(q: Query<DocumentData>): Observable<RhAgentOccurrenceDecision[]> {
    return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(
      map((snapshot) => this.toDecisions(snapshot.docs))
    );
  }

  private toDecisions(docs: QueryDocumentSnapshot<DocumentData>[]): RhAgentOccurrenceDecision[] {
    return docs.map((d) => parseOccurrenceDecision(d.data(), d.id));
  }
}

function isDurableDecisionType(value: unknown): value is DurableDecisionType {
  return value === RhAgentReviewDecision.ACCEPT || value === RhAgentReviewDecision.REJECT;
}

function isIndicatorRecord(value: unknown): value is Record<string, number | string | null> {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([, v]) => v === null || typeof v === 'number' || typeof v === 'string'
  );
}

function parseOccurrenceDecision(data: DocumentData, id: string): RhAgentOccurrenceDecision {
  const requireString = (field: string) => {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`[OccurrenceDecisionService] Decision doc ${id} is missing or invalid required field "${field}"`);
    }
  };
  const optionalString = (field: string) => {
    const value = data[field];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid optional field "${field}"`);
    }
  };

  requireString('runId');
  requireString('marketDate');
  requireString('symbol');
  requireString('signalType');
  requireString('barDate');
  requireString('decidedAt');

  const timeframe = data['timeframe'];
  if (timeframe !== SignalTimeframe.DAILY && timeframe !== SignalTimeframe.WEEKLY) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "timeframe": ${String(timeframe)}`);
  }

  const direction = data['direction'];
  if (direction !== SignalDirection.LONG && direction !== SignalDirection.SHORT) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "direction": ${String(direction)}`);
  }

  const decisionType = data['decisionType'];
  if (!isDurableDecisionType(decisionType)) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "decisionType": ${String(decisionType)}`);
  }

  const isCurrent = data['isCurrentInLatestRun'];
  if (typeof isCurrent !== 'boolean') {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "isCurrentInLatestRun": ${String(isCurrent)}`);
  }

  optionalString('userId');
  optionalString('notes');

  const indicators = data['indicators'];
  if (indicators !== undefined && !isIndicatorRecord(indicators)) {
    throw new Error(`[OccurrenceDecisionService] Decision doc ${id} has invalid "indicators"`);
  }

  return {
    id,
    runId: data['runId'] as string,
    marketDate: data['marketDate'] as string,
    symbol: data['symbol'] as string,
    timeframe,
    direction,
    signalType: data['signalType'] as string,
    barDate: data['barDate'] as string,
    decisionType,
    decidedAt: data['decidedAt'] as string,
    isCurrentInLatestRun: isCurrent,
    userId: data['userId'] as string | undefined,
    notes: data['notes'] as string | undefined,
    indicators: indicators as Record<string, number | string | null> | undefined,
  };
}
