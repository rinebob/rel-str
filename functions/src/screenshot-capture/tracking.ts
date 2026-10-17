/**
 * Tracking helpers for the order-lifecycle capture (Topic #746 / Thread
 * #826 / task #846; carrier repointed to `st-order-tickets` in #984/#1003).
 * Two surfaces:
 *
 * - **Carrier builders** — the doc path + kind a `captureLifecycleEvent`
 *   call ledgers against. `intentCarrier` points at a canonical
 *   `st-order-tickets` doc (pass the `{liv|pap}_` ticket id);
 *   `enginePositionCarrier` takes the caller's own doc path (paper-trade
 *   position, engine trade record).
 * - **Ticket tracking-field I/O** — `lastSeenState` detector bookkeeping
 *   and the `role`/`linkedPositionId`/`signalId` linkage reads a detector
 *   needs to compose an intake call. On canonical tickets these fields
 *   live nested under `tracking` (the #998 contract); reads fall back to
 *   the legacy top-level layout so soak-era docs still resolve.
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
import { ST_ORDER_TICKETS_ROOT } from '../common/st-collections';

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

/** Canonical ticket doc path — `intentId` is the `{liv|pap}_` ticket id
 *  post-#1003 (the carrier IS the ledger home). */
export function intentDocPath(intentId: string): string {
  return `${ST_ORDER_TICKETS_ROOT}/${intentId}`;
}

/** Carrier for detector-driven live captures — the ticket doc IS the
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
 *  `buildScreenshotIndexDocId` from `@screenshot-capture/utils`). */
export function screenshotIndexDocPath(docId: string): string {
  return `${ST_SCREENSHOTS_COLLECTION}/${docId}`;
}

// ── Intent tracking I/O ─────────────────────────────────────────────────────

/** Merge a carrier doc's nested (`tracking.capturedEvents`) and top-level
 *  ledgers — canonical tickets nest (#998); docs pre-dating the nesting
 *  convention can carry stray top-level entries. Top-level wins collisions,
 *  matching `readCapturedEvents`. */
export function mergeCapturedEventMaps(
  data: Record<string, unknown> | undefined,
): Record<string, CapturedEventEntry> {
  const nested = (data?.tracking as Record<string, unknown> | undefined)
    ?.[CAPTURED_EVENTS_FIELD];
  const topLevel = data?.[CAPTURED_EVENTS_FIELD];
  return {
    ...((nested ?? {}) as Record<string, CapturedEventEntry>),
    ...((topLevel ?? {}) as Record<string, CapturedEventEntry>),
  };
}

/** Read the lifecycle-tracking fields off a canonical ticket doc —
 *  undefined when the doc doesn't exist. Fields nest under `tracking` on
 *  `st-order-tickets` (#998); top-level fields merge in per-field for docs
 *  that pre-date the nesting convention (top-level wins a collision,
 *  matching `mergeCapturedEventMaps`). */
export async function readIntentTracking(
  db: TrackingDb,
  intentId: string,
): Promise<OrderIntentTrackingFields | undefined> {
  const snap = await db.doc(intentDocPath(intentId)).get();
  if (!snap.exists) return undefined;
  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const t = (data.tracking ?? {}) as OrderIntentTrackingFields;
  type F = OrderIntentTrackingFields;
  return {
    role: (data.role as F['role']) ?? t.role,
    linkedPositionId: (data.linkedPositionId as F['linkedPositionId']) ?? t.linkedPositionId,
    signalId: (data.signalId as F['signalId']) ?? t.signalId,
    lastSeenState: (data.lastSeenState as F['lastSeenState']) ?? t.lastSeenState,
    capturedEvents: mergeCapturedEventMaps(data),
  };
}

/** Merge-write tracking fields under `tracking` on a canonical ticket doc
 *  — creates the doc if the caller somehow beats the ticket write (fields
 *  are all optional). Nested merge preserves sibling tracking keys.
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
  await db.doc(intentDocPath(intentId)).set({ tracking: clean }, { merge: true });
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
 *  needs a capture call. Canonical tickets nest the ledger under
 *  `tracking.capturedEvents`; engine carriers keep it top-level — both
 *  maps merge, top-level winning any collision. */
export async function readCapturedEvents(
  db: TrackingDb,
  docPath: string,
): Promise<Record<string, CapturedEventEntry>> {
  const snap = await db.doc(docPath).get();
  if (!snap.exists) return {};
  return mergeCapturedEventMaps(snap.data() as Record<string, unknown> | undefined);
}
