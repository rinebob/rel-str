/**
 * Equity Price Service
 *
 * Fetches current equity prices via the Robinhood MCP observation API.
 * Caches prices in-memory for the session.
 */
import { Injectable, inject } from '@angular/core';
import { signal, Signal } from '@angular/core';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import { getNestedNumber, getNestedString, extractNumber } from '../utils/mcp-response.util';

@Injectable({ providedIn: 'root' })
export class EquityPriceService {
  private readonly mcpService = inject(RobinhoodMcpObservationService);

  /** In-memory price cache: symbol → price. */
  private readonly _prices = signal<Record<string, number>>({});

  /** Loading state. */
  private readonly _loading = signal(false);

  /** Error state. */
  private readonly _error = signal<string | null>(null);
  private lastRequestedSymbols = '';

  /** Read-only price map. */
  readonly prices: Signal<Record<string, number>> = this._prices.asReadonly();

  /** Loading state. */
  readonly loading: Signal<boolean> = this._loading.asReadonly();

  /** Error state. */
  readonly error: Signal<string | null> = this._error.asReadonly();

  /** Fetch prices for the given symbols via RH MCP get_equity_quotes. */
  async fetchPrices(symbols: string[]): Promise<void> {
    const unique = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(Boolean).sort();
    if (unique.length === 0) return;
    const requestKey = unique.join(',');
    if (requestKey === this.lastRequestedSymbols) return;
    this.lastRequestedSymbols = requestKey;

    this._loading.set(true);
    this._error.set(null);

    try {
      const result = await this.mcpService.executeTool('get_equity_quotes', { args: { symbols: unique } });
      if (!result.success) {
        this.lastRequestedSymbols = '';
        this._error.set(result.error ?? 'Failed to fetch quotes');
        console.error('[EquityPriceService] get_equity_quotes failed:', result.error);
        return;
      }

      const prices = this.extractPrices(result.parsed);
      if (Object.keys(prices).length === 0) {
        console.warn('[EquityPriceService] No prices extracted from response. Parsed shape:', JSON.stringify(result.parsed)?.slice(0, 500));
      }
      this._prices.update((prev) => ({ ...prev, ...prices }));
    } catch (err) {
      this.lastRequestedSymbols = '';
      const message = err instanceof Error ? err.message : String(err);
      this._error.set(message);
      console.error('[EquityPriceService] Failed to fetch prices:', err);
    } finally {
      this._loading.set(false);
    }
  }

  /** Get the cached price for a single symbol, or null. */
  getPrice(symbol: string): number | null {
    return this._prices()[symbol.toUpperCase()] ?? null;
  }

  /** Extract prices from the MCP response.
   *
   * Response shape from get_equity_quotes:
   * { data: { results: [ { quote: { symbol, last_trade_price, ... }, close: { ... } } ] } }
   */
  private extractPrices(parsed: unknown): Record<string, number> {
    const result: Record<string, number> = {};
    if (!parsed || typeof parsed !== 'object') return result;

    const record = parsed as Record<string, unknown>;
    const data = record['data'];
    const dataRecord = data && typeof data === 'object' ? data as Record<string, unknown> : record;
    const results = Array.isArray(dataRecord) ? dataRecord :
      Array.isArray(dataRecord['results']) ? dataRecord['results'] :
      Array.isArray(record['results']) ? record['results'] :
      Array.isArray(parsed) ? parsed : null;

    if (results && Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== 'object') continue;
        const itemRecord = item as Record<string, unknown>;

        const sym = getNestedString(itemRecord, 'quote', 'symbol')
          ?? getNestedString(itemRecord, 'symbol');
        const price = getNestedNumber(itemRecord, 'quote', 'last_trade_price')
          ?? getNestedNumber(itemRecord, 'quote', 'last_non_reg_trade_price')
          ?? getNestedNumber(itemRecord, 'quote', 'last_price')
          ?? getNestedNumber(itemRecord, 'quote', 'price')
          ?? getNestedNumber(itemRecord, 'close', 'price')
          ?? extractNumber(itemRecord['last_trade_price'])
          ?? extractNumber(itemRecord['last_price'])
          ?? extractNumber(itemRecord['price']);
        if (sym && price !== null) result[sym.toUpperCase()] = price;
      }
    }

    return result;
  }
}
