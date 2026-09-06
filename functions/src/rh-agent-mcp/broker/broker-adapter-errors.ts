/**
 * Broker adapter error types.
 *
 * `BrokerAdapterError` carries a `category` propagated from the underlying
 * MCP tool executor (`ToolExecutionErrorCategory`) or a `TIMEOUT` category
 * for adapter-level timeouts.
 */

import { ToolExecutionErrorCategory } from '@robinhood-mcp/contracts';

export type BrokerAdapterErrorCategory = ToolExecutionErrorCategory | 'TIMEOUT';

export class BrokerAdapterError extends Error {
  readonly category: BrokerAdapterErrorCategory;

  constructor(message: string, category: BrokerAdapterErrorCategory = ToolExecutionErrorCategory.UNKNOWN) {
    super(message);
    this.name = 'BrokerAdapterError';
    this.category = category;
  }
}
