/**
 * RH Agent Triage Service
 *
 * Persists RACR (Review / Accept / Consider / Reject / Exclude / etc.)
 * decisions to Firestore under the `rh-agent-triage-decisions` collection.
 *
 * One document per symbol per market date. The store is the in-memory source
 * of truth; this service handles all Firestore I/O.
 */
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  writeBatch,
  Timestamp,
  serverTimestamp,
  onSnapshot,
  Query,
  QueryDocumentSnapshot,
  DocumentReference,
  DocumentData,
} from '@angular/fire/firestore';
import { Auth, authState } from '@angular/fire/auth';
import { Observable, from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { RhReviewStatus } from '../common/rh-agent.constants';

export interface RhTriageDecision {
  symbol: string;
  date: string;
  status: RhReviewStatus;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  userId?: string;
  source?: string;
  runId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface RhTriageDecisionInput {
  symbol: string;
  date: string;
  status: RhReviewStatus;
  source?: string;
  runId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export const TRIAGE_DECISIONS_COLLECTION = 'rh-agent-triage-decisions';

@Injectable({
  providedIn: 'root',
})
export class RhAgentTriageService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private readonly decisionsCollection = collection(this.firestore, TRIAGE_DECISIONS_COLLECTION);

  /** Load all decisions for a specific date. */
  loadDecisionsForDate(date: string): Observable<RhTriageDecision[]> {
    return this.withUserId().pipe(
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('date', '==', date),
          orderBy('symbol', 'asc')
        );
        return this.runQuery(q);
      })
    );
  }

  /** Load decisions for a date range. */
  loadDecisionsForDateRange(startDate: string, endDate: string): Observable<RhTriageDecision[]> {
    return this.withUserId().pipe(
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('date', '>=', startDate),
          where('date', '<=', endDate),
          orderBy('date', 'desc'),
          orderBy('symbol', 'asc')
        );
        return this.runQuery(q);
      })
    );
  }

  /** Persist a single decision. Creates or updates the {symbol}_{date} doc. */
  setDecision(input: RhTriageDecisionInput): Observable<void> {
    return this.withUserId().pipe(
      take(1),
      switchMap(async (userId) => {
        const symbol = input.symbol.toUpperCase();
        const date = input.date;
        const docId = this.decisionId(symbol, date);
        const docRef = doc(this.firestore, TRIAGE_DECISIONS_COLLECTION, docId);
        const now = serverTimestamp();

        const existing = await this.getDocData(docRef);
        const payload = {
          symbol,
          date,
          status: input.status,
          userId,
          source: input.source ?? 'unknown',
          runId: input.runId ?? null,
          notes: input.notes ?? null,
          metadata: input.metadata ?? {},
          updatedAt: now,
          createdAt: existing?.createdAt ?? now,
        };

        await setDoc(docRef, payload);
      }),
      map(() => undefined)
    );
  }

  /** Persist a batch of decisions for group-level actions. */
  setDecisionsBatch(inputs: RhTriageDecisionInput[]): Observable<void> {
    if (inputs.length === 0) return of(undefined);

    return this.withUserId().pipe(
      take(1),
      switchMap(async (userId) => {
        const batch = writeBatch(this.firestore);
        const now = Timestamp.now();

        // Fetch existing docs to preserve createdAt
        const existingMap = await this.getExistingDecisions(inputs, userId);

        for (const input of inputs) {
          const symbol = input.symbol.toUpperCase();
          const date = input.date;
          const docId = this.decisionId(symbol, date);
          const docRef = doc(this.firestore, TRIAGE_DECISIONS_COLLECTION, docId);
          const existing = existingMap.get(docId);

          batch.set(
            docRef,
            {
              symbol,
              date,
              status: input.status,
              userId,
              source: input.source ?? 'unknown',
              runId: input.runId ?? null,
              notes: input.notes ?? null,
              metadata: input.metadata ?? {},
              updatedAt: now,
              createdAt: existing?.createdAt ?? now,
            },
            { merge: true }
          );
        }

        await batch.commit();
      }),
      map(() => undefined)
    );
  }

  /** Listen to real-time changes for a specific date. */
  listenToDecisionsForDate(date: string): Observable<RhTriageDecision[]> {
    return this.withUserId().pipe(
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          where('date', '==', date),
          orderBy('symbol', 'asc')
        );

        return new Observable<RhTriageDecision[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(this.toDecisions(snapshot.docs));
          }, (error) => {
            subscriber.error(error);
          });

          return unsubscribe;
        });
      })
    );
  }

  /** Listen to real-time changes for all of a user's decisions. */
  listenToAllDecisions(): Observable<RhTriageDecision[]> {
    return this.withUserId().pipe(
      switchMap((userId) => {
        const q = query(
          this.decisionsCollection,
          where('userId', '==', userId),
          orderBy('date', 'desc'),
          orderBy('symbol', 'asc')
        );

        return new Observable<RhTriageDecision[]>((subscriber) => {
          const unsubscribe = onSnapshot(q, (snapshot) => {
            subscriber.next(this.toDecisions(snapshot.docs));
          }, (error) => {
            subscriber.error(error);
          });

          return unsubscribe;
        });
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Build the Firestore document ID for a symbol/date decision. */
  private decisionId(symbol: string, date: string): string {
    return `${symbol}_${date}`;
  }

  /** Execute a one-time query and map the results to typed decisions. */
  private runQuery(q: Query<DocumentData>): Observable<RhTriageDecision[]> {
    return from(getDocs(q)).pipe(map((snapshot) => this.toDecisions(snapshot.docs)));
  }

  /** Map Firestore decision docs into the RhTriageDecision type. */
  private toDecisions(docs: QueryDocumentSnapshot<DocumentData>[]): RhTriageDecision[] {
    return docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        symbol: data['symbol'],
        date: data['date'],
        status: data['status'],
        createdAt: data['createdAt'],
        updatedAt: data['updatedAt'],
        userId: data['userId'],
        source: data['source'],
        runId: data['runId'],
        notes: data['notes'],
        metadata: data['metadata'] ?? {},
      } as RhTriageDecision;
    });
  }

  /**
   * Fetch existing decision docs for a batch so createdAt can be preserved.
   * Respects the Firestore `in` query limit of 30 by chunking doc IDs.
   */
  private async getExistingDecisions(
    inputs: RhTriageDecisionInput[],
    userId: string
  ): Promise<Map<string, { createdAt: Timestamp }>> {
    const docIds = inputs.map((i) => this.decisionId(i.symbol.toUpperCase(), i.date));
    // Firestore 'in' query supports up to 30 values; chunk if needed
    const chunks = chunkArray(docIds, 30);
    const map = new Map<string, { createdAt: Timestamp }>();

    for (const chunk of chunks) {
      const q = query(
        this.decisionsCollection,
        where('__name__', 'in', chunk),
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        if (data['createdAt']) {
          map.set(docSnap.id, { createdAt: data['createdAt'] as Timestamp });
        }
      }
    }

    return map;
  }

  /** Fetch a single doc's createdAt to preserve it during updates. */
  private async getDocData(docRef: DocumentReference<DocumentData>): Promise<{ createdAt?: Timestamp } | null> {
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as { createdAt?: Timestamp }) : null;
  }

  /** Return the current user ID or throw if not authenticated. */
  private withUserId(): Observable<string> {
    return authState(this.auth).pipe(
      take(1),
      map((user) => {
        if (!user?.uid) {
          throw new Error('Authentication required to persist triage decisions');
        }
        return user.uid;
      })
    );
  }
}

/**
 * Split an array into chunks of a given size.
 * Used to keep Firestore `in` queries under the 30-document limit.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
