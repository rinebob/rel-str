/**
 * Savant Trader Feature
 *
 * Robinhood Trading Agent integration for SavantTrader.
 *
 * Usage:
 * ```typescript
 * import { AgentService, RhAgentDashboardComponent } from './savant-trader';
 * ```
 */

// Services
export { AgentService } from './services/agent.service';
export { RunService } from './services/run.service';
export { SignalService } from './services/signal.service';
export { OverviewService } from './services/overview.service';
export { ChartService } from './services/chart.service';
export { RobinhoodMcpObservationService } from './services/robinhood-mcp-observation.service';

export {
  type AgentStatus,
  type AgentRun,
  type AgentSymbolProfile,
  type AgentSignalItem,
  type AgentOccurrenceDecision,
  type DurableDecisionType,
  type MarketCapTier,
  type SignalDirection,
  type ManualRunRequest,
  type ManualRunResponse,
  RH_AGENT_SCHEDULE_CRON,
  RH_AGENT_MAX_TRADE_AMOUNT,
} from './services/types';

// Group Store (Phase 4 â€” symbol-centric grouped review)
export {
  RhAgentGroupStore,
  RhSymbolRow,
  RhSymbolGroup,
} from './stores/rh-agent-group.store';

export {
  ReviewDecision,
  ALL_REVIEW_STATUSES,
  RhSymbolListName,
  ALL_SYMBOL_LIST_NAMES,
  SymbolType,
  GroupDimension,
} from './common/constants';

// Triage Store (Phase 5B â€” shared PACR state across pages)
export { RhAgentTriageStore } from './stores/rh-agent-triage.store';

// Symbol List Store (Phase 0 â€” extracted list management)
export { RhAgentSymbolListStore } from './stores/rh-agent-symbol-list.store';

// Symbol History Store (Phase 5 â€” extracted signal history cache)
export { RhAgentSymbolHistoryStore } from './stores/rh-agent-symbol-history.store';

// Chart Store (Phase 6 â€” shared chart data loading)
export {
  RhAgentChartStore,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from './stores/rh-agent-chart.store';

// Chart Indicator Builder (Phase 1 â€” shared indicator configuration)
export * as RhAgentChartIndicators from './utils/chart-indicators';

// Shared Firestore Helpers (Phase 6B â€” centralize duplicated utilities)
export { requireUserId, chunkArray, getDocData, CreatedAtDoc } from './services/firestore-helpers';

// Persistence & Universe Services (Phase 5C)
export { TriageService } from './services/triage.service';
export { SymbolMetaService, RhSymbolMeta, RhSymbolMetaInput } from './services/symbol-meta.service';
export { SymbolListService, RhSymbolList } from './services/symbol-list.service';

// Components
export { SignalReviewHeaderComponent } from './components/signal-review-header/signal-review-header.component';
export { GroupPanelComponent } from './components/group-panel/group-panel.component';
export { SymbolRowComponent } from './components/symbol-row/symbol-row.component';
export { SymbolSignalHistoryComponent } from './components/symbol-signal-history/symbol-signal-history.component';
export { SymbolAcrActionsComponent } from './components/symbol-acr-actions/symbol-acr-actions.component';
export { SymbolListActionsComponent } from './components/symbol-list-actions/symbol-list-actions.component';
export { StatusSummaryChipsComponent } from './components/status-summary-chips/status-summary-chips.component';
export { QuickChartsPanelComponent } from './components/quick-charts-panel/quick-charts-panel.component';
export { ReviewHeaderComponent } from './components/review-header/review-header.component';
export { TradeRowComponent, TradeRow } from './components/trade-row/trade-row.component';
export { ChartToolbarComponent } from './components/chart-toolbar/chart-toolbar.component';
export { IndicatorMenuComponent } from './components/indicator-menu/indicator-menu.component';
export { SignalTableComponent, SignalTableRow } from './components/signal-table/signal-table.component';
export { AgentStatusBarComponent } from './components/agent-status-bar/agent-status-bar.component';
export { RunHistoryPanelComponent } from './components/run-history-panel/run-history-panel.component';

export { RhAgentDashboardComponent } from './pages/agent-dashboard/rh-agent-dashboard.component';
export { SignalReviewComponent } from './pages/signal-review/signal-review.component';
export { ChartReviewComponent } from './pages/chart-review/chart-review.component';
export { RhAgentOrderComponent } from './pages/agent-order/rh-agent-order.component';
export { RhAgentTriageReportComponent } from './pages/agent-triage-report/rh-agent-triage-report.component';
export { ObservationDashboardComponent } from './pages/observation-dashboard/observation-dashboard.component';
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
