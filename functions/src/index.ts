import './init';

export {partnerProxyTest, getTrackedSymbols} from "./partner-proxy";

export { processDataReadyRunV2 } from "./webhooks/partner-webhooks";

export {
  recomputeRegisteredBackfill,
  diagnosePairDays,
  diagnosePairDaysAdmin,
  diagnoseRegisteredRangeAdmin,
  autoDiagnoseAndFixDaily,
  backfillSignalsPipelineAdmin,
  cleanupIntraperiodBar,
  purgePairSignalsAndActivityAllHttp,
  refreshMarketHolidaysAdmin,
  ingestStaticPairsAdmin,
  normalizePairRegistryAdmin,
} from "./webhooks/admin-tasks";

export {
  diagnosePairArchives,
  diagnosePairArchivesAdmin,
} from './webhooks/diagnostics';

export * from './webhooks/registry-actions';

export { getPairRSArchive } from './archive';

export { tradeJournalManager } from './trade-journal-manager';

// RS chart / OHLC bars callable
export { getPairDailyBars } from './rs-chart-bars.callables';

// RsSignalHistory callable exports
export {
  getPairSignals,
  getPnLSummary,
  updatePositionActuals,
} from './rs-signal-history.callables';

// Admin cleanup callables
export {
  purgePairsDataRootDataField,
  purgeNonYearShardRootDocs,
  purgeMisShardedPositionItems,
  purgePairSignalsAll,
  purgePairSignalsActivityAll,
  purgePairSignalsAndActivityAll,
  backfillPositionsBucketMetadata,
  purgeAllPositions,
} from './cleanup.callables';

export { backfillSymbolDataFromPairsAdmin } from './admin/backfill-symbol-data-from-pairs';
export { backfillSymbolDataFromTradesAdmin, backfillSymbolDataForTradesDaily } from './admin/backfill-symbol-data-from-trades';
export { syncTrackedSymbolsDaily } from './scheduled/sync-tracked-symbols';