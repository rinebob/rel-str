/**
 * RH Agent Backtest sub-feature barrel.
 *
 * Public exports for the strategy backtest run management UI.
 */

export { BacktestDashboardComponent } from './pages/backtest-dashboard/backtest-dashboard.component';

export { BacktestRunControlComponent } from './components/backtest-run-control/backtest-run-control.component';
export { BacktestRunListComponent } from './components/backtest-run-list/backtest-run-list.component';

export { BacktestRunStore } from './stores/backtest-run.store';
export { BacktestUiStore } from './stores/backtest-ui.store';

export {
  type BacktestRunUi,
  type BacktestPermutationUi,
  type BacktestTradeUi,
  type BacktestTradeLegUi,
  type BacktestEquityPoint,
  type BacktestMetrics,
  type BacktestStrategyMetadata,
  type BacktestStrategyConfigField,
  type StartBacktestRequest,
  type StartBacktestResponse,
  type BacktestRunStatus,
  type BacktestPermutationStatus,
  type BacktestReportTier,
  type BacktestRunType,
  type BacktestStatusFilter,
  type BacktestDateFilter,
  type BacktestSortBy,
  type BacktestSortDirection,
} from './common/backtest.types';

export { BacktestRunService } from './services/backtest-run.service';
