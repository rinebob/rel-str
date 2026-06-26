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
  RhTradeSignal,
  RhAgentSymbolProfile,
  RhAgentSignalItem,
  MarketCapTier,
  SignalDirection,
  ManualRunRequest,
  ManualRunResponse,
} from './rh-agent.service';

// Group Store (Phase 4 — symbol-centric grouped review)
export {
  RhAgentGroupStore,
  RhSymbolRow,
  RhSymbolGroup,
  GroupDimension,
} from './rh-agent-group.store';

export {
  RhReviewStatus,
  ALL_REVIEW_STATUSES,
  RhSymbolListName,
  ALL_SYMBOL_LIST_NAMES,
  SymbolType,
} from './common/rh-agent.constants';

// Triage Store (Phase 5B — shared PACR state across pages)
export { RhAgentTriageStore } from './rh-agent-triage.store';

// Persistence & Universe Services (Phase 5C)
export { RhAgentTriageService, RhTriageDecision, RhTriageDecisionInput } from './rh-agent-triage.service';
export { RhAgentSymbolMetaService, RhSymbolMeta, RhSymbolMetaInput } from './rh-agent-symbol-meta.service';
export { RhAgentSymbolListService, RhSymbolList } from './rh-agent-symbol-list.service';

// Components
export { RhAgentDashboardComponent } from './rh-agent-dashboard.component';
export { RhAgentGroupedReviewComponent } from './rh-agent-grouped-review.component';
export { RhAgentReviewComponent } from './rh-agent-review.component';
export { RhAgentOrderComponent } from './rh-agent-order.component';
export { RhAgentTriageReportComponent } from './rh-agent-triage-report.component';
export { QuickChartsComponent } from './components/quick-charts/quick-charts.component';
