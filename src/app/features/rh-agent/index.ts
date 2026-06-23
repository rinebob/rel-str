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
  RhReviewStatus,
  GroupDimension,
} from './rh-agent-group.store';

// Component
export { RhAgentDashboardComponent } from './rh-agent-dashboard.component';
