import './init';

export {partnerProxyTest, getTrackedSymbols} from './partner-proxy';

/**
 * Cloud Functions below are intentionally commented out.
 *
 * - processSymbolsReady and processSymbolsReadyHttpTest implement the
 *   symbol-driven RS ingestion pipeline based on partner-symbols-ready
 *   notifications.
 * - That pipeline previously caused ordering/sync issues and has been
 *   parked in favor of the pair-centric, partner-data-ready driven
 *   processDataReadyRunV2 path.
 * - The .env flag USE_SYMBOL_DRIVEN_PIPELINE is currently set to false;
 *   re-enabling this symbol-driven pipeline would require both uncommenting
 *   these exports and setting USE_SYMBOL_DRIVEN_PIPELINE=true.
 *
 * The exports are left here (commented) to make re-enabling explicit if we
 * ever decide to revive the symbol-driven pipeline in the future.
 */
// export { processDataReadyRunV2, processSymbolsReady, processSymbolsReadyHttpTest } from "./webhooks/partner-webhooks";

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
export { backfillSymbolDataFromTradesAdmin, backfillSymbolDataForTradesDaily } from './admin/backfill-symbol-data-from-trades';
export { syncTrackedSymbolsDaily } from './scheduled/sync-tracked-symbols';
export { cleanupRsBackfillRuns } from './scheduled/cleanup-rs-backfill-runs';

// RH Agent (Robinhood Trading Agent) exports - Event-driven daily scan architecture
export { rhAgentPdrTrigger, rhAgentTriggerDaily } from './rh-agent-cloud-function/rh-agent-trigger';
export { rhAgentProcessSymbol } from './rh-agent-cloud-function/rh-agent-worker';

// RH Agent Admin utilities
export {
  clearRhAgentSymbolsAdmin,
  seedAllSymbolsFromPartner,
} from './rh-agent-cloud-function/rh-agent-seed-admin';

// RH Agent Callables (for frontend dashboard)
export {
  rhAgentGetSymbolsWithSignals,
  rhAgentGetSymbolSignalHistory,
} from './rh-agent-cloud-function/rh-agent-dashboard-callables';

// RH Agent Indicator Series callable
export { rhAgentGetSymbolIndicatorSeriesV2 } from './rh-agent-cloud-function/rh-agent-indicator-series';

// RH Agent Manual Run + status + run history callables
export {
  rhAgentManualRun,
  rhAgentGetStatus,
  rhAgentGetRunHistory,
} from './rh-agent-cloud-function/rh-agent-callables';

// RH Agent Backtest (Cloud Task worker + orchestrator)
export { rhAgentBacktestStart } from './rh-agent-cloud-function/backtest/backtest-orchestrator';
export { rhAgentBacktestPermutation } from './rh-agent-cloud-function/backtest/backtest-worker';

// RH Agent Company Overview Sync (Phase 1)
export {
  rhAgentOverviewSyncWeekly,
  rhAgentOverviewSyncAdmin,
} from './rh-agent-cloud-function/rh-agent-overview-sync-orchestrator';
export { rhAgentOverviewSyncSymbol } from './rh-agent-cloud-function/rh-agent-overview-sync-worker';

// Symbol-data nightly sync — single source of truth for OHLCV bars
export { symbolDataSyncNightly, symbolDataSyncAdminHttp, symbolDataSyncSymbol } from './symbol-data-sync/symbol-data-sync';

// Symbol-data onboarding consumer — backfills new symbols emitted by partner
export { processSymbolAdded } from './symbol-data-sync/symbol-data-symbol-added';
