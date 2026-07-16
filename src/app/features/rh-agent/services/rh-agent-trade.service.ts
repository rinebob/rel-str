/**
 * RH Agent Trade Service
 *
 * Persists real trades placed from accepted RH Agent occurrences.
 * Each trade record captures entry, size, stop, and eventual exit/outcome data,
 * keeping execution details separate from review decisions and generated signals.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collectionGroup,
  getDocs,
  query,
  where,
  onSnapshot,
  Query,
  QueryDocumentSnapshot,
  DocumentData,
  type FirestoreDataConverter,
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Subcollection } from '../../../core/common/constants';
import { requireUserId } from './rh-agent-firestore-helpers';
import { RhAgentTrade, RhAgentTradeDoc, RhAgentTradeStatus, SignalDirection } from './rh-agent.types';
import { SignalTimeframe } from '../common/rh-agent.constants';

@Injectable({
  providedIn: 'root',
})
export class RhAgentTradeService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Load all trades for a specific source run across all symbol subcollections. */
  loadTradesForRun(runId: string): Observable<RhAgentTrade[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => {
        const q = query(
          collectionGroup(this.firestore, Subcollection.TRADES).withConverter(tradeConverter),
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return this.runQuery(q);
      })
    );
  }

  /** Subscribe to real-time trade updates for a specific run. */
  listenToTradesForRun(runId: string): Observable<RhAgentTrade[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) => {
        const q = query(
          collectionGroup(this.firestore, Subcollection.TRADES).withConverter(tradeConverter),
          where('userId', '==', userId),
          where('runId', '==', runId)
        );
        return new Observable<RhAgentTrade[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(this.toTrades(snapshot.docs));
          }, (error) => subscriber.error(error));
          return () => unsubscribe();
        });
      })
    );
  }

  private runQuery(q: Query<RhAgentTradeDoc>): Observable<RhAgentTrade[]> {
    return from(runInInjectionContext(this.injector, () => getDocs(q))).pipe(
      map((snapshot) => this.toTrades(snapshot.docs))
    );
  }

  private toTrades(docs: QueryDocumentSnapshot<RhAgentTradeDoc>[]): RhAgentTrade[] {
    return docs.map((d) => this.toTrade(d));
  }

  private toTrade(d: QueryDocumentSnapshot<RhAgentTradeDoc>): RhAgentTrade {
    const data = d.data();
    return {
      id: d.id,
      userId: data.userId,
      runId: data.runId,
      marketDate: data.marketDate,
      occurrenceDecisionId: data.occurrenceDecisionId,
      symbol: data.symbol,
      direction: data.direction,
      timeframe: data.timeframe,
      signalType: data.signalType,
      barDate: data.barDate,
      status: data.status,
      entryAt: data.entryAt,
      entryPrice: data.entryPrice,
      positionSize: data.positionSize,
      quantity: data.quantity,
      stopPrice: data.stopPrice,
      exitAt: data.exitAt,
      exitPrice: data.exitPrice,
      realizedPnl: data.realizedPnl,
      notes: data.notes,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }
}

const tradeConverter: FirestoreDataConverter<RhAgentTradeDoc> = {
  toFirestore(modelObject: RhAgentTradeDoc): DocumentData {
    const { id, ...rest } = modelObject as RhAgentTrade;
    return rest;
  },
  fromFirestore(snapshot: QueryDocumentSnapshot<DocumentData>): RhAgentTradeDoc {
    const data = snapshot.data();
    assertTradeDoc(data, snapshot.id);
    return data;
  },
};

function assertTradeDoc(data: DocumentData, docId: string): asserts data is RhAgentTradeDoc {
  const requireString = (field: string) => {
    const value = data[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`[TradeService] Trade doc ${docId} is missing or invalid required field "${field}"`);
    }
  };
  const requireNumber = (field: string) => {
    const value = data[field];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`[TradeService] Trade doc ${docId} is missing or invalid required numeric field "${field}"`);
    }
  };
  const optionalString = (field: string) => {
    const value = data[field];
    if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
      throw new Error(`[TradeService] Trade doc ${docId} has invalid optional field "${field}"`);
    }
  };
  const optionalNumber = (field: string) => {
    const value = data[field];
    if (value !== undefined && (typeof value !== 'number' || Number.isNaN(value))) {
      throw new Error(`[TradeService] Trade doc ${docId} has invalid optional numeric field "${field}"`);
    }
  };

  requireString('runId');
  requireString('marketDate');
  requireString('symbol');
  requireString('signalType');
  requireString('barDate');
  requireString('entryAt');
  requireString('createdAt');
  requireNumber('entryPrice');
  requireNumber('positionSize');
  requireNumber('quantity');

  const status = data['status'];
  if (status !== RhAgentTradeStatus.OPEN && status !== RhAgentTradeStatus.CLOSED) {
    throw new Error(`[TradeService] Trade doc ${docId} has invalid "status": ${String(status)}`);
  }

  const direction = data['direction'];
  if (direction !== SignalDirection.LONG && direction !== SignalDirection.SHORT) {
    throw new Error(`[TradeService] Trade doc ${docId} has invalid "direction": ${String(direction)}`);
  }

  const timeframe = data['timeframe'];
  if (timeframe !== SignalTimeframe.DAILY && timeframe !== SignalTimeframe.WEEKLY) {
    throw new Error(`[TradeService] Trade doc ${docId} has invalid "timeframe": ${String(timeframe)}`);
  }

  optionalString('userId');
  optionalString('occurrenceDecisionId');
  optionalString('exitAt');
  optionalString('notes');
  optionalString('updatedAt');
  optionalNumber('stopPrice');
  optionalNumber('exitPrice');
  optionalNumber('realizedPnl');
}
