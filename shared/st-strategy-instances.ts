/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Canonical `st-strategy-instances` shape — the unified strategy-instance
 * config (live + paper) consolidated from paper-trading/instances/items and
 * options-strategy-instances. Single source for BE and FE via the
 * `@st/strategy-instances` path alias.
 */
import type { StrategyInstanceConfig } from './options-strategy-engine-contracts';
import type { StMode } from './st-types';
export type { StMode } from './st-types';

/**
 * Strategy instance doc (`st-strategy-instances/{id}`) — the engine's
 * StrategyInstanceConfig extended with the execution mode and firing state.
 */
export interface StStrategyInstance extends StrategyInstanceConfig {
  /** Live vs paper execution — replaces the legacy per-collection split. */
  mode: StMode;
  /** Paper-ledger account binding (was PaperStrategyInstance.paperAccountId);
   *  required when mode='paper'. */
  paperAccountId?: string;
  /** Kill switch — `false` skips the instance entirely (open AND management
   *  passes). Precedence over `lifecycleState`: enabled=false always wins;
   *  when enabled, lifecycleState governs (PAUSED/STOPPED still manage
   *  existing positions but open no new ones). */
  enabled: boolean;
  /** ISO of the last pass that fired this instance. */
  lastFiredAt?: string;
  /** ISO of the soft-delete stamp written by StrategyBuilderService.deleteInstance. */
  deletedAt?: string;
}
