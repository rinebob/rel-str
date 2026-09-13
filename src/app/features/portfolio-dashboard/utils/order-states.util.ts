/**
 * Shared order-state classification.
 *
 * Single source of truth for live (resting) and terminal order states.
 * Used by both `portfolio-pnl.util.ts` (stop-loss protection) and
 * `PortfolioDashboardStore` (openOrders / orderHistory selectors).
 */

import { OrderState } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';

/** Active/resting order states — orders still live at the broker. */
export const LIVE_ORDER_STATES: ReadonlySet<OrderState> = new Set([
  'new',
  'queued',
  'confirmed',
  'unconfirmed',
  'partially_filled',
  'pending_cancelled',
]);

/**
 * Terminal order states — orders no longer active.
 * `unknown` is treated as terminal because it cannot be confirmed live.
 */
export const TERMINAL_ORDER_STATES: ReadonlySet<OrderState> = new Set([
  'filled',
  'cancelled',
  'rejected',
  'failed',
  'voided',
  'unknown',
]);
