/**
 * captureLifecycleEvent — the order-lifecycle intake (Topic #746 / Thread
 * #826 / task #845). Every lifecycle moment (order-placed, order-filled,
 * position-closed) funnels through here: dedup → invoke the shipped capture
 * pipeline → commit the manifest.
 *
 * Design (IMPL doc 746-826-834):
 * - **Dedup** is a Firestore transaction on the *carrier* doc — the ledger
 *   home. `capturedEvents` is a map keyed by event so each lifecycle event
 *   dedups independently. A claim writes `pending` inside the transaction so
 *   concurrent triggers can't double-fire; a `pending` older than
 *   `LIFECYCLE_STALE_CLAIM_MS` is reclaimable (the claimant's function died).
 *   A `failed` entry is always retryable — failures never wedge the ledger.
 * - **Invoke** is await-with-cap: the caller awaits a promise bounded by
 *   `LIFECYCLE_CAPTURE_TIMEOUT_MS` so a slow capture can't stall the order
 *   path, and a detached continuation can't be frozen mid-write. All errors
 *   (and the timeout) resolve to `{status:'failed'}` — nothing propagates.
 * - **Manifest + index** commit in one transaction: the carrier's
 *   `capturedEvents` entry flips to `captured` and the flat `st-screenshots`
 *   index doc lands under the deterministic id `{groupId}-{refId}-{event}`.
 *
 * `CaptureChartSnapshotDeps` seams keep the whole intake unit-testable
 * without firebase-admin; `createLifecycleCaptureDeps` wires the real seams.
 */
import { logger } from 'firebase-functions/v2';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Side-effect import: initializes the default app for getFirestore()/getStorage().
import '../firebase-admin-init';

import {
  CAPTURED_EVENTS_FIELD,
  CaptureEvent,
  PositionType,
  ST_SCREENSHOTS_COLLECTION,
  type CapturedEventEntry,
  type CaptureChartResult,
  type CaptureChartSpec,
  type CaptureInterval,
  type LifecycleCarrier,
  type ScreenshotIndexEntry,
} from '@screenshot-capture/contracts';
import { assembleChartModels } from './chart-data-loader';
import { executeCaptureChart, type CaptureChartSnapshotDeps } from './capture-chart';
import { rasterizeSvgToPng } from './rasterizer';
import { renderChartSvg } from './svg-renderer';
import { createArtifactWriter } from './storage-writer';

// Shared tracking shapes live in `@screenshot-capture/contracts` (FE +
// functions both consume them — #846). Re-exported here so the intake's
// importers keep a single entry point.
export {
  CAPTURED_EVENTS_FIELD,
  type CapturedEventEntry,
  type LifecycleCarrier,
  type LifecycleCarrierKind,
  type ScreenshotIndexEntry,
} from '@screenshot-capture/contracts';

/** Await cap for the capture call — generous vs. the ~2s happy path but
 *  bounded so the order path never stalls (#844 verify ran ~1s/capture). */
export const LIFECYCLE_CAPTURE_TIMEOUT_MS = 10_000;

/** A `pending` claim older than this is presumed orphaned (the claiming
 *  invocation died between claim and commit) and may be reclaimed. Well above
 *  the capture timeout so a legitimately in-flight capture is never raced. */
export const LIFECYCLE_STALE_CLAIM_MS = 60_000;

// ── Types ───────────────────────────────────────────────────────────────────

export interface LifecycleCaptureInput {
  /** The lifecycle position/trade id — composes the default refId and the
   *  index doc's `positionId` field. */
  positionId: string;
  /** Per-capture dedup/path key — defaults to `{positionId}-{event}`. */
  refId?: string;
  /** Campaign root (cohort / position group / opening intent ref) — becomes
   *  the `{groupId}` directory level and index field. */
  groupId?: string;
  event: CaptureEvent;
  symbol: string;
  positionType: PositionType;
  carrier: LifecycleCarrier;
  intervals?: readonly CaptureInterval[];
}

export type LifecycleCaptureOutcome =
  | { status: 'captured'; paths: string[] }
  | { status: 'skipped-duplicate' }
  | { status: 'failed'; error: string };

/** Transaction seam — the fake maps the ledger tests use; the real seam is
 *  `Firestore.runTransaction`. `readCarrierEvents` must resolve before
 *  writes buffer, matching the real all-reads-before-writes contract. */
export interface LifecycleTxn {
  readCarrierEvents(docPath: string): Promise<Record<string, CapturedEventEntry>>;
  writeCarrierEvent(docPath: string, event: CaptureEvent, entry: CapturedEventEntry): void;
  writeIndex(docId: string, entry: ScreenshotIndexEntry): void;
}

export interface LifecycleCaptureDeps {
  transact: <T>(work: (txn: LifecycleTxn) => Promise<T>) => Promise<T>;
  /** The capture core — `executeCaptureChart` in production. */
  capture: (spec: CaptureChartSpec) => Promise<CaptureChartResult>;
  now: () => Date;
  timeoutMs?: number;
  staleClaimMs?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic, overwrite-safe index doc id. Firestore doc ids forbid
 *  `/`; whitespace/slashes collapse to `-`. */
export function screenshotIndexDocId(
  groupId: string | undefined,
  refId: string,
  event: CaptureEvent,
): string {
  return [groupId, refId, event]
    .filter((p): p is string => !!p)
    .join('-')
    .replace(/[\s/]+/g, '-');
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Await-with-cap: resolves/rejects with the promise, or rejects on timeout.
 *  The losing promise is not cancelled — it may still write artifacts — but
 *  the caller gets its bounded answer either way. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`lifecycle capture timeout after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Intake ──────────────────────────────────────────────────────────────────

export async function captureLifecycleEvent(
  input: LifecycleCaptureInput,
  deps: LifecycleCaptureDeps,
): Promise<LifecycleCaptureOutcome> {
  const { carrier, event } = input;
  const refId = input.refId ?? `${input.positionId}-${event}`;
  const staleClaimMs = deps.staleClaimMs ?? LIFECYCLE_STALE_CLAIM_MS;
  const timeoutMs = deps.timeoutMs ?? LIFECYCLE_CAPTURE_TIMEOUT_MS;

  // 1. Claim the event slot inside a transaction. A committed 'captured' or a
  //    fresh 'pending' means this capture is already handled (done or
  //    in-flight); 'failed' or a stale 'pending' get reclaimed.
  let claimedAt: string;
  try {
    claimedAt = deps.now().toISOString();
    const claimed = await deps.transact(async (txn) => {
      const events = await txn.readCarrierEvents(carrier.docPath);
      const existing = events[event];
      if (existing?.status === 'captured') return false;
      if (
        existing?.status === 'pending' &&
        deps.now().getTime() - Date.parse(existing.claimedAt) < staleClaimMs
      ) {
        return false;
      }
      txn.writeCarrierEvent(carrier.docPath, event, {
        status: 'pending',
        claimedAt,
      });
      return true;
    });
    if (!claimed) return { status: 'skipped-duplicate' };
  } catch (err) {
    const error = errorText(err);
    logger.error('lifecycle_capture_claim_failed', {
      carrier,
      event,
      refId,
      error,
    });
    return { status: 'failed', error };
  }

  // 2. Invoke the capture pipeline, await-capped. renderOnly:false is
  //    unconditional — lifecycle captures exist to persist artifacts.
  const spec: CaptureChartSpec = {
    symbol: input.symbol,
    event,
    positionType: input.positionType,
    refId,
    groupId: input.groupId,
    intervals: input.intervals,
    renderOnly: false,
  };
  let result: CaptureChartResult;
  try {
    result = await withTimeout(deps.capture(spec), timeoutMs);
  } catch (err) {
    const error = errorText(err);
    // Failed marker — retryable on the next trigger, never wedges the slot.
    try {
      await deps.transact(async (txn) => {
        txn.writeCarrierEvent(carrier.docPath, event, {
          status: 'failed',
          claimedAt,
          failedAt: deps.now().toISOString(),
          error,
        });
        return undefined;
      });
    } catch (markErr) {
      logger.error('lifecycle_capture_mark_failed_error', {
        carrier,
        event,
        refId,
        error: errorText(markErr),
      });
    }
    logger.error('lifecycle_capture_failed', { carrier, event, refId, error });
    return { status: 'failed', error };
  }

  // 3. Manifest + index commit. A commit failure leaves the slot 'pending'
  //    — stale-reclaimable — while the artifacts are already written; log
  //    loudly and still report captured (the artifacts exist).
  const capturedAt = deps.now().toISOString();
  try {
    await deps.transact(async (txn) => {
      txn.writeCarrierEvent(carrier.docPath, event, {
        status: 'captured',
        claimedAt,
        capturedAt,
        paths: result.paths,
      });
      txn.writeIndex(screenshotIndexDocId(input.groupId, refId, event), {
        // Firestore rejects explicit `undefined` field values — omit the key
        // entirely for ungrouped captures.
        ...(input.groupId ? { groupId: input.groupId } : {}),
        positionId: input.positionId,
        refId,
        event,
        symbol: input.symbol,
        positionType: input.positionType,
        carrier,
        capturedAt,
        paths: result.paths,
      });
      return undefined;
    });
  } catch (err) {
    logger.error('lifecycle_capture_commit_failed', {
      carrier,
      event,
      refId,
      error: errorText(err),
    });
  }
  return { status: 'captured', paths: result.paths };
}

// ── Real seams ──────────────────────────────────────────────────────────────

/** Production deps — Firestore transactions on the carrier doc +
 *  `st-screenshots`, and the real capture pipeline (in-process). */
export function createLifecycleCaptureDeps(db = getFirestore()): LifecycleCaptureDeps {
  const chartDeps: CaptureChartSnapshotDeps = {
    assembleChartModels,
    renderChartSvg,
    rasterizeSvgToPng,
    writeArtifact: createArtifactWriter(getStorage().bucket()),
    now: () => new Date(),
  };
  return {
    transact: <T>(work: (txn: LifecycleTxn) => Promise<T>) =>
      db.runTransaction((t) =>
        work({
          readCarrierEvents: async (docPath) => {
            const snap = await t.get(db.doc(docPath));
            return (
              (snap.data()?.[CAPTURED_EVENTS_FIELD] as Record<string, CapturedEventEntry>) ?? {}
            );
          },
          writeCarrierEvent: (docPath, event, entry) => {
            t.set(
              db.doc(docPath),
              { [CAPTURED_EVENTS_FIELD]: { [event]: entry } },
              { merge: true },
            );
          },
          writeIndex: (docId, entry) => {
            t.set(db.collection(ST_SCREENSHOTS_COLLECTION).doc(docId), entry);
          },
        }),
      ),
    capture: (spec) => executeCaptureChart(spec, chartDeps),
    now: () => new Date(),
  };
}
