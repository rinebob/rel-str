/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Types and interfaces for the OCC → Robinhood MCP instrument map.
 */

import type { OptionQuote, OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';

export interface ResolvedRhInstrumentIds {
  instrumentId: string;
  chainId: string;
}

export interface OccRhInstrumentMapResolver {
  resolve(quote: OptionQuote): Promise<ResolvedRhInstrumentIds>;
}

export type OccRhInstrumentMapWriter = (entry: OccRhInstrumentMapEntry) => Promise<void>;

export type McpToolCaller = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
