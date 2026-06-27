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

// Service
export {
  RhAgentService,
  RhAgentStatus,
  RhAgentRun,
  RhAgentSymbolProfile,
  RhAgentSignalItem,
  MarketCapTier,
  SignalDirection,
  ManualRunRequest,
  ManualRunResponse,
} from './services/rh-agent.service';

// Group Store (Phase 4 — symbol-centric grouped review)
export {
  RhAgentGroupStore,
  RhSymbolRow,
  RhSymbolGroup,
  GroupDimension,
} from './stores/rh-agent-group.store';

export {
  RhReviewStatus,
  ALL_REVIEW_STATUSES,
  RhSymbolListName,
  ALL_SYMBOL_LIST_NAMES,
  SymbolType,
} from './common/rh-agent.constants';

// Triage Store (Phase 5B — shared PACR state across pages)
export { RhAgentTriageStore } from './stores/rh-agent-triage.store';

// Symbol List Store (Phase 0 — extracted list management)
export { RhAgentSymbolListStore } from './stores/rh-agent-symbol-list.store';

// Persistence & Universe Services (Phase 5C)
export { RhAgentTriageService, RhTriageDecision, RhTriageDecisionInput } from './services/rh-agent-triage.service';
export { RhAgentSymbolMetaService, RhSymbolMeta, RhSymbolMetaInput } from './services/rh-agent-symbol-meta.service';
export { RhAgentSymbolListService, RhSymbolList } from './services/rh-agent-symbol-list.service';

// Components
export { RhAgentDashboardComponent } from './pages/agent-dashboard/rh-agent-dashboard.component';
export { RhAgentGroupedReviewComponent } from './pages/agent-grouped-review/rh-agent-grouped-review.component';
export { RhAgentReviewComponent } from './pages/agent-review/rh-agent-review.component';
export { RhAgentOrderComponent } from './pages/agent-order/rh-agent-order.component';
export { RhAgentTriageReportComponent } from './pages/agent-triage-report/rh-agent-triage-report.component';
export { QuickChartsComponent } from './components/quick-charts/quick-charts.component';
