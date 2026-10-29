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
 * internally — deduplicate symbols, split into ~20-symbol chunks, ride the
 * /batch endpoint in BATCH_CALLS_LIMIT groups, merge into one map.
 */

import { Injectable, inject } from '@angular/core';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import {
  AccountInfo,
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  OptionChain,
  OptionInstrument,
  OptionInstrumentFilters,
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
import {
  ToolExecutionErrorCategory,
  type EquityHistoricalInterval,
  type EquityHistoricalsResult,
  type PreviewScanResponse,
  type PreviewScanResult,
  type ScanAppliedFilter,
  type ScanExpressionFilter,
  type ScanResultRow,
  type ToolExecutionResult,
} from '@robinhood-mcp/contracts';
import { chunkSymbols, isExpressionFilter, type ScanRecipe } from '@st/scanner';

/** Maximum symbols per quote batch call (above 20, closes are omitted). */
const QUOTE_BATCH_SIZE = 20;

/** Symbols per preview_scan scope chunk — keeps the /batch request count
 *  under the 20-call cap for the ~925-symbol tracked universe. */
const UNIVERSE_SCOPE_CHUNK = 150;

/** Maximum tool calls per /batch request — mirrors the API's own cap. */
const BATCH_CALLS_LIMIT = 20;

/** get_option_instruments pagination bound (~100 rows/page — 10 pages is
 *  ~1k contracts, deep past any single-expiration strike board). */
const MAX_OPTION_INSTRUMENT_PAGES = 10;

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

/** One preview_scan run — parsed out of `data.result` (#1098). */
export interface ScanRunResult {
  totalItems: number;
  rows: ScanResultRow[];
  /** Parsed echo of each applied filter — feeds buildColumnLookup. */
  filtersApplied: ScanAppliedFilter[];
  /** Display string, e.g. 'Last desc'. */
  sortedBy?: string;
}

/** evaluateUniverse outcome — rows deduped by ticker, plus the symbols
 *  whose chunk rejected (the caller reports them as unevaluated). */
export interface UniverseEvalResult {
  rows: ScanResultRow[];
  unevaluated: string[];
  /** filters_applied echo from the first fulfilled chunk with a
   *  non-empty echo (an empty echo lets a later chunk's win). */
  filtersApplied: ScanAppliedFilter[];
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
      accountName: this.accountDisplayName(a),
      accountType: String(a['type'] ?? ''),
      agenticAllowed: a['agentic_allowed'] === true,
    }));
  }

  /** Display name per the RH accounts guide: `nickname` when set, else a
   *  label for the account kind — 'Investing' for the standard individual
   *  brokerage (the RH app's own label), title-cased account kind
   *  otherwise. Guarantees a non-empty label for unnamed accounts. */
  private accountDisplayName(a: Record<string, unknown>): string {
    const nickname = String(a['nickname'] ?? '');
    if (nickname) return nickname;
    const kind = String(a['brokerage_account_type'] ?? '');
    if (kind === 'individual') return 'Investing';
    const raw = kind || String(a['type'] ?? 'account');
    return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
  // Option contract discovery (#960)
  // ---------------------------------------------------------------------------

  async getOptionChains(symbol: string): Promise<OptionChain[]> {
    return this.run(this.optionChainsSpec(symbol));
  }

  optionChainsSpec(symbol: string): ToolSpec<OptionChain[]> {
    return {
      tool: 'get_option_chains',
      args: { underlying_symbol: symbol },
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'get_option_chains', result.category);
        }

        const raw = this.extractList(result.parsed, 'chains');
        const chains: OptionChain[] = [];
        for (const c of raw) {
          // A chain without an id can't feed chain_id instrument lookups.
          const id = c['id'];
          if (typeof id !== 'string' || !id) continue;
          chains.push({
            chainId: id,
            symbol: String(c['symbol'] ?? ''),
            expirationDates: (Array.isArray(c['expiration_dates']) ? c['expiration_dates'] : [])
              .map(String)
              .sort(),
            ...(typeof c['settle_on_open'] === 'boolean' ? { settleOnOpen: c['settle_on_open'] } : {}),
          });
        }
        return chains;
      },
    };
  }

  async getOptionInstruments(filters: OptionInstrumentFilters): Promise<OptionInstrument[]> {
    // One expiration + no type filter exceeds the ~100-instrument page
    // (SPXW capture, dep-opt-instr-10) — page on `data.next` until
    // exhausted so the strike board isn't silently truncated.
    const spec = this.optionInstrumentsSpec(filters);
    const instruments: OptionInstrument[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_OPTION_INSTRUMENT_PAGES; page++) {
      const result = await this.mcp.executeTool('get_option_instruments', {
        args: { ...spec.args, ...(cursor ? { cursor } : {}) },
      });
      instruments.push(...this.parseSpecResult(spec, result));
      const next = this.extractNested(result.success ? result.parsed : null, 'data')['next'];
      cursor = typeof next === 'string' && next ? next : undefined;
      if (!cursor) return instruments;
    }
    console.warn(
      `get_option_instruments hit the ${MAX_OPTION_INSTRUMENT_PAGES}-page cap (chain_symbol=${filters.chainSymbol}) — results may be truncated`,
    );
    return instruments;
  }

  optionInstrumentsSpec(filters: OptionInstrumentFilters): ToolSpec<OptionInstrument[]> {
    const args: Record<string, unknown> = {
      chain_symbol: filters.chainSymbol,
      // Do NOT pin state/tradability: the tool defaults to
      // active+tradable, but passing the same values explicitly makes
      // upstream return ZERO instruments — verified live (#964).
    };
    if (filters.expirationDates?.length) {
      args['expiration_dates'] = filters.expirationDates.join(',');
    }
    if (filters.strikePrice !== undefined && Number.isFinite(filters.strikePrice)) {
      // RH matches the exact 4-decimal form ('150.0000') per the tool guide.
      args['strike_price'] = filters.strikePrice.toFixed(4);
    }
    if (filters.type) {
      args['type'] = filters.type;
    }

    return {
      tool: 'get_option_instruments',
      args,
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'get_option_instruments', result.category);
        }

        const raw = this.extractList(result.parsed, 'instruments');
        const instruments: OptionInstrument[] = [];
        for (const i of raw) {
          // An instrument without an id is unorderable — skip it. The
          // state/tradability args can't go on the wire (they zero the
          // response — see getOptionInstruments), so filter here instead.
          const id = i['id'];
          if (typeof id !== 'string' || !id) continue;
          if (i['tradability'] === 'untradable' || i['state'] === 'inactive' || i['state'] === 'expired') continue;
          instruments.push({
            instrumentId: id,
            chainId: String(i['chain_id'] ?? ''),
            chainSymbol: String(i['chain_symbol'] ?? ''),
            expirationDate: String(i['expiration_date'] ?? ''),
            strikePrice: this.toNumber(i['strike_price']),
            type: String(i['type'] ?? ''),
          });
        }
        return instruments;
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
        // Live payload: { quote: {...}, close: {...} } — `close` pairs the
        // official settled close (preferred over previous_close_price per
        // the tool guide). Flat shapes still parse.
        const raw = (q['quote'] && typeof q['quote'] === 'object') ? q['quote'] as Record<string, unknown> : q;
        const id = String(raw['instrument_id'] ?? '');
        if (!id) return null;
        const close = (q['close'] && typeof q['close'] === 'object') ? q['close'] as Record<string, unknown> : {};
        return {
          instrumentId: id,
          // RH option quotes carry mark_price (current mark) — there is
          // no last_trade_price field in the wire payload; the property
          // name is the equity shape's. mark is the better "current
          // price" anyway.
          lastTradePrice: this.toNumber(raw['last_trade_price']) ?? this.toNumber(raw['mark_price']),
          previousClose:
            this.toNumber(close['price']) ??
            this.toNumber(raw['previous_close_price']) ??
            this.toNumber(raw['previous_close']),
          bidPrice: this.toNumber(raw['bid_price']),
          askPrice: this.toNumber(raw['ask_price']),
        };
      },
      (quote) => quote.instrumentId,
    );
  }

  // ---------------------------------------------------------------------------
  // Orders
  // ---------------------------------------------------------------------------

  async getEquityOrders(
    accountNumber: string,
    opts?: { state?: OrderState; orderId?: string },
  ): Promise<BrokerOrder[]> {
    return this.run(this.equityOrdersSpec(accountNumber, opts));
  }

  equityOrdersSpec(
    accountNumber: string,
    opts?: { state?: OrderState; orderId?: string },
  ): ToolSpec<BrokerOrder[]> {
    const args: Record<string, unknown> = { account_number: accountNumber };
    if (opts?.state) args['state'] = opts.state;
    if (opts?.orderId) args['order_id'] = opts.orderId;

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
  // Scanner — preview_scan (#1098)
  // ---------------------------------------------------------------------------

  async previewScan(recipe: ScanRecipe): Promise<ScanRunResult> {
    return this.run(this.previewScanSpec(recipe));
  }

  previewScanSpec(recipe: ScanRecipe): ToolSpec<ScanRunResult> {
    return {
      tool: 'preview_scan',
      args: this.previewScanArgs(recipe),
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'preview_scan', result.category);
        }
        const r = this.parseScanResult(result.parsed);
        return {
          totalItems: r.total_items,
          rows: r.results,
          filtersApplied: Array.isArray(r.filters_applied) ? r.filters_applied : [],
          ...(typeof r.sorted_by === 'string' && r.sorted_by ? { sortedBy: r.sorted_by } : {}),
        };
      },
    };
  }

  /** Raw wire shape — the auto-run overview's per-recipe tables render
   *  `PreviewScanResult` directly (#1198). Same call as `previewScan`,
   *  un-flattened. */
  async previewScanRaw(recipe: ScanRecipe): Promise<PreviewScanResult> {
    return this.run(this.previewScanRawSpec(recipe));
  }

  previewScanRawSpec(recipe: ScanRecipe): ToolSpec<PreviewScanResult> {
    return {
      tool: 'preview_scan',
      args: this.previewScanArgs(recipe),
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'preview_scan', result.category);
        }
        return this.parseScanResult(result.parsed);
      },
    };
  }

  private previewScanArgs(recipe: ScanRecipe): Record<string, unknown> {
    return { filters: recipe.filters, columns: recipe.columns };
  }

  /** Parse the `data.result` payload off a preview_scan response. Throws
   *  on a missing/malformed result — an absent `data.result` is wire
   *  drift, not "zero matches" (a legitimately empty scan is
   *  `results: []`). */
  private parseScanResult(parsed: unknown): PreviewScanResult {
    const r = (parsed as Partial<PreviewScanResponse> | undefined)?.data?.result;
    if (
      !r ||
      !Array.isArray(r.results) ||
      typeof r.total_items !== 'number' ||
      !r.results.every((row) => !!row && typeof row === 'object')
    ) {
      throw new RobinhoodMcpError(
        'preview_scan response missing data.result shape',
        'preview_scan',
        ToolExecutionErrorCategory.MCP,
      );
    }
    return r;
  }

  /** Symbol-scoped variant of a recipe — the chunk's ANY_OF scope replaces
   *  any baked-in symbol scope in the recipe's filters. */
  evaluateUniverseSpec(recipe: ScanRecipe, symbols: string[]): ToolSpec<PreviewScanResult> {
    const filters = recipe.filters.filter(
      (f) =>
        !(
          isExpressionFilter(f) &&
          typeof f.expression === 'string' &&
          f.expression.trim().toLowerCase() === 'symbol'
        ),
    );
    const scope: ScanExpressionFilter = {
      expression: 'symbol',
      predicate: 'ANY_OF',
      values: symbols,
    };
    return {
      tool: 'preview_scan',
      args: { filters: [...filters, scope], columns: recipe.columns },
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'preview_scan', result.category);
        }
        return this.parseScanResult(result.parsed);
      },
    };
  }

  /**
   * Evaluate the recipe against the tracked universe: symbols chunk at
   * UNIVERSE_SCOPE_CHUNK per scope call, all chunks ride one /batch
   * request per BATCH_CALLS_LIMIT group. A rejected chunk isolates to its
   * own symbols — they come back in `unevaluated`, not as a failed run.
   * A batch-level transport failure rejects the whole call — degraded
   * sessions must surface as errors, never a silent empty result.
   *
   * `onProgress(done, total)` fires once per settled batch group —
   * `total` is the chunk count, `done` the chunks settled so far. With
   * ≤20 chunks per group (BATCH_CALLS_LIMIT) a ~900-symbol universe is
   * a single group, so callers get one tick, not per-chunk granularity.
   */
  async evaluateUniverse(
    recipe: ScanRecipe,
    symbols: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<UniverseEvalResult> {
    // Sanitize like batchQuotes — trims, drops empties, dedupes before
    // chunking so a duped input can't double-count or double-report.
    const unique = [...new Set(symbols.map((s) => s.trim()).filter((s) => s.length > 0))];
    if (unique.length === 0) return { rows: [], unevaluated: [], filtersApplied: [] };

    const chunks = chunkSymbols(unique, UNIVERSE_SCOPE_CHUNK);
    const settled: PromiseSettledResult<PreviewScanResult>[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_CALLS_LIMIT) {
      const group = chunks.slice(i, i + BATCH_CALLS_LIMIT);
      settled.push(
        ...(await this.executeBatch(
          group.map((chunk) => this.evaluateUniverseSpec(recipe, chunk)),
        )),
      );
      onProgress?.(settled.length, chunks.length);
    }

    const rows: ScanResultRow[] = [];
    const seen = new Set<string>();
    const unevaluated: string[] = [];
    let filtersApplied: ScanAppliedFilter[] = [];
    chunks.forEach((chunk, i) => {
      const s = settled[i];
      if (s.status === 'fulfilled') {
        if (filtersApplied.length === 0 && Array.isArray(s.value.filters_applied)) {
          filtersApplied = s.value.filters_applied;
        }
        for (const row of s.value.results) {
          const ticker = typeof row.ticker === 'string' ? row.ticker.trim() : '';
          if (ticker && !seen.has(ticker)) {
            seen.add(ticker);
            rows.push(row);
          }
        }
      } else {
        unevaluated.push(...chunk);
      }
    });
    return { rows, unevaluated, filtersApplied };
  }

  // ---------------------------------------------------------------------------
  // Equity historicals (#1259 — ephemeral charts for untracked symbols)
  // ---------------------------------------------------------------------------

  /**
   * Fetch OHLCV bars for one or more symbols (≤10) over an RFC3339 range at a
   * native interval. Returns the wire payload — callers own string→number
   * coercion and interval slicing (RhChartService builds ChartDatasets).
   */
  async getEquityHistoricals(
    symbols: string[],
    interval: EquityHistoricalInterval,
    startTime: string,
    endTime?: string,
  ): Promise<EquityHistoricalsResult> {
    return this.run(this.equityHistoricalsSpec(symbols, interval, startTime, endTime));
  }

  equityHistoricalsSpec(
    symbols: string[],
    interval: EquityHistoricalInterval,
    startTime: string,
    endTime?: string,
  ): ToolSpec<EquityHistoricalsResult> {
    return {
      tool: 'get_equity_historicals',
      args: {
        symbols,
        start_time: startTime,
        interval,
        bounds: 'regular',
        adjustment_type: 'split',
        ...(endTime ? { end_time: endTime } : {}),
      },
      parse: (result) => {
        if (!result.success) {
          throw new RobinhoodMcpError(result.error, 'get_equity_historicals', result.category);
        }
        const parsed = result.parsed as Partial<EquityHistoricalsResult> | undefined;
        if (!parsed || !Array.isArray(parsed.data?.results)) {
          throw new RobinhoodMcpError(
            'get_equity_historicals response missing data.results shape',
            'get_equity_historicals',
            ToolExecutionErrorCategory.MCP,
          );
        }
        return parsed as EquityHistoricalsResult;
      },
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
    // Named in the captured cancel guide (mx-can-bid) as a success state.
    'partially_filled_rest_cancelled',
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
