/**
 * SDS consumer dispatch — Cloud Task handler for downstream consumers.
 *
 * Each consumer (selection, settlement, RH Agent) is enqueued as a separate
 * Cloud Task by fireSequenceCompletion. This handler dispatches to the
 * appropriate function based on the consumer name.
 *
 * Scoped consumers (settlement-scoped, rh-agent-nightly-scoped) currently
 * run the full unscoped implementation. Scoped filtering will be
 * implemented when the downstream consumers support symbol-scoped
 * execution. The consumer names are distinct so the dispatch path is
 * traceable in logs even though the execution is the same.
 */

import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { logger } from 'firebase-functions';
import { startStRun } from '../common/st-orchestration';
import {
  runOptionsSelectionPass,
  runSettlementForAllInstances,
} from '../options-strategy-engine/options-strategy-pass-orchestrators';

interface ConsumerDispatchPayload {
  consumer: string;
  marketDate: string;
}

export const sdsConsumerDispatch = onTaskDispatched<ConsumerDispatchPayload>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10, maxBackoffSeconds: 120 },
    rateLimits: { maxConcurrentDispatches: 5, maxDispatchesPerSecond: 1 },
    memory: '1GiB',
    timeoutSeconds: 300,
    region: 'us-central1',
  },
  async (req) => {
    const { consumer, marketDate } = req.data;
    logger.info('sds_consumer_dispatch_start', { consumer, marketDate });

    if (!marketDate) {
      logger.error('sds_consumer_dispatch_no_market_date', { consumer });
      return;
    }

    switch (consumer) {
      case 'selection':
        await runOptionsSelectionPass(marketDate);
        logger.info('sds_consumer_dispatch_selection_done', { marketDate });
        break;

      case 'settlement':
      case 'settlement-scoped':
        // Scoped variant runs full settlement for now.
        await runSettlementForAllInstances(marketDate);
        logger.info('sds_consumer_dispatch_settlement_done', { consumer, marketDate });
        break;

      case 'st-nightly':
      case 'st-nightly-scoped':
        // Scoped variant runs full nightly for now.
        await startStRun(marketDate, 'nightly');
        logger.info('sds_consumer_dispatch_st_nightly_done', { consumer, marketDate });
        break;

      case 'st-intraday':
        await startStRun(marketDate, 'pdr');
        logger.info('sds_consumer_dispatch_st_intraday_done', { marketDate });
        break;

      default:
        logger.warn('sds_consumer_dispatch_unknown_consumer', { consumer });
    }
  },
);
