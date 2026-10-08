/**
 * Tracking helpers for the order-lifecycle capture (Topic #746 / Thread
 * #826 / task #846). Two surfaces:
 *
 * - **Carrier builders** — the doc path + kind a `captureLifecycleEvent`
 *   call ledgers against. `intentCarrier` points at an `st-order-intents`
 *   doc (detector-driven live captures); `enginePositionCarrier` takes the
 *   caller's own doc path (paper-trade position, engine trade record).
 * - **`st-order-intents` tracking-field I/O** — `lastSeenState` detector
 *   bookkeeping and the `role`/`linkedPositionId`/`signalId` linkage reads
 *   a detector needs to compose an intake call.
 *
 * The `st-screenshots` index write itself lives in `lifecycle-capture.ts`
 * inside the manifest-commit transaction; this module only exposes its doc
 * path builder for callers that need to read a known entry back.
 *
 * `TrackingDb`/`TrackingDocRef` are the narrow seams every helper takes —
 * the admin `Firestore`/`DocumentReference` satisfy them structurally, and
 * tests pass map fakes without importing firebase-admin.
 */
import {
  CAPTURED_EVENTS_FIELD,
  ST_SCREENSHOTS_COLLECTION,
  type CapturedEventEntry,
  type LifecycleCarrier,
  type OrderIntentTrackingFields,
} from '@screenshot-capture/contracts';
import { ST_ORDER_INTENTS_COLLECTION } from '../common/st-collections';

export { CAPTURED_EVENTS_FIELD };

// ── Firestore seam ──────────────────────────────────────────────────────────

export interface TrackingDocRef {
  get(): Promise<{ exists: boolean; data(): unknown }>;
  set(data: Record<string, unknown>, opts: { merge: boolean }): Promise<unknown>;
}

export interface TrackingDb {
  doc(path: string): TrackingDocRef;
}

// ── Carrier builders ────────────────────────────────────────────────────────

export function intentDocPath(intentId: string): string {
  return `${ST_ORDER_INTENTS_COLLECTION}/${intentId}`;
}

/** Carrier for detector-driven live captures — the intent doc IS the
 *  ledger home. */
export function intentCarrier(intentId: string): LifecycleCarrier {
  return { kind: 'intent', docPath: intentDocPath(intentId) };
}

/** Carrier for engine/paper-trade positions — the caller owns the doc path
 *  (e.g. `paper-trading/{anchor}/items/{id}`). */
export function enginePositionCarrier(docPath: string): LifecycleCarrier {
  return { kind: 'engine-position', docPath };
}

/** Full doc path for a `st-screenshots` index entry (pair with
 *  `screenshotIndexDocId` from lifecycle-capture). */
export function screenshotIndexDocPath(docId: string): string {
  return `${ST_SCREENSHOTS_COLLECTION}/${docId}`;
}

// ── Intent tracking I/O ─────────────────────────────────────────────────────

/** Read the lifecycle-tracking fields off an intent doc — undefined when
 *  the doc doesn't exist. */
export async function readIntentTracking(
  db: TrackingDb,
  intentId: string,
): Promise<OrderIntentTrackingFields | undefined> {
  const snap = await db.doc(intentDocPath(intentId)).get();
  if (!snap.exists) return undefined;
  const data = (snap.data() ?? {}) as OrderIntentTrackingFields;
  return {
    role: data.role,
    linkedPositionId: data.linkedPositionId,
    signalId: data.signalId,
    lastSeenState: data.lastSeenState,
    capturedEvents: data.capturedEvents,
  };
}

/** Merge-write tracking fields onto an intent doc — creates the doc if the
 *  caller somehow beats the ticket write (fields are all optional).
 *  Explicit `undefined` values are dropped first: Firestore rejects them,
 *  and an unset optional should mean "don't write", not "write undefined". */
export async function writeIntentTracking(
  db: TrackingDb,
  intentId: string,
  fields: Partial<OrderIntentTrackingFields>,
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  );
  await db.doc(intentDocPath(intentId)).set(clean, { merge: true });
}

/** Convenience for the detector's most frequent write — the state it just
 *  observed so a terminal re-read doesn't double-fire. */
export async function writeIntentLastSeenState(
  db: TrackingDb,
  intentId: string,
  state: string,
): Promise<void> {
  return writeIntentTracking(db, intentId, { lastSeenState: state });
}

/** Read the dedup ledger off any carrier doc (intent or engine position) —
 *  the detector consults this before deciding whether a transition still
 *  needs a capture call. */
export async function readCapturedEvents(
  db: TrackingDb,
  docPath: string,
): Promise<Record<string, CapturedEventEntry>> {
  const snap = await db.doc(docPath).get();
  if (!snap.exists) return {};
  const data = snap.data() as Record<string, unknown> | undefined;
  return (data?.[CAPTURED_EVENTS_FIELD] as Record<string, CapturedEventEntry>) ?? {};
}
