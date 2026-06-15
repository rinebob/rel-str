/**
 * RH Agent Daily Scheduler
 *
 * Scheduled Cloud Function that runs daily at 12:00 PM Pacific Time.
 * Loads the symbol list (~700 symbols) and enqueues analysis tasks.
 *
 * Schedule: 0 20 * * 1-5 (8:00 PM UTC = 12:00 PM PT, Monday-Friday)
 */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

import {
  getMarketDate,
  loadEnabledSymbols,
  createDailyRun,
  createJobAndEnqueue,
} from './rh-agent-shared';

/**
 * Daily scheduler - runs at 12:00 PM PT (8:00 PM UTC)
 * Loads symbols and enqueues analysis tasks.
 */
export const rhAgentDailyScheduler = onSchedule(
  {
    // ⚠️ If you change this cron, also update RH_AGENT_SCHEDULE_CRON in:
    //    src/app/features/rh-agent/rh-agent.service.ts
    schedule: '0 20 * * 1-5', // 8:00 PM UTC = 12:00 PM PT (no DST issues), Mon-Fri
    timeZone: 'Etc/UTC',
    // secrets: [ANTHROPIC_API_KEY], // Temporarily disabled for testing
    memory: '256MiB',
    timeoutSeconds: 300,
  },
  async (event) => {
    const startTime = Date.now();
    logger.info('rh_agent_daily_scheduler_start', {
      scheduledTime: event.scheduleTime,
    });

    try {
      // 1. Get today's market date (YYYY-MM-DD)
      const marketDate = getMarketDate();
      logger.info('rh_agent_scheduler_market_date', { marketDate, isoDate: new Date().toISOString() });

      // 2. Load enabled symbols from Firestore (should be ~700 symbols)
      const symbols = await loadEnabledSymbols();
      logger.info('rh_agent_scheduler_symbols_loaded', {
        count: symbols.length,
        firstFew: symbols.slice(0, 5),
        lastFew: symbols.slice(-5),
      });

      if (symbols.length === 0) {
        logger.warn('rh_agent_scheduler_no_symbols');
        return;
      }

      // 3. Calculate deadline (12:30 PM PT = 8:30 PM UTC)
      const deadlineAt = getDeadlineISO();
      logger.info('rh_agent_scheduler_deadline', { deadlineAt, minutesToDeadline: 30 });

      // 4. Create daily run document
      const runId = await createDailyRun(marketDate, symbols.length, deadlineAt);
      logger.info('rh_agent_scheduler_run_created', {
        runId,
        marketDate,
        symbolCount: symbols.length,
        deadlineAt,
        runPath: `rh-agent-runs/${runId}`,
      });

      // 5. Create job documents and enqueue Cloud Tasks
      let enqueuedCount = 0;
      let failedCount = 0;
      logger.info('rh_agent_scheduler_enqueue_start', { runId, totalSymbols: symbols.length });

      for (const symbol of symbols) {
        try {
          await createJobAndEnqueue(runId, symbol, marketDate);
          enqueuedCount++;
          if (enqueuedCount % 5 === 0) {
            logger.info('rh_agent_scheduler_enqueue_progress', { runId, enqueued: enqueuedCount, total: symbols.length });
          }
        } catch (error: any) {
          failedCount++;
          logger.error('rh_agent_scheduler_enqueue_failed', {
            symbol,
            runId,
            error: error?.message,
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('rh_agent_scheduler_complete', {
        runId,
        marketDate,
        symbolsLoaded: symbols.length,
        enqueued: enqueuedCount,
        failed: failedCount,
        durationMs: duration,
        runPath: `rh-agent-runs/${runId}`,
        jobsPath: `rh-agent-runs/${runId}/jobs`,
      });
    } catch (error: any) {
      logger.error('rh_agent_scheduler_fatal_error', {
        error: error?.message,
        stack: error?.stack,
      });
      throw error;
    }
  }
);

/**
 * Get deadline ISO string (12:30 PM PT = 8:30 PM UTC).
 * Stored as string to avoid Timestamp serialization issues.
 * Scheduler-specific: fixed time of day, not relative.
 */
function getDeadlineISO(): string {
  const now = new Date();
  // Set to 8:30 PM UTC today
  const deadline = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    20, 30, 0, 0 // 20:30 UTC = 12:30 PM PT
  ));
  return deadline.toISOString();
}
