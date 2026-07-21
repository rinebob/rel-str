/**
 * RH Agent Backtest sub-feature barrel.
 *
 * Public exports for the strategy backtest run management UI.
 */

export { BacktestDashboardComponent } from './pages/backtest-dashboard/backtest-dashboard.component';

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
} from './common/backtest.types';

export { BacktestRunService } from './services/backtest-run.service';
