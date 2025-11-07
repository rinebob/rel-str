import './init';

export {partnerProxyTest, getTrackedSymbols} from "./partner-proxy";

export { processDataReadyRunV2 } from "./webhooks/partner-webhooks";
export { recomputePairsRs, recomputeRegisteredBackfill, diagnosePairDays, diagnosePairDaysAdmin, recomputeRegisteredLive } from "./webhooks/admin-tasks";

export * from './webhooks/registry-actions';

export { getPairRSArchive } from './archive';

// RsSignalHistory callable exports
export {
  getPairSignals,
  getDailySignals,
  getPnLSummary,
  getPositionWithActuals,
  getPairSignalsWithActuals,
  updatePositionActuals,
  rebuildSignalsDailyMirror,
  rebuildSignalsDailyMirrorRange,
  cleanPairDailyPnL,
} from './rs-signal-history.callables';

// RsSignalHistory backfill (HTTP)
export { backfillSignalsHistory, migrateTradesToPositions, backfillPositionsStatus, backfillPositionsIds } from './rs-signal-history.backfill';