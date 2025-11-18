import './init';

export {partnerProxyTest, getTrackedSymbols} from "./partner-proxy";

export { processDataReadyRunV2 } from "./webhooks/partner-webhooks";
export { recomputePairsRs, recomputeRegisteredBackfill, diagnosePairDays, diagnosePairDaysAdmin, diagnoseRegisteredRangeAdmin, recomputeRegisteredLive, refreshAllRangeAdmin, purgePairsDataSignalsAdmin, autoDiagnoseAndFixDaily } from "./webhooks/admin-tasks";

export * from './webhooks/registry-actions';

export { getPairRSArchive } from './archive';

// RsSignalHistory callable exports
export {
  getPairSignals,
  getDailySignals,
  getPnLSummary,
  updatePositionActuals,
  rebuildSignalsDailyMirror,
  rebuildSignalsDailyMirrorRange,
  cleanPairDailyPnL,
  auditSignalsConsistency,
} from './rs-signal-history.callables';

// RsSignalHistory backfill (HTTP)
export { backfillSignalsHistory, backfillPositionsStatus, backfillPositionsIds } from './rs-signal-history.backfill';

// Admin cleanup callables
export { purgePairsDataRootDataField, purgeNonYearShardRootDocs, purgeMisShardedPositionItems, backfillPairSignalsDailyShards, cleanupPairSignalsDailyHot, purgePairSignalsDailyAll, purgePairSignalsAll } from './cleanup.callables';