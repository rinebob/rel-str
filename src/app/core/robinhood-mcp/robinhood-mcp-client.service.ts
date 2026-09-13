/**
 * Typed client for Robinhood MCP tool calls.
 *
 * Wraps `RobinhoodMcpObservationService` (the HTTP transport) with one typed
 * method per MCP tool. Each method:
 * - Calls `executeTool(toolName, { args: { ... } })`
 * - Checks `result.success`
 * - Parses `result.parsed` into a typed return shape
 * - Throws `RobinhoodMcpError` on failure
 *
 * Quote methods (`getEquityQuotes`, `getOptionQuotes`) handle batching
 * internally — deduplicate symbols, split into ~20-symbol chunks, parallel
 * fetch, merge into one map.
 */

import { Injectable, inject } from '@angular/core';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import {
  AccountInfo,
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  EquityQuote,
  OptionQuote,
  BrokerOrder,
  OrderState,
  OrderType,
  RobinhoodMcpError,
} from './types/robinhood-mcp.types';
import { ToolExecutionErrorCategory, type ToolExecutionResult } from '@robinhood-mcp/contracts';

/** Maximum symbols per quote batch call (above 20, closes are omitted). */
const QUOTE_BATCH_SIZE = 20;

/** Maximum concurrent quote batch requests. */
const QUOTE_CONCURRENCY = 5;

@Injectable({ providedIn: 'root' })
export class RobinhoodMcpClient {
  private readonly mcp = inject(RobinhoodMcpObservationService);

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  async getAccounts(): Promise<AccountInfo[]> {
    const result = await this.mcp.executeTool('get_accounts', {});
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_accounts', result.category);
    }

    const raw = this.extractAccountList(result.parsed);
    return raw.map((a) => ({
      accountNumber: String(a['account_number'] ?? ''),
      accountName: String(a['nickname'] ?? ''),
      accountType: String(a['type'] ?? ''),
      agenticAllowed: a['agentic_allowed'] === true,
    }));
  }

  // ---------------------------------------------------------------------------
  // Portfolio
  // ---------------------------------------------------------------------------

  async getPortfolio(accountNumber: string): Promise<PortfolioSnapshot> {
    const result = await this.mcp.executeTool('get_portfolio', { args: { account_number: accountNumber } });
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_portfolio', result.category);
    }

    const data = this.extractNested(result.parsed, 'data');
    // Buying power may be nested ({ buying_power: { buying_power: "..." } })
    // or flat ({ buying_power: "..." }). Try nested first, fall back to flat.
    const buyingPower =
      this.toNumber(this.extractValue(data, 'buying_power', 'buying_power')) ??
      this.toNumber(data['buying_power']);

    return {
      totalValue: this.toNumber(data['total_value']),
      equityValue: this.toNumber(data['equity_value']),
      cash: this.toNumber(data['cash']),
      buyingPower,
      marginExposure: this.toNumber(data['margin_exposure']),
    };
  }

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  async getEquityPositions(accountNumber: string): Promise<EquityPosition[]> {
    const result = await this.mcp.executeTool('get_equity_positions', { args: { account_number: accountNumber } });
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_equity_positions', result.category);
    }

    const raw = this.extractList(result.parsed, 'positions');
    return raw.map((p) => ({
      symbol: String(p['symbol'] ?? ''),
      quantity: this.toNumber(p['quantity']),
      averageBuyPrice: this.toNumber(p['average_buy_price']),
      sharesHeldForSells: this.toNumber(p['shares_held_for_sells']),
    }));
  }

  async getOptionPositions(accountNumber: string, nonzero?: boolean): Promise<OptionPosition[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (nonzero) args['nonzero'] = true;

    const result = await this.mcp.executeTool('get_option_positions', { args });
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_option_positions', result.category);
    }

    const raw = this.extractList(result.parsed, 'results', 'option_positions');
    return raw.map((p) => ({
      instrumentId: String(p['instrument_id'] ?? ''),
      chainSymbol: String(p['chain_symbol'] ?? ''),
      optionType: String(p['type'] ?? p['option_type'] ?? ''),
      strikePrice: this.toNumber(p['strike_price']),
      expirationDate: String(p['expiration_date'] ?? ''),
      quantity: this.toNumber(p['quantity']),
      averageCost: this.toNumber(p['average_cost']),
    }));
  }

  // ---------------------------------------------------------------------------
  // Quotes (with batching + dedup)
  // ---------------------------------------------------------------------------

  async getEquityQuotes(symbols: string[]): Promise<Map<string, EquityQuote>> {
    return this.batchQuotes(
      symbols,
      'get_equity_quotes',
      'symbols',
      (q) => {
        // Results may be flat ({ symbol, last_trade_price }) or nested
        // ({ quote: { symbol, last_trade_price } }).
        const raw = (q['quote'] && typeof q['quote'] === 'object') ? q['quote'] as Record<string, unknown> : q;
        const symbol = String(raw['symbol'] ?? '');
        if (!symbol) return null;
        return {
          symbol,
          lastTradePrice: this.toNumber(raw['last_trade_price']),
          previousClose: this.toNumber(raw['previous_close']),
        };
      },
      (quote) => quote.symbol,
    );
  }

  async getOptionQuotes(instrumentIds: string[]): Promise<Map<string, OptionQuote>> {
    return this.batchQuotes(
      instrumentIds,
      'get_option_quotes',
      'instrument_ids',
      (q) => {
        // Results may be flat or nested under a `quote` key.
        const raw = (q['quote'] && typeof q['quote'] === 'object') ? q['quote'] as Record<string, unknown> : q;
        const id = String(raw['instrument_id'] ?? '');
        if (!id) return null;
        return {
          instrumentId: id,
          lastTradePrice: this.toNumber(raw['last_trade_price']),
          previousClose: this.toNumber(raw['previous_close']),
        };
      },
      (quote) => quote.instrumentId,
    );
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async getEquityOrders(accountNumber: string, opts?: { state?: OrderState }): Promise<BrokerOrder[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (opts?.state) args['state'] = opts.state;

    const result = await this.mcp.executeTool('get_equity_orders', { args });
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_equity_orders', result.category);
    }

    const raw = this.extractList(result.parsed, 'orders');
    return this.normalizeOrders(raw, accountNumber, 'equity');
  }

  async getOptionOrders(accountNumber: string, opts?: { state?: OrderState }): Promise<BrokerOrder[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (opts?.state) args['state'] = opts.state;

    const result = await this.mcp.executeTool('get_option_orders', { args });
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_option_orders', result.category);
    }

    const raw = this.extractList(result.parsed, 'orders');
    return this.normalizeOrders(raw, accountNumber, 'option');
  }

  // ---------------------------------------------------------------------------
  // Shared parsing helpers
  // ---------------------------------------------------------------------------

  private normalizeOrders(raw: Record<string, unknown>[], accountNumber: string, instrumentType: 'equity' | 'option'): BrokerOrder[] {
    const orders: BrokerOrder[] = [];
    for (const item of raw) {
      try {
        orders.push(this.normalizeOrder(item, accountNumber, instrumentType));
      } catch {
        // Skip malformed orders rather than failing the entire list.
      }
    }
    return orders;
  }

  private normalizeOrder(raw: Record<string, unknown>, accountNumber: string, instrumentType: 'equity' | 'option'): BrokerOrder {
    const rawSide = raw['side'];
    if (rawSide !== 'buy' && rawSide !== 'sell') {
      throw new RobinhoodMcpError(
        `Unrecognized order side: ${String(rawSide)}`,
        'normalizeOrder',
        ToolExecutionErrorCategory.MCP,
      );
    }

    // For equity orders, symbol comes from the top-level `symbol` field.
    // For option orders, `symbol` is typically absent — derive from `chain_symbol`.
    const symbol = typeof raw['symbol'] === 'string' && raw['symbol']
      ? raw['symbol']
      : typeof raw['chain_symbol'] === 'string' && raw['chain_symbol']
        ? raw['chain_symbol']
        : null;

    return {
      orderId: String(raw['id'] ?? ''),
      accountNumber,
      instrumentType,
      symbol,
      side: rawSide,
      type: this.parseOrderType(raw['type']),
      state: this.parseOrderState(raw['state']),
      quantity: this.toNumber(raw['quantity']),
      cumulativeQuantity: this.toNumber(raw['cumulative_quantity'] ?? raw['processed_quantity']),
      price: this.toNumber(raw['price']),
      stopPrice: this.toNumber(raw['stop_price']),
      averageFillPrice: this.toNumber(raw['average_price']),
      createdAt: typeof raw['created_at'] === 'string' ? raw['created_at'] : null,
    };
  }

  private parseOrderType(value: unknown): OrderType {
    const s = typeof value === 'string' ? value : 'unknown';
    switch (s) {
      case 'market':
      case 'limit':
      case 'stop_market':
      case 'stop_limit':
        return s;
      default:
        return 'unknown';
    }
  }

  private static readonly VALID_STATES: ReadonlySet<string> = new Set([
    'new', 'queued', 'confirmed', 'unconfirmed', 'partially_filled',
    'filled', 'cancelled', 'rejected', 'failed', 'voided', 'pending_cancelled',
  ]);

  private parseOrderState(value: unknown): OrderState {
    if (typeof value !== 'string') return 'unknown';
    return RobinhoodMcpClient.VALID_STATES.has(value) ? (value as OrderState) : 'unknown';
  }

  /**
   * Batch-fetch quotes: sanitize, deduplicate IDs, split into chunks of
   * QUOTE_BATCH_SIZE, fetch with bounded concurrency, merge into one Map.
   * Throws RobinhoodMcpError if any batch fails.
   */
  private async batchQuotes<T>(
    ids: string[],
    toolName: string,
    argName: string,
    parse: (raw: Record<string, unknown>) => T | null,
    keyOf: (item: T) => string,
  ): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    if (ids.length === 0) return result;

    // Sanitize: trim, filter empty, deduplicate.
    const unique = [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];
    if (unique.length === 0) return result;

    const batches: string[][] = [];
    for (let i = 0; i < unique.length; i += QUOTE_BATCH_SIZE) {
      batches.push(unique.slice(i, i + QUOTE_BATCH_SIZE));
    }

    // Fetch with bounded concurrency to avoid overwhelming the backend.
    const responses: ToolExecutionResult[] = [];
    for (let i = 0; i < batches.length; i += QUOTE_CONCURRENCY) {
      const chunk = batches.slice(i, i + QUOTE_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map((batch) => this.mcp.executeTool(toolName, { args: { [argName]: batch } })),
      );
      responses.push(...chunkResults);
    }

    for (const response of responses) {
      if (!response.success) {
        throw new RobinhoodMcpError(response.error, toolName, response.category);
      }
      const quoteList = this.extractList(response.parsed, 'quotes');
      for (const q of quoteList) {
        const parsed = parse(q);
        if (parsed) {
          const key = keyOf(parsed);
          if (key) result.set(key, parsed);
        }
      }
    }

    return result;
  }

  /** Extract a list of objects from common MCP list-response shapes. */
  private extractList(parsed: unknown, ...containerKeys: string[]): Record<string, unknown>[] {
    if (!parsed || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;

    // Try container keys first (e.g. 'positions', 'quotes')
    for (const key of containerKeys) {
      if (Array.isArray(record[key])) return record[key] as Record<string, unknown>[];
    }

    // Try { results: [...] }
    if (Array.isArray(record['results'])) return record['results'] as Record<string, unknown>[];

    // Try { data: { results: [...] } } or { data: { positions: [...] } }
    const data = record['data'];
    if (data && typeof data === 'object') {
      const dataRecord = data as Record<string, unknown>;
      for (const key of containerKeys) {
        if (Array.isArray(dataRecord[key])) return dataRecord[key] as Record<string, unknown>[];
      }
      if (Array.isArray(dataRecord['results'])) return dataRecord['results'] as Record<string, unknown>[];
    }

    return [];
  }

  private extractAccountList(parsed: unknown): Record<string, unknown>[] {
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (!parsed || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;
    const data = record['data'];
    if (data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['accounts'])) {
      return (data as Record<string, unknown>)['accounts'] as Record<string, unknown>[];
    }
    if (Array.isArray(record['accounts'])) {
      return record['accounts'] as Record<string, unknown>[];
    }
    return [];
  }

  /** Extract a nested object from a parsed response. Returns {} if path is missing. */
  private extractNested(parsed: unknown, ...path: string[]): Record<string, unknown> {
    let current: unknown = parsed;
    for (const segment of path) {
      if (!current || typeof current !== 'object') return {};
      current = (current as Record<string, unknown>)[segment];
    }
    return current && typeof current === 'object' ? (current as Record<string, unknown>) : {};
  }

  /** Extract a raw value at a nested path. Returns undefined if path is missing. */
  private extractValue(obj: unknown, ...path: string[]): unknown {
    let current: unknown = obj;
    for (const segment of path) {
      if (!current || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  /** Convert a value to a number, handling string→number parsing. Returns null if unparseable. */
  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return isNaN(n) ? null : n;
    }
    return null;
  }
}
