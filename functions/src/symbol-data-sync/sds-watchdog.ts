/**
 * SDS watchdog — scheduled function every 5 minutes.
 *
 * Forces completion for stale runs/sequences and retries failed dispatches.
 * Delegates to runWatchdog from sds-watchdog-logic.ts.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { runWatchdog } from './sds-watchdog-logic';
import { createCompletionDeps } from './sds-completion-deps';

export const sdsWatchdog = onSchedule(
  {
    schedule: '*/5 * * * *',
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
  },
  async () => {
    logger.info('sds_watchdog_start');
    try {
      const deps = createCompletionDeps();
      await runWatchdog(deps);
      logger.info('sds_watchdog_complete');
    } catch (err: any) {
      logger.error('sds_watchdog_error', { error: err?.message });
    }
  },
);
