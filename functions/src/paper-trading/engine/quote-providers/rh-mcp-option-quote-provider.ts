/**
 *
 * Robinhood MCP real-time option quote provider.
 *
 * Uses the cached OCC → RH instrument map and `get_option_quotes` to return
 * normalized `OptionQuote` objects for open positions.
 */

import type { OptionContractRef, OptionQuote, OccRhInstrumentMapEntry } from '@options-strategy-engine/contracts';
import { TradeSide } from '@common';
import {
  OptionQuoteSource,
  parseOccContractId,
} from '@options/common';
import type { OptionQuoteProvider } from './option-quote-provider';
import { OccRhInstrumentMapService } from '../instrument-map/occ-rh-instrument-map-service';
import { McpOccRhInstrumentMapResolver } from '../instrument-map/mcp-instrument-map-resolver';
import { createLogger } from '../logging';
import {
  MCP_PREFIX,
  QUOTE_BATCH,
  extractQuoteItems,
  parseNum,
  quoteItemId,
  quoteMark,
  type RhQuoteItem,
} from '../rh-mcp-shapes';

export type RobinhoodMcpToolCaller = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export interface RobinhoodMcpOptionQuoteProviderOptions {
  /** Optional instrument-map service. If omitted, one is created that uses `callTool`. */
  mapService?: OccRhInstrumentMapService;
  /** Tool caller, typically `manager.callTool.bind(manager)` from a RobinhoodMcpSessionManager. */
  callTool: RobinhoodMcpToolCaller;
  maxBatchSize?: number;
}

const logger = createLogger('RobinhoodMcpOptionQuoteProvider');

function createDefaultMapService(
  callTool: RobinhoodMcpToolCaller,
): OccRhInstrumentMapService {
  return new OccRhInstrumentMapService(
    new McpOccRhInstrumentMapResolver(callTool),
  );
}

function mapQuote(
  contractID: string,
  mapEntry: OccRhInstrumentMapEntry,
  item: RhQuoteItem,
  side: TradeSide,
  asOfFallback: string,
): OptionQuote {
  const q = item.quote ?? {};
  const close = item.close ?? {};

  const closePrice = parseNum(close.price);
  if (closePrice === undefined) {
    throw new Error(
      `RH MCP quote provider: missing close.price for ${contractID} (${mapEntry.instrumentId})`,
    );
  }

  const mark = quoteMark(item);
  if (mark === undefined) {
    throw new Error(
      `RH MCP quote provider: missing mark for ${contractID} (${mapEntry.instrumentId})`,
    );
  }

  if (close.interpolated) {
    logger.warn(
      `${contractID}: close.price is interpolated`,
    );
  }

  return {
    contractID,
    symbol: mapEntry.chainSymbol,
    expiration: mapEntry.expiration,
    strike: mapEntry.strike,
    type: mapEntry.type,
    side,
    mark,
    bid: parseNum(q.bid_price),
    ask: parseNum(q.ask_price),
    last: parseNum(q.last_trade_price) ?? parseNum(q.previous_close_price),
    volume: parseNum(q.volume),
    openInterest: parseNum(q.open_interest),
    impliedVolatility: parseNum(q.implied_volatility),
    delta: parseNum(q.delta),
    gamma: parseNum(q.gamma),
    theta: parseNum(q.theta),
    vega: parseNum(q.vega),
    rho: parseNum(q.rho),
    source: OptionQuoteSource.RH_MCP,
    asOf: q.updated_at ?? q.last_trade_at ?? asOfFallback,
    interpolatedClose: close.interpolated === true,
  };
}

function parseOccContractIdToRef(contractID: string): OptionContractRef {
  const parsed = parseOccContractId(contractID);
  if (!parsed) {
    throw new Error(
      `RH MCP quote provider: cannot parse OCC contract ID ${contractID}`,
    );
  }
  return {
    contractID,
    symbol: parsed.symbol,
    expiration: parsed.expiration,
    strike: parsed.strike,
    type: parsed.optionType,
  };
}

export class RobinhoodMcpOptionQuoteProvider implements OptionQuoteProvider {
  private readonly mapService: OccRhInstrumentMapService;
  private readonly callTool: RobinhoodMcpToolCaller;
  private readonly maxBatchSize: number;

  constructor(options: RobinhoodMcpOptionQuoteProviderOptions) {
    this.mapService = options.mapService ?? createDefaultMapService(options.callTool);
    this.callTool = options.callTool;
    this.maxBatchSize = options.maxBatchSize ?? QUOTE_BATCH;
  }

  private async resolveMapEntry(
    contractID: string,
  ): Promise<OccRhInstrumentMapEntry> {
    const existing = await this.mapService.get(contractID);
    if (existing) {
      return existing;
    }
    const ref = parseOccContractIdToRef(contractID);
    return this.mapService.getOrResolve(ref);
  }

  async getQuote(
    contractID: string,
    symbol: string,
    side: TradeSide,
  ): Promise<OptionQuote> {
    const parsed = parseOccContractId(contractID);
    if (!parsed) {
      throw new Error(
        `RH MCP quote provider: cannot parse OCC contract ID ${contractID}`,
      );
    }
    if (parsed.symbol !== symbol.toUpperCase()) {
      throw new Error(
        `RH MCP quote provider: symbol mismatch for ${contractID} (${parsed.symbol} vs ${symbol})`,
      );
    }

    const quotes = await this.getQuotes([contractID], side);
    return quotes[0];
  }

  async getQuotes(
    contractIDs: string[],
    side: TradeSide = TradeSide.LONG,
  ): Promise<OptionQuote[]> {
    const asOfFallback = new Date().toISOString();
    const instrumentToEntry: Map<string, OccRhInstrumentMapEntry> = new Map();
    const contractToInstrument: Map<string, string> = new Map();
    for (const contractID of contractIDs) {
      const entry = await this.resolveMapEntry(contractID);
      instrumentToEntry.set(entry.instrumentId, entry);
      contractToInstrument.set(contractID, entry.instrumentId);
    }

    const instrumentIds = Array.from(instrumentToEntry.keys());
    const quotes: OptionQuote[] = [];

    for (let i = 0; i < instrumentIds.length; i += this.maxBatchSize) {
      const batchIds = instrumentIds.slice(i, i + this.maxBatchSize);
      const raw = await this.callTool(`${MCP_PREFIX}get_option_quotes`, {
        instrument_ids: batchIds,
      });
      const items = extractQuoteItems(raw);

      for (const item of items) {
        const instrumentId = quoteItemId(item);
        if (!instrumentId) {
          continue;
        }
        const entry = instrumentToEntry.get(instrumentId);
        if (!entry) {
          continue;
        }
        const contractID = entry.occId;
        quotes.push(mapQuote(contractID, entry, item, side, asOfFallback));
      }
    }

    for (const contractID of contractIDs) {
      const instrumentId = contractToInstrument.get(contractID);
      const found = quotes.find((q) => q.contractID === contractID);
      if (!found) {
        throw new Error(
          `RH MCP quote provider: missing quote for ${contractID} (${instrumentId})`,
        );
      }
    }

    // Return in the order requested so callers can zip results with inputs.
    const byContractID = new Map(quotes.map((q) => [q.contractID, q]));
    return contractIDs.map((id) => byContractID.get(id)!);
  }
}
