/**
 * RH Agent Opportunity / Trade Types
 *
 * Trade actions and future opportunity/trade payload types for the agent.
 */

/**
 * Type of trade action.
 */
export enum RhTradeAction {
  HOLD = 'HOLD',
  BUY_TO_OPEN = 'BUY TO OPEN',
  SELL_TO_OPEN = 'SELL TO OPEN',
  SELL_TO_CLOSE = 'SELL TO CLOSE',
  BUY_TO_CLOSE = 'BUY TO CLOSE',
}
