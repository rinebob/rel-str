/**
 * RH Agent Company Overview Sync Orchestrator
 *
 * Scheduler and admin callable that load enabled symbols and enqueue one
 * Cloud Task per symbol for overview fetching.
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall } from 'firebase-functions/v2/https';
import { getFunctions } from 'firebase-admin/functions';
import { logger } from 'firebase-functions/v2';

import { db } from '../firebase-admin-init';
import { RH_AGENT_SYMBOLS_COLLECTION } from './rh-agent-config';

// ============================================================================
// Constants
// ============================================================================

const OVERVIEW_TASK_QUEUE = 'rhAgentOverviewSyncSymbol';

// ============================================================================
// Helpers
// ============================================================================

/** Load all enabled symbol IDs from rh-agent-symbols. */
async function loadEnabledSymbolIds(): Promise<string[]> {
  const snap = await db
    .collection(RH_AGENT_SYMBOLS_COLLECTION)
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
      logger.error('rh_agent_overview_enqueue_error', { symbol, error: err?.message });
      skipped++;
    }
  }

  return { enqueued, skipped };
}

// ============================================================================
// Scheduler — weekly on Sundays at 6 AM UTC
// ============================================================================

export const rhAgentOverviewSyncWeekly = onSchedule(
  {
    schedule: '0 6 * * 0',
    timeZone: 'UTC',
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async () => {
    logger.info('rh_agent_overview_sync_weekly_start');
    const symbols = await loadEnabledSymbolIds();
    const result = await enqueueOverviewTasks(symbols, false);
    logger.info('rh_agent_overview_sync_weekly_complete', { total: symbols.length, ...result });
  }
);

// ============================================================================
// Admin callable — manual full backfill trigger
// ============================================================================

export const rhAgentOverviewSyncAdmin = onCall<
  { symbols?: string[]; forceRefresh?: boolean },
  Promise<{ enqueued: number; skipped: number; total: number }>
>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  async (request) => {
    const forceRefresh = request.data.forceRefresh ?? true;
    const symbols = request.data.symbols?.length
      ? request.data.symbols
      : await loadEnabledSymbolIds();

    logger.info('rh_agent_overview_sync_admin_start', { total: symbols.length, forceRefresh });
    const result = await enqueueOverviewTasks(symbols, forceRefresh);
    logger.info('rh_agent_overview_sync_admin_complete', { total: symbols.length, ...result });

    return { total: symbols.length, ...result };
  }
);
