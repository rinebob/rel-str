/**
 * Savant Trader Firestore Helpers
 *
 * Shared, low-level helpers used by the Savant Trader frontend services.
 * These were duplicated across triage, symbol-list, and symbol-meta services.
 */
import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
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

/** Build a stable doc id for an occurrence-level decision. */
export function buildStOccurrenceDecisionId(
  runId: string,
  symbol: string,
  timeframe: string,
  signalType: string
): string {
  return `${runId}_${symbol.toUpperCase()}_${timeframe}_${signalType}`;
}

/** Normalize a ticket's `signalContext.decisionId` to the canonical
 *  occurrence-decision doc id. Tickets staged before the producer used
 *  `buildStOccurrenceDecisionId` carry the legacy format
 *  `${runId}-${symbol}-${timeframe}-${signalType}` (hyphens, raw-case
 *  symbol); the suffix is reconstructed from the ticket's own fields and
 *  stripped to recover runId — reliable even though runId itself may
 *  contain hyphens. Returns the input untouched when it doesn't match
 *  the legacy shape (already canonical, or an unknown format). */
export function canonicalOccurrenceDecisionId(
  decisionId: string,
  ctx: { symbol: string; timeframe: string; signalType: string },
): string {
  const suffix = `-${ctx.symbol}-${ctx.timeframe}-${ctx.signalType}`;
  if (decisionId.endsWith(suffix)) {
    const runId = decisionId.slice(0, decisionId.length - suffix.length);
    return buildStOccurrenceDecisionId(runId, ctx.symbol, ctx.timeframe, ctx.signalType);
  }
  return decisionId;
}
