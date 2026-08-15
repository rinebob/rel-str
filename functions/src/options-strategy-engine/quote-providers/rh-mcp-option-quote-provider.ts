/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
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

interface RhQuote {
  adjusted_mark_price?: string;
  mark_price?: string;
  ask_price?: string;
  bid_price?: string;
  last_trade_price?: string;
  previous_close_price?: string;
  implied_volatility?: string;
  delta?: string;
  gamma?: string;
  theta?: string;
  vega?: string;
  rho?: string;
  volume?: string | number;
  open_interest?: string | number;
  updated_at?: string;
  last_trade_at?: string;
}

interface RhClose {
  price?: string;
  interpolated?: boolean;
}

interface RhQuoteItem {
  instrument_id?: string;
  instrument?: string;
  id?: string;
  quote?: RhQuote;
  close?: RhClose;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const n = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function parseQuoteItem(raw: unknown): RhQuoteItem | undefined {
  if (!isPlainObject(raw)) {
    return undefined;
  }
  const item = raw;
  if (item.quote !== undefined && !isPlainObject(item.quote)) {
    return undefined;
  }
  if (item.close !== undefined && !isPlainObject(item.close)) {
    return undefined;
  }
  for (const key of ['instrument_id', 'instrument', 'id']) {
    const value = item[key];
    if (value !== undefined && typeof value !== 'string') {
      return undefined;
    }
  }
  return item as RhQuoteItem;
}

function extractQuoteItems(raw: unknown): RhQuoteItem[] {
  if (Array.isArray(raw)) {
    return raw.map(parseQuoteItem).filter((x): x is RhQuoteItem => !!x);
  }
  if (!raw || typeof raw !== 'object') {
    return [];
  }
  const root = raw as Record<string, unknown>;
  const candidates: unknown[] = [
    root.results,
    root.quotes,
    root.options,
    root.data,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(parseQuoteItem).filter((x): x is RhQuoteItem => !!x);
    }
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const inner = candidate as Record<string, unknown>;
      for (const key of ['results', 'quotes', 'options']) {
        if (Array.isArray(inner[key])) {
          return inner[key]!
            .map(parseQuoteItem)
            .filter((x): x is RhQuoteItem => !!x);
        }
      }
    }
  }
  return [];
}

function findInstrumentId(item: RhQuoteItem): string | undefined {
  return (
    item.instrument_id ??
    item.instrument ??
    item.id
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

  const closePrice = parseNumber(close.price);
  if (closePrice === undefined) {
    throw new Error(
      `RH MCP quote provider: missing close.price for ${contractID} (${mapEntry.instrumentId})`,
    );
  }

  const mark =
    parseNumber(q.adjusted_mark_price) ??
    parseNumber(q.mark_price) ??
    parseNumber(q.last_trade_price);
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
    bid: parseNumber(q.bid_price),
    ask: parseNumber(q.ask_price),
    last: parseNumber(q.last_trade_price) ?? parseNumber(q.previous_close_price),
    volume: parseNumber(q.volume),
    openInterest: parseNumber(q.open_interest),
    impliedVolatility: parseNumber(q.implied_volatility),
    delta: parseNumber(q.delta),
    gamma: parseNumber(q.gamma),
    theta: parseNumber(q.theta),
    vega: parseNumber(q.vega),
    rho: parseNumber(q.rho),
    source: OptionQuoteSource.RH_MCP,
    asOf: q.updated_at ?? q.last_trade_at ?? asOfFallback,
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
    this.maxBatchSize = options.maxBatchSize ?? 20;
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
      const raw = await this.callTool('mcp__robinhood-trading__get_option_quotes', {
        instrument_ids: batchIds,
      });
      const items = extractQuoteItems(raw);

      for (const item of items) {
        const instrumentId = findInstrumentId(item);
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
