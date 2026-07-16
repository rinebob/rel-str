/**
 * RH Agent Firestore Helpers
 *
 * Shared, low-level helpers used by the RH Agent frontend services.
 * These were duplicated across triage, symbol-list, and symbol-meta services.
 */
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { DocumentData, DocumentReference, getDoc, Timestamp } from '@angular/fire/firestore';
import { Observable, map, take } from 'rxjs';

/** Return the current user ID or throw if not authenticated. */
export function requireUserId(auth: Auth, injector: EnvironmentInjector): Observable<string> {
  return runInInjectionContext(injector, () => authState(auth)).pipe(
    take(1),
    map((user) => {
      if (!user?.uid) throw new Error('Authentication required');
      return user.uid;
    }),
  );
}

/**
 * Fetch a single doc's data as a typed object.
 * Returns null if the doc does not exist.
 */
export async function getDocData<T extends DocumentData>(docRef: DocumentReference<T>): Promise<T | null> {
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

/**
 * Split an array into chunks of a given size.
 * Used to keep Firestore `in` queries under the 30-document limit.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Shape returned by getDocData when only the createdAt timestamp is needed. */
export interface CreatedAtDoc {
  createdAt?: Timestamp;
}

/** Build a stable doc id for an occurrence-level decision. */
export function buildRhAgentOccurrenceDecisionId(
  runId: string,
  symbol: string,
  timeframe: string,
  signalType: string
): string {
  return `${runId}_${symbol.toUpperCase()}_${timeframe}_${signalType}`;
}

/** Build a human-readable doc id for a trade placed from an occurrence. */
export function buildRhAgentTradeId(
  symbol: string,
  marketDate: string,
  timeframe: string,
  signalType: string
): string {
  return `${symbol.toUpperCase()}_${marketDate}_${timeframe}_${signalType}`;
}
