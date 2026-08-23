/**
 * Shared factory for SdsCompletionDeps — used by sds.ts (subscriber),
 * sds-worker.ts (worker), and sds-watchdog.ts (watchdog).
 *
 * Extracted to eliminate duplication of the deps wiring across 3 files.
 */

import { getFunctions } from 'firebase-admin/functions';
import { db } from '../firebase-admin-init';
import { startRhAgentRun } from '../common/rh-agent-orchestration';
import { runOptionsSelectionPass, runSettlementForAllInstances } from '../options-strategy-engine/options-strategy-pass-orchestrators';
import type { SdsCompletionDeps } from './sds-completion';

/**
 * Create the real GCP-backed SdsCompletionDeps used by all entry points.
 * Consumers are dispatched via the sdsConsumerDispatch Cloud Task queue.
 */
export function createCompletionDeps(): SdsCompletionDeps {
  const consumerQueue = getFunctions().taskQueue('sdsConsumerDispatch');
  return {
    db,
    async enqueueConsumer(name, payload) {
      await consumerQueue.enqueue({ consumer: name, ...payload });
    },
    async runSelectionPass(marketDate: string) {
      await runOptionsSelectionPass(marketDate);
    },
    async runSettlementPass(marketDate: string, symbols?: string[]) {
      await runSettlementForAllInstances(marketDate);
    },
    async startRhAgentRun(marketDate: string, triggeredBy: 'manual' | 'pdr' | 'nightly' | 'symbol-added') {
      await startRhAgentRun(marketDate, triggeredBy);
    },
  };
}
