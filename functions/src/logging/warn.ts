import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase-admin-init';
import { WARNINGS_COLLECTION, WARNINGS_CAP_PER_RUN } from '../webhooks/webhooks-config';
import { logger } from 'firebase-functions/v2';

/** Module-scoped counters reset with each cold start (sufficient for per-run/process cap). */
let warningsPersistedCount = 0;
let capNoticeLogged = false;
let summaryWritten = false;
const countsByType = new Map<string, number>();

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
          await db.collection(WARNINGS_COLLECTION).add({
            type: 'warnings_cap_summary',
            function: 'aggregate',
            cap: WARNINGS_CAP_PER_RUN,
            totalSeen: Array.from(countsByType.values()).reduce((a, b) => a + b, 0),
            countsByType: Object.fromEntries(countsByType.entries()),
            createdAt: FieldValue.serverTimestamp(),
          });
          summaryWritten = true;
        } catch {
          // ignore summary write errors
        }
      }
    }
    return; // drop additional warnings silently after first notice
  }

  try {
    await db.collection(WARNINGS_COLLECTION).add({
      type,
      ...context,
      createdAt: FieldValue.serverTimestamp(),
    });
    warningsPersistedCount++;
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
    await db.collection(WARNINGS_COLLECTION).add({
      type: 'warnings_summary',
      ...context,
      cap: WARNINGS_CAP_PER_RUN,
      totalSeen,
      countsByType: Object.fromEntries(countsByType.entries()),
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    // best-effort; ignore
  }
}
