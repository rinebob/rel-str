/**
 * RH Agent Feature
 *
 * Robinhood Trading Agent integration for SavantTrader.
 *
 * Usage:
 * ```typescript
 * import { RhAgentService, RhAgentDashboardComponent } from './rh-agent';
 * ```
 */

// Services
export { RhAgentService } from './services/rh-agent.service';
export { RhAgentRunService } from './services/rh-agent-run.service';
export { RhAgentSignalService } from './services/rh-agent-signal.service';
export { RhAgentOverviewService } from './services/rh-agent-overview.service';
export { RhAgentChartService } from './services/rh-agent-chart.service';

export {
  type RhAgentStatus,
  type RhAgentRun,
  type RhAgentSymbolProfile,
  type RhAgentSignalItem,
  type MarketCapTier,
  type SignalDirection,
  type ManualRunRequest,
  type ManualRunResponse,
  RH_AGENT_SCHEDULE_CRON,
  RH_AGENT_MAX_TRADE_AMOUNT,
} from './services/rh-agent.types';

// Group Store (Phase 4 — symbol-centric grouped review)
export {
  RhAgentGroupStore,
  RhSymbolRow,
  RhSymbolGroup,
} from './stores/rh-agent-group.store';

export {
  RhReviewStatus,
  ALL_REVIEW_STATUSES,
  RhSymbolListName,
  ALL_SYMBOL_LIST_NAMES,
  SymbolType,
  GroupDimension,
} from './common/rh-agent.constants';

// Triage Store (Phase 5B — shared PACR state across pages)
export { RhAgentTriageStore } from './stores/rh-agent-triage.store';

// Symbol List Store (Phase 0 — extracted list management)
export { RhAgentSymbolListStore } from './stores/rh-agent-symbol-list.store';

// Symbol History Store (Phase 5 — extracted signal history cache)
export { RhAgentSymbolHistoryStore } from './stores/rh-agent-symbol-history.store';

// Chart Store (Phase 6 — shared chart data loading)
export {
  RhAgentChartStore,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_STRATEGIES,
} from './stores/rh-agent-chart.store';

// Chart Indicator Builder (Phase 1 — shared indicator configuration)
export * as RhAgentChartIndicators from './utils/rh-agent-chart-indicators';

// Shared Firestore Helpers (Phase 6B — centralize duplicated utilities)
export { requireUserId, chunkArray, getDocData, CreatedAtDoc } from './services/rh-agent-firestore-helpers';

// Persistence & Universe Services (Phase 5C)
export { RhAgentTriageService, RhTriageDecision, RhTriageDecisionInput } from './services/rh-agent-triage.service';
export { RhAgentSymbolMetaService, RhSymbolMeta, RhSymbolMetaInput } from './services/rh-agent-symbol-meta.service';
export { RhAgentSymbolListService, RhSymbolList } from './services/rh-agent-symbol-list.service';

// Components
export { GroupedReviewHeaderComponent } from './components/grouped-review-header/grouped-review-header.component';
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
export { RhAgentGroupedReviewComponent } from './pages/agent-grouped-review/rh-agent-grouped-review.component';
export { RhAgentReviewComponent } from './pages/agent-review/rh-agent-review.component';
export { RhAgentOrderComponent } from './pages/agent-order/rh-agent-order.component';
export { RhAgentTriageReportComponent } from './pages/agent-triage-report/rh-agent-triage-report.component';
export { QuickChartsComponent } from './components/quick-charts/quick-charts.component';
