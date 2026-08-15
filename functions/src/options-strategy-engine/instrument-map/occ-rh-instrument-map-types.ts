/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Types and interfaces for the OCC → Robinhood MCP instrument map.
 */

import type { OptionContractRef, OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';

export interface ResolvedRhInstrumentIds {
  instrumentId: string;
  chainId: string;
}

export interface OccRhInstrumentMapResolver {
  resolve(quote: OptionContractRef): Promise<ResolvedRhInstrumentIds>;
}

export type OccRhInstrumentMapWriter = (entry: OccRhInstrumentMapEntry) => Promise<void>;

export type OccRhInstrumentMapReader = (
  occId: string,
) => Promise<OccRhInstrumentMapEntry | null>;

export type McpToolCaller = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
