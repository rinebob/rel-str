import './init';

export {partnerProxyTest, getTrackedSymbols} from './partner-proxy';

export { processDataReadyRunV2 } from './webhooks/partner-webhooks';

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
} from './webhooks/admin-tasks';

export { recomputeRsBackfillAdmin } from './rs/time-series/rs-backfill-admin';
export { drainRsBackfillRunAdmin } from './rs/time-series/rs-time-series-jobs.drain-admin';
export { processRsJobTask } from './rs/time-series/rs-time-series-jobs.worker';

export {
  diagnosePairArchives,
  diagnosePairArchivesAdmin,
} from './webhooks/diagnostics';

export * from './webhooks/registry-actions';

export { getPairRSArchive } from './archive';

export { rebuildHeatmapSnapshotAdmin } from './rs/heatmap/heatmap-snapshots';
export { updateHeatmapSnapshotTask } from './rs/heatmap/heatmap-snapshots';
export { migrateHeatmapDocIdsAdmin } from './rs/heatmap/heatmap-snapshots';
export { bulkRebuildShardsAdmin } from './rs/heatmap/heatmap-snapshots';
export { deleteHeatmapSnapshotsAdmin } from './rs/heatmap/heatmap-snapshots';
export { rebuildHeatmapSnapshotsHttpAdmin } from './rs/heatmap/rebuild-heatmap-http-admin';

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
export { backfillSymbolDataFromTradesAdmin } from './admin/backfill-symbol-data-from-trades';
export { cleanupRsBackfillRuns } from './scheduled/cleanup-rs-backfill-runs';

// ST (Savant Trader) exports - Event-driven daily scan architecture
export { stTriggerDaily } from './st-cloud-function/trigger';
export { stProcessSymbol } from './st-cloud-function/worker';

// ST Admin utilities
export {
  clearStSymbolsAdmin,
  seedAllSymbolsFromPartner,
} from './st-cloud-function/seed-admin';

// ST Callables (for frontend dashboard)
export {
  stGetSymbolsWithSignals,
  stGetSymbolSignalHistory,
} from './st-cloud-function/dashboard-callables';

// ST Indicator Series callable
export { stGetSymbolIndicatorSeriesV2 } from './st-cloud-function/indicator-series';

// ST Manual Run + status + run history callables
export {
  stManualRun,
  stGetStatus,
  stGetRunHistory,
} from './st-cloud-function/callables';

// ST Backtest (Cloud Task worker + orchestrator + strategy discovery)
export { stBacktestStart } from './st-cloud-function/backtest/backtest-orchestrator';
export { stBacktestStrategies } from './st-cloud-function/backtest/backtest-strategies-callable';
export { stBacktestPermutation } from './st-cloud-function/backtest/backtest-worker';

// ST Company Overview Sync (Phase 1)
export {
  stOverviewSyncWeekly,
  stOverviewSyncAdmin,
} from './st-cloud-function/overview-sync-orchestrator';
export { stOverviewSyncSymbol } from './st-cloud-function/overview-sync-worker';

// Options contract viewer callables
export { getHistoricalOptionsContract, listOptionsContracts, getOptionsContractIndex, queryContractCatalog } from './options-contract.callables';

// SDS — PDR-triggered symbol data sync (replaces symbolDataSyncNightly)
export { symbolDataSync } from './symbol-data-sync/sds';
export { symbolDataSyncWorker } from './symbol-data-sync/sds-worker';
export { sdsWatchdog } from './symbol-data-sync/sds-watchdog';
export { sdsConsumerDispatch } from './symbol-data-sync/sds-consumer-dispatch';
export { sdsFallback } from './symbol-data-sync/sds-fallback';
// Admin HTTP + onboarding consumer kept from old module
export { symbolDataSyncAdminHttp, symbolDataSyncSymbol } from './symbol-data-sync/symbol-data-sync';

// Symbol-data onboarding consumer — backfills new symbols emitted by partner
export { processSymbolAdded } from './symbol-data-sync/symbol-data-symbol-added';

// Spread Time Series Viewer — orchestrator + worker
export { submitSpreadRun } from './spread-run-orchestrator';
export { spreadRunWorker } from './spread-run-worker';

// RH Agent MCP — cloud credential proof (Phase 4 read test)
export { rhCloudCredentialProof } from './rh-agent-mcp/diagnostics/cloud-credential-proof-function';

// RH Agent MCP — option quote tool discovery (hybrid options strategy engine)
export { rhOptionQuoteDiscovery } from './rh-agent-mcp/diagnostics/option-quote-discovery-function';

// Options strategy engine — scheduled passes
export {
  optionsMarkPass,
  optionsMarkPassManual,
  optionsSettlementPassManual,
} from './options-strategy-engine/options-strategy-passes';
export { openPassTimer } from './options-strategy-engine/passes/open-pass-timer';

// Options strategy engine — dashboard callables
export {
  listStrategyPositions,
  getStrategyEquityCurve,
} from './options-strategy-engine/options-strategy-callables';
