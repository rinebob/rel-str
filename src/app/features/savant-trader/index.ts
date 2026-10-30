/**
 * Savant Trader Feature
 *
 * Robinhood Trading Agent integration for SavantTrader.
 *
 * Usage:
 * ```typescript
 * import { StService, DashboardComponent } from './savant-trader';
 * ```
 */

// Services
export { StService } from './services/st.service';
export { RunService } from './services/run.service';
export { SignalService } from './services/signal.service';
export { OverviewService } from './services/overview.service';
export { ChartService } from './services/chart.service';
export { RobinhoodMcpObservationService } from '../../core/robinhood-mcp/robinhood-mcp-observation.service';

export {
  type StStatus,
  type StRun,
  type StSymbolProfile,
  type StSignalItem,
  type MarketCapTier,
  type SignalDirection,
  type ManualRunRequest,
  type ManualRunResponse,
  ST_SCHEDULE_CRON,
  ST_MAX_TRADE_AMOUNT,
} from './services/types';

// Group Store (Phase 4 — symbol-centric grouped review)
export {
  GroupStore,
  SymbolRow,
  SymbolGroup,
} from './stores/group.store';

export {
  GroupDimension,
} from './common/constants';

// Triage Store (Phase 5B — shared review-flag state across pages)
export { TriageStore } from './stores/triage.store';

// Symbol List Store (Phase 0 — extracted list management)
export { SymbolListStore } from './stores/symbol-list.store';

// Symbol History Store (Phase 5 — extracted signal history cache)
export { SymbolHistoryStore } from './stores/symbol-history.store';

// Chart Store (Phase 6 — shared chart data loading)
export {
  ChartStore,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from './stores/chart.store';

// Chart Indicator Builder (Phase 1 — shared indicator configuration)
export * as ChartIndicators from './utils/chart-indicators';

// Shared Firestore Helpers (Phase 6B — centralize duplicated utilities)
export { requireUserId } from './services/firestore-helpers';

// Persistence & Universe Services (Phase 5C)
export { SymbolListService, SymbolList } from './services/symbol-list.service';

// Components
export { SignalReviewHeaderComponent } from './components/signal-review-header/signal-review-header.component';
export { GroupPanelComponent } from './components/group-panel/group-panel.component';
export { SymbolRowComponent } from './components/symbol-row/symbol-row.component';
export { SymbolSignalHistoryComponent } from './components/symbol-signal-history/symbol-signal-history.component';
export { SymbolActionsComponent } from './components/symbol-actions/symbol-actions.component';
export { SymbolListActionsComponent } from './components/symbol-list-actions/symbol-list-actions.component';
export { QuickChartsPanelComponent } from './components/quick-charts-panel/quick-charts-panel.component';

export { TradeRowComponent, TradeRow } from './components/trade-row/trade-row.component';
export { OrderQueueComponent } from './components/order-queue/order-queue.component';
export { OrderTicketComponent } from './components/order-ticket/order-ticket.component';
export { OrderConfirmDialogComponent } from './components/order-confirm-dialog/order-confirm-dialog.component';
export { ChartToolbarComponent } from './components/chart-toolbar/chart-toolbar.component';
export { IndicatorMenuComponent } from './components/indicator-menu/indicator-menu.component';
export { SignalTableComponent, SignalTableRow } from './components/signal-table/signal-table.component';
export { RunStatusBarComponent } from './components/run-status-bar/run-status-bar.component';
export { RunHistoryPanelComponent } from './components/run-history-panel/run-history-panel.component';

export { DashboardComponent } from './pages/run-dashboard/dashboard.component';
export { SignalReviewComponent } from './pages/signal-review/signal-review.component';

export { OrderComponent } from './pages/signal-order/order.component';
export { ObservationDashboardComponent } from './pages/rh-account-inquiry/observation-dashboard.component';
export { OptionChartComponent } from './pages/option-chart/option-chart.component';
export { SpreadChartPageComponent } from './pages/spread-chart/spread-chart-page.component';
export { SpreadChartComponent } from './components/spread-chart/spread-chart.component';
export { SpreadBuilderDialogComponent } from './components/spread-builder-dialog/spread-builder-dialog.component';
export { SaveListDialogComponent } from './components/save-list-dialog/save-list-dialog.component';
export { SpreadService } from './services/spread.service';
export { SpreadRunService } from './services/spread-run.service';
export { SpreadListService } from './services/spread-list.service';
export { SpreadViewerStore } from './stores/spread-viewer.store';
export { QuickChartsComponent } from './components/quick-charts/quick-charts.component';

// Backtest sub-feature (Phase 1)
export * from './backtest';
