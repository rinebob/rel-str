/**
 * ST Company Overview Sync Orchestrator
 *
 * Scheduler and admin callable that load enabled symbols and enqueue one
 * Cloud Task per symbol for overview fetching.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';

import { db } from '../firebase-admin-init';
import { ST_SYMBOLS_COLLECTION } from '../common/st-collections';

// ============================================================================
// Constants
// ============================================================================

const OVERVIEW_TASK_QUEUE = 'stOverviewSyncSymbol';

// ============================================================================
// Helpers
// ============================================================================

/** Load all enabled symbol IDs from symbol-meta. */
async function loadEnabledSymbolIds(): Promise<string[]> {
  const snap = await db
    .collection(ST_SYMBOLS_COLLECTION)
    .where('enabled', '==', true)
    .get();
  return snap.docs.map((d) => (d.data().symbol as string) || d.id);
}

/** Enqueue one overview sync task per symbol. */
async function enqueueOverviewTasks(symbols: string[], forceRefresh = false): Promise<{ enqueued: number; skipped: number }> {
  const queue = getFunctions().taskQueue(OVERVIEW_TASK_QUEUE);
  let enqueued = 0;
  let skipped = 0;

  for (const symbol of symbols) {
    try {
      await queue.enqueue({ symbol, forceRefresh }, {
        scheduleDelaySeconds: Math.floor(enqueued * 0.5), // 500ms spread to avoid thundering herd
      });
      enqueued++;
    } catch (err: any) {
      logger.error('st_overview_enqueue_error', { symbol, error: err?.message });
      skipped++;
    }
  }

  return { enqueued, skipped };
}

// ============================================================================
// Scheduler — weekly on Sundays at 6 AM UTC
// ============================================================================

export const stOverviewSyncWeekly = onSchedule(
  {
    schedule: '0 6 * * 0',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    logger.info('st_overview_sync_weekly_start');
    const symbols = await loadEnabledSymbolIds();
    const result = await enqueueOverviewTasks(symbols, false);
    logger.info('st_overview_sync_weekly_complete', { total: symbols.length, ...result });
  }
);

// ============================================================================
// Admin callable — manual full backfill trigger
// ============================================================================

export const stOverviewSyncAdmin = onCall<
  { symbols?: string[]; forceRefresh?: boolean },
  Promise<{ enqueued: number; skipped: number; total: number }>
>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  async (request) => {
    const forceRefresh = request.data.forceRefresh ?? true;
    const symbols = request.data.symbols?.length
      ? request.data.symbols
      : await loadEnabledSymbolIds();

    logger.info('st_overview_sync_admin_start', { total: symbols.length, forceRefresh });
    const result = await enqueueOverviewTasks(symbols, forceRefresh);
    logger.info('st_overview_sync_admin_complete', { total: symbols.length, ...result });

    return { total: symbols.length, ...result };
  }
);
