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
  ManualRunRequest,
  ManualRunResponse,
} from './rh-agent.service';

// Component
export { RhAgentDashboardComponent } from './rh-agent-dashboard.component';
