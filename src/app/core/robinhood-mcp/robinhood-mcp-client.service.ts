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
  BrokerOrderExecution,
  BrokerOrderLeg,
  OrderState,
  OrderType,
  PnlTrade,
  PnlTradeHistory,
  PnlTradeSpan,
  RobinhoodMcpError,
} from './types/robinhood-mcp.types';
import { ToolExecutionErrorCategory, type ToolExecutionResult } from '@robinhood-mcp/contracts';

/** Maximum symbols per quote batch call (above 20, closes are omitted). */
const QUOTE_BATCH_SIZE = 20;

/** Maximum tool calls per /batch request — mirrors the API's own cap. */
const BATCH_CALLS_LIMIT = 20;

/**
 * One tool call plus its typed parse — the unit `executeBatch` sends over
 * the wire ({ tool, args }) and maps back through `parse` on that call's
 * result slot. `parse` throws `RobinhoodMcpError` on a failure result, so
 * it is shared verbatim between the single-call and batch paths.
 */
export interface ToolSpec<T> {
  tool: string;
  args?: Record<string, unknown>;
  parse: (result: ToolExecutionResult) => T;
}

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
    if (result.toolError) {
      throw new RobinhoodMcpError(result.toolError, 'get_accounts', ToolExecutionErrorCategory.MCP);
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
    return this.run(this.portfolioSpec(accountNumber));
  }

  portfolioSpec(accountNumber: string): ToolSpec<PortfolioSnapshot> {
    return {
      tool: 'get_portfolio',
      args: { account_number: accountNumber },
      parse: (result) => {
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
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  async getEquityPositions(accountNumber: string): Promise<EquityPosition[]> {
    return this.run(this.equityPositionsSpec(accountNumber));
  }

  equityPositionsSpec(accountNumber: string): ToolSpec<EquityPosition[]> {
    return {
      tool: 'get_equity_positions',
      args: { account_number: accountNumber },
      parse: (result) => {
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
      },
    };
  }

  async getOptionPositions(accountNumber: string, nonzero?: boolean): Promise<OptionPosition[]> {
    return this.run(this.optionPositionsSpec(accountNumber, nonzero));
  }

  optionPositionsSpec(accountNumber: string, nonzero?: boolean): ToolSpec<OptionPosition[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (nonzero) args['nonzero'] = true;

    return {
      tool: 'get_option_positions',
      args,
      parse: (result) => {
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
      },
    };
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
    return this.run(this.equityOrdersSpec(accountNumber, opts));
  }

  equityOrdersSpec(accountNumber: string, opts?: { state?: OrderState }): ToolSpec<BrokerOrder[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (opts?.state) args['state'] = opts.state;

    return {
      tool: 'get_equity_orders',
      args,
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'get_equity_orders', result.category);
        }

        const raw = this.extractList(result.parsed, 'orders');
        return this.normalizeOrders(raw, accountNumber, 'equity');
      },
    };
  }

  async getOptionOrders(accountNumber: string, opts?: { state?: OrderState }): Promise<BrokerOrder[]> {
    return this.run(this.optionOrdersSpec(accountNumber, opts));
  }

  optionOrdersSpec(accountNumber: string, opts?: { state?: OrderState }): ToolSpec<BrokerOrder[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (opts?.state) args['state'] = opts.state;

    return {
      tool: 'get_option_orders',
      args,
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'get_option_orders', result.category);
        }

        const raw = this.extractList(result.parsed, 'orders');
        return this.normalizeOrders(raw, accountNumber, 'option');
      },
    };
  }

  // ---------------------------------------------------------------------------
  // PnL Trade History
  // ---------------------------------------------------------------------------

  async getPnlTradeHistory(
    accountNumber: string,
    span?: PnlTradeSpan,
  ): Promise<PnlTradeHistory> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (span) args['span'] = span;

    const result = await this.mcp.executeTool('get_pnl_trade_history', { args });
    if (!result.success) {
      throw new RobinhoodMcpError(result.error, 'get_pnl_trade_history', result.category);
    }
    if (result.toolError) {
      throw new RobinhoodMcpError(result.toolError, 'get_pnl_trade_history', ToolExecutionErrorCategory.MCP);
    }

    const data = this.extractNested(result.parsed, 'data');
    const rawTrades = Array.isArray(data['trades']) ? data['trades'] as Record<string, unknown>[] : [];
    return {
      accountNumber: String(data['account_number'] ?? accountNumber),
      span: String(data['span'] ?? span ?? 'week') as PnlTradeSpan,
      trades: rawTrades.map((t): PnlTrade => ({
        timestamp: String(t['timestamp'] ?? ''),
        symbol: String(t['symbol'] ?? ''),
        side: String(t['side'] ?? ''),
        quantity: this.toNumber(t['quantity']),
        price: this.toNumber(t['price']),
        realizedGain: this.toNumber(t['realized_gain']),
      })),
      nextCursor: String(data['next_cursor'] ?? ''),
    };
  }

  // ---------------------------------------------------------------------------
  // Specs → single call / batch execution
  // ---------------------------------------------------------------------------

  /** Execute one spec as a standalone tool call (throws RobinhoodMcpError). */
  private async run<T>(spec: ToolSpec<T>): Promise<T> {
    const result = await this.mcp.executeTool(
      spec.tool,
      spec.args === undefined ? {} : { args: spec.args },
    );
    return this.parseSpecResult(spec, result);
  }

  /**
   * Shared result gate for the single and batch paths: a transport-success
   * result can still carry an MCP envelope-level error (`toolError`) — treat
   * it as a failure instead of parsing the error body as an empty payload.
   */
  private parseSpecResult<T>(spec: ToolSpec<T>, result: ToolExecutionResult): T {
    if (result.success && result.toolError) {
      throw new RobinhoodMcpError(result.toolError, spec.tool, ToolExecutionErrorCategory.MCP);
    }
    return spec.parse(result);
  }

  /**
   * Execute several specs in ONE `/batch` request (one MCP session
   * server-side). Returns one PromiseSettledResult per spec, in order:
   * a failed call rejects only its own slot — the same semantics the
   * callers previously got from `Promise.allSettled` over parallel calls.
   * Rejects only when the batch request itself fails (transport/envelope),
   * in which case every spec should be treated as failed.
   */
  async executeBatch<T extends ToolSpec<unknown>[]>(
    specs: [...T],
  ): Promise<{ [K in keyof T]: T[K] extends ToolSpec<infer R> ? PromiseSettledResult<R> : never }> {
    if (specs.length > BATCH_CALLS_LIMIT) {
      throw new RobinhoodMcpError(
        `Batch requests support at most ${BATCH_CALLS_LIMIT} calls (got ${specs.length})`,
        'batch',
        ToolExecutionErrorCategory.VALIDATION,
      );
    }
    const results = await this.mcp.executeTools(
      specs.map((s) => ({ tool: s.tool, args: s.args })),
    );
    return specs.map((spec, i) => {
      try {
        // Results correlate by index; the per-item `tool` stamp catches a
        // reorder before the wrong spec's parser runs on it.
        const resultTool = (results[i] as { tool?: string }).tool;
        if (resultTool !== undefined && resultTool !== spec.tool) {
          throw new RobinhoodMcpError(
            `Batch result ${i} is for tool '${resultTool}', expected '${spec.tool}'`,
            spec.tool,
          );
        }
        return { status: 'fulfilled' as const, value: this.parseSpecResult(spec, results[i]) };
      } catch (reason) {
        return { status: 'rejected' as const, reason };
      }
    }) as { [K in keyof T]: T[K] extends ToolSpec<infer R> ? PromiseSettledResult<R> : never };
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
      timeInForce: typeof raw['time_in_force'] === 'string' ? raw['time_in_force'] : undefined,
      marketHours: typeof raw['market_hours'] === 'string' ? raw['market_hours'] : undefined,
      legs: this.parseLegs(raw['legs'], rawSide),
      executions: this.parseExecutions(raw['executions']),
    };
  }

  /** Option-order legs — per-instrument contract ids (option_id or the
   *  instrument URL's final segment) + position_effect when the payload
   *  carries it. Returns undefined when absent so `toEqual` consumers see
   *  no phantom key. */
  private parseLegs(raw: unknown, orderSide: 'buy' | 'sell'): BrokerOrderLeg[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((l): BrokerOrderLeg => {
      const leg = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      const side = leg['side'] === 'buy' || leg['side'] === 'sell' ? leg['side'] : orderSide;
      const optionRef = leg['option_id'] ?? leg['option'];
      const optionId = typeof optionRef === 'string' && optionRef
        ? optionRef.split('/').filter(Boolean).pop() ?? null
        : null;
      const effect = leg['position_effect'] === 'open' || leg['position_effect'] === 'close'
        ? leg['position_effect']
        : null;
      return {
        side,
        optionId,
        quantity: this.toNumber(leg['quantity'] ?? leg['ratio_quantity']),
        positionEffect: effect,
      };
    });
  }

  /** Per-fill executions — price/quantity/timestamp per partial fill.
   *  Returns undefined when absent. */
  private parseExecutions(raw: unknown): BrokerOrderExecution[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return raw.map((e): BrokerOrderExecution => {
      const ex = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
      return {
        price: this.toNumber(ex['price']),
        quantity: this.toNumber(ex['quantity']),
        timestamp: typeof ex['timestamp'] === 'string' ? ex['timestamp']
          : typeof ex['time'] === 'string' ? ex['time'] : null,
      };
    });
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
   * QUOTE_BATCH_SIZE, fetch all chunks through the /batch endpoint (one
   * HTTP request per BATCH_CALLS_LIMIT calls), merge into one Map.
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

    // One /batch request per BATCH_CALLS_LIMIT chunks — the API runs the
    // group on a single MCP session instead of one HTTP call per chunk.
    const responses: ToolExecutionResult[] = [];
    for (let i = 0; i < batches.length; i += BATCH_CALLS_LIMIT) {
      const group = batches.slice(i, i + BATCH_CALLS_LIMIT);
      responses.push(
        ...await this.mcp.executeTools(
          group.map((batch) => ({ tool: toolName, args: { [argName]: batch } })),
        ),
      );
    }

    for (const response of responses) {
      if (!response.success) {
        throw new RobinhoodMcpError(response.error, toolName, response.category);
      }
      if (response.toolError) {
        throw new RobinhoodMcpError(response.toolError, toolName, ToolExecutionErrorCategory.MCP);
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
