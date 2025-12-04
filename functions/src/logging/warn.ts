import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { WARNINGS_COLLECTION, WARNINGS_CAP_PER_RUN } from '../webhooks/webhooks-config';
import { logger } from 'firebase-functions/v2';

/** Module-scoped counters reset with each cold start (sufficient for per-run/process cap). */
let warningsPersistedCount = 0;
let capNoticeLogged = false;
let summaryWritten = false;
const countsByType = new Map<string, number>();

/** Short acronyms for Cloud Function names used in rs-warnings ids. */
const FUNCTION_ACRONYMS: Record<string, string> = {
  processDataReadyRunV2: 'pDRRV2',
  processPairLive: 'pPL',
  recomputeRegisteredBackfill: 'rRB',
  recomputePairsRs: 'rPR',
  getTrackedSymbols: 'gTS',
  validateAndRegisterPairs: 'vRP',
  unregisterPairs: 'uP',
  writeUnifiedSeries: 'wUS',
  diagnoseRegisteredRangeAdmin: 'dRRA',
  diagnosePairDays: 'dPD',
};

function extractWarningDate(context: Record<string, unknown>): string {
  const fromContext = String(context.day || context.marketDate || '').slice(0, 10);
  if (fromContext) {
    return fromContext;
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * TTL helper for rs-warnings.
 *
 * rs-warnings documents include an expiresAt field set to ~30 days in the future
 * at write time. Firestore's TTL policy should be configured to target this field
 * so that old warning documents are automatically removed.
 *
 * Console navigation for TTL policy:
 *   GCP -> Databases -> select Firestore -> click default -> Time-to-live.
 */
function computeWarningExpiresAt(): Date {
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + THIRTY_DAYS_MS);
}

function functionAcronym(fn: unknown): string {
  const key = typeof fn === 'string' ? fn : '';
  return FUNCTION_ACRONYMS[key] || 'XX';
}

function typeSlug(type: string): string {
  const base = type.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  return (base || 'warn').slice(0, 24);
}

function warningSuffix(): string {
  const seq = (warningsPersistedCount + 1).toString(36);
  const rand = Math.floor(Math.random() * 1296).toString(36); // up to 2 chars
  return (seq + rand).toUpperCase();
}

function buildWarningId(type: string, context: Record<string, unknown>): string {
  const date = extractWarningDate(context);
  const acr = functionAcronym((context as any).function);
  const slug = typeSlug(type);
  const sfx = warningSuffix();
  return `${date}_${acr}_${slug}_${sfx}`;
}

async function bumpWarningsMeta(): Promise<void> {
  try {
    await db
      .collection(WARNINGS_COLLECTION)
      .doc('00-metadata')
      .set(
        {
          approxCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  } catch {
    // ignore metadata write errors; metrics-only
  }
}

/**
 * Persist a warning event for UI visibility.
 * Enforces a per-run cap to avoid flooding during large backfills.
 * Also writes a one-time aggregation summary when the cap is reached.
 * Always best-effort: failures are swallowed to avoid impacting main flow.
 */
export async function persistWarning(
  type: string,
  context: Record<string, unknown>
): Promise<void> {
  // Track counts by type regardless of whether we drop later
  countsByType.set(type, (countsByType.get(type) || 0) + 1);

  // Apply per-process cap
  if (warningsPersistedCount >= WARNINGS_CAP_PER_RUN) {
    if (!capNoticeLogged) {
      capNoticeLogged = true;
      logger.warn('warnings_cap_reached', { cap: WARNINGS_CAP_PER_RUN });
      // Best-effort write an aggregation summary doc once
      if (!summaryWritten) {
        try {
          const summaryContext: Record<string, unknown> = {
            function: 'aggregate',
            cap: WARNINGS_CAP_PER_RUN,
            totalSeen: Array.from(countsByType.values()).reduce((a, b) => a + b, 0),
            countsByType: Object.fromEntries(countsByType.entries()),
          };
          const id = buildWarningId('warnings_cap_summary', summaryContext);
          await db
            .collection(WARNINGS_COLLECTION)
            .doc(id)
            .set(
              {
                type: 'warnings_cap_summary',
                ...summaryContext,
                expiresAt: computeWarningExpiresAt(),
                createdAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );
          void bumpWarningsMeta();
          summaryWritten = true;
        } catch {
          // ignore summary write errors
        }
      }
    }
    return; // drop additional warnings silently after first notice
  }

  try {
    const id = buildWarningId(type, context);
    await db
      .collection(WARNINGS_COLLECTION)
      .doc(id)
      .set(
        {
          type,
          ...context,
          expiresAt: computeWarningExpiresAt(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    warningsPersistedCount++;
    void bumpWarningsMeta();
  } catch {
    // ignore persist errors to keep pipeline resilient
  }
}

/**
 * Write an aggregation summary document capturing current warning counters.
 * Call at end of a run (callable or HTTP) for observability.
 */
export async function writeWarningsSummary(context: Record<string, unknown>): Promise<void> {
  try {
    const totalSeen = Array.from(countsByType.values()).reduce((a, b) => a + b, 0);
    const summaryContext: Record<string, unknown> = {
      ...context,
      cap: WARNINGS_CAP_PER_RUN,
      totalSeen,
      countsByType: Object.fromEntries(countsByType.entries()),
    };
    const id = buildWarningId('warnings_summary', summaryContext);
    await db
      .collection(WARNINGS_COLLECTION)
      .doc(id)
      .set(
        {
          type: 'warnings_summary',
          ...summaryContext,
          expiresAt: computeWarningExpiresAt(),
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    void bumpWarningsMeta();
  } catch {
    // best-effort; ignore
  }
}
