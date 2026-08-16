/**
 *
 * Robinhood MCP resolver for OCC → RH instrument map entries.
 *
 * Uses `get_option_instruments` (and `get_option_chains` as a fallback) to
 * translate a normalized `OptionQuote` into a Robinhood `instrumentId` and
 * `chainId`.
 */

import type { OptionContractRef } from '@options-strategy-engine/contracts';
import { executeObservationTool } from '../../rh-agent-mcp/tools/robinhood-tool-executor';
import type {
  McpToolCaller,
  OccRhInstrumentMapResolver,
  ResolvedRhInstrumentIds,
} from './occ-rh-instrument-map-types';

interface RhInstrument {
  id?: string;
  chain_id?: string;
  chain_symbol?: string;
  expiration_date?: string;
  strike_price?: string;
  type?: string;
}

interface RhGetOptionInstrumentsResponse {
  data?: {
    instruments?: RhInstrument[];
    next?: string;
  };
  instruments?: RhInstrument[];
  next?: string;
}

interface RhChain {
  id?: string;
  symbol?: string;
  expiration_dates?: string[];
}

interface RhGetOptionChainsResponse {
  data?: {
    chains?: RhChain[];
  };
  chains?: RhChain[];
}

function extractInstruments(
  raw: unknown,
): { instruments: RhInstrument[]; next?: string } {
  const response = raw as RhGetOptionInstrumentsResponse | undefined;
  const data = response?.data;
  if (data && Array.isArray(data.instruments)) {
    return { instruments: data.instruments, next: data.next };
  }
  if (Array.isArray(response?.instruments)) {
    return { instruments: response.instruments, next: response.next };
  }
  return { instruments: [] };
}

function extractChains(raw: unknown): RhChain[] {
  const response = raw as RhGetOptionChainsResponse | undefined;
  const data = response?.data;
  if (data && Array.isArray(data.chains)) {
    return data.chains;
  }
  if (Array.isArray(response?.chains)) {
    return response.chains;
  }
  return [];
}

function instrumentMatches(
  instrument: RhInstrument,
  quote: OptionContractRef,
): boolean {
  if (instrument.expiration_date !== quote.expiration) return false;
  if (!instrument.strike_price) return false;
  const strike = Number(instrument.strike_price);
  if (!Number.isFinite(strike)) return false;
  if (Math.abs(strike - quote.strike) >= 0.0001) return false;
  if (String(instrument.type ?? '').toLowerCase() !== quote.type) return false;
  return true;
}

function makeDefaultMcpToolCaller(): McpToolCaller {
  return async (toolName, args) => {
    const result = await executeObservationTool(toolName, args);
    if (!result.success) {
      throw new Error(`MCP tool ${toolName} failed: ${result.error}`);
    }
    return result.parsed ?? {};
  };
}

export class McpOccRhInstrumentMapResolver implements OccRhInstrumentMapResolver {
  constructor(
    private readonly callTool: McpToolCaller = makeDefaultMcpToolCaller(),
  ) {}

  async resolve(quote: OptionContractRef): Promise<ResolvedRhInstrumentIds> {
    const symbol = quote.symbol.toUpperCase();
    const strikePrice = quote.strike.toFixed(4);
    const baseArgs = {
      expiration_dates: quote.expiration,
      strike_price: strikePrice,
      type: quote.type,
    };

    const bySymbol = await this.findMatchingInstrument(
      { chain_symbol: symbol, ...baseArgs },
      quote,
    );
    if (bySymbol) {
      return bySymbol;
    }

    // Fallback: resolve chain_id via get_option_chains and retry with it.
    const chainId = await this.resolveChainId(symbol, quote.expiration);
    if (!chainId) {
      throw new Error(
        `Could not resolve RH chain for ${symbol} expiration ${quote.expiration}`,
      );
    }

    const byChainId = await this.findMatchingInstrument(
      { chain_id: chainId, ...baseArgs },
      quote,
    );
    if (byChainId) {
      return byChainId;
    }

    throw new Error(
      `Could not resolve RH instrument for ${quote.contractID}`,
    );
  }

  private async findMatchingInstrument(
    baseArgs: Record<string, unknown>,
    quote: OptionContractRef,
  ): Promise<ResolvedRhInstrumentIds | null> {
    let cursor: string | undefined;
    do {
      const args: Record<string, unknown> = { ...baseArgs };
      if (cursor) {
        args.cursor = cursor;
      }

      const raw = await this.callTool(
        'mcp__robinhood-trading__get_option_instruments',
        args,
      );
      const { instruments, next } = extractInstruments(raw);
      const match = instruments.find((i) => instrumentMatches(i, quote));
      if (match?.id && match?.chain_id) {
        return {
          instrumentId: match.id,
          chainId: match.chain_id,
        };
      }
      cursor = next;
    } while (cursor);

    return null;
  }

  private async resolveChainId(
    symbol: string,
    expiration: string,
  ): Promise<string | undefined> {
    const raw = await this.callTool(
      'mcp__robinhood-trading__get_option_chains',
      { underlying_symbol: symbol },
    );
    const chains = extractChains(raw);
    const match = chains.find(
      (c) =>
        c.symbol?.toUpperCase() === symbol &&
        c.expiration_dates?.includes(expiration),
    );
    return match?.id;
  }
}
