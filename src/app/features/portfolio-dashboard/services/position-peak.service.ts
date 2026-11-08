/**
 * PositionPeakService (#1413) — derives Peak Since Entry per equity position.
 *
 * Orchestration: per-symbol paginated fills walk on get_equity_orders
 * (symbol-filtered, batched one round per page depth) until the holding
 * period's zero-crossing or history exhaustion, then ONE batched
 * get_equity_historicals call per ≤10 symbols at 'day' interval for the
 * peak scan. Surfacing data, not gating — failures mark a symbol
 * underivable (entryDate null → UI '—'), never reject the batch.
 */

import { Injectable, inject } from '@angular/core';
import { EquityHistoricalBar } from '@robinhood-mcp/contracts';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';
import {
  EquityPosition,
  EquityOrdersPage,
} from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import {
  FillEvent,
  HoldingPeriod,
  PositionPeak,
  currentHoldingPeriod,
  fillsFromOrders,
  peakSince,
} from '../utils/position-peak.util';

/** Max pagination rounds per derive call — pages are ~200 orders each and
 *  symbol-filtered, so 10 rounds is far past any real holding period. */
const MAX_PEAK_PAGE_ROUNDS = 10;

/** get_equity_historicals accepts ≤10 symbols per call. */
const HISTORICALS_SYMBOL_CHUNK = 10;

/** /batch rejects >20 calls — a fills round must never exceed it. */
const FILLS_BATCH_CHUNK = 20;

interface SymbolWalk {
  qty: number;
  fills: FillEvent[];
  cursor: string | null | undefined;
  holdingPeriod: HoldingPeriod | null;
  done: boolean;
}

@Injectable({ providedIn: 'root' })
export class PositionPeakService {
  private readonly client = inject(RobinhoodMcpClient);

  /**
   * Derive peaks for every non-flat equity position on one account.
   * Returns one PositionPeak per processed symbol (flat positions are
   * skipped — a zero-qty row has no holding period).
   */
  async derivePeaks(
    accountNumber: string,
    positions: EquityPosition[],
  ): Promise<Record<string, PositionPeak>> {
    const walks = new Map<string, SymbolWalk>();
    for (const p of positions) {
      const qty = p.quantity ?? 0;
      if (qty === 0 || !p.symbol || walks.has(p.symbol)) continue;
      walks.set(p.symbol, { qty, fills: [], cursor: undefined, holdingPeriod: null, done: false });
    }

    await this.walkFills(accountNumber, walks);
    return this.composePeaks(accountNumber, walks);
  }

  /** Round-batched fills walk: all unresolved symbols page together, so a
   *  deep entry costs rounds ≈ its page depth, not a serial crawl per
   *  symbol. */
  private async walkFills(accountNumber: string, walks: Map<string, SymbolWalk>): Promise<void> {
    for (let round = 0; round < MAX_PEAK_PAGE_ROUNDS; round++) {
      const targets = [...walks.entries()].filter(([, s]) => !s.done);
      if (targets.length === 0) return;

      // /batch caps at 20 calls — accounts with more open positions split
      // the round into sequential chunks (all still one page depth).
      for (let c = 0; c < targets.length; c += FILLS_BATCH_CHUNK) {
        const chunk = targets.slice(c, c + FILLS_BATCH_CHUNK);
        const specs = chunk.map(([symbol, s]) =>
          this.client.equityOrdersPageSpec(accountNumber, {
            symbol,
            ...(s.cursor ? { cursor: s.cursor } : {}),
          }),
        );
        const results = await this.client.executeBatch(specs);
        this.applyPageResults(chunk, results);
      }
    }
    const capped = [...walks.keys()].filter((k) => !walks.get(k)!.done);
    if (capped.length > 0) {
      console.warn(
        `derivePeaks hit the ${MAX_PEAK_PAGE_ROUNDS}-page cap for ${capped.join(', ')} — entries may be underivable`,
      );
    }
  }

  private applyPageResults(
    targets: [string, SymbolWalk][],
    results: PromiseSettledResult<EquityOrdersPage>[],
  ): void {
    for (const [i, r] of results.entries()) {
      const [, s] = targets[i];
      if (r.status !== 'fulfilled') {
        s.done = true; // a failed page marks the symbol underivable
        s.holdingPeriod = {
          entryDate: null,
          lastFillDate: s.fills[0]?.timestamp ?? null,
        };
        continue;
      }
      const page = r.value;
      // Pages arrive newest-first, but re-sort anyway — executions within
      // an order aren't timestamp-ordered on the wire.
      s.fills = [...s.fills, ...fillsFromOrders(page.orders)].sort(
        (a, b) => (a.timestamp < b.timestamp ? 1 : -1),
      );
      s.holdingPeriod = currentHoldingPeriod(s.qty, s.fills);
      if (s.holdingPeriod?.entryDate || !page.next) {
        s.done = true;
      } else {
        s.cursor = page.next;
      }
    }
  }

  /** One historicals batch (≤10 symbols/call) over the union of needed
   *  dates, then per-symbol peak scans. */
  private async composePeaks(
    accountNumber: string,
    walks: Map<string, SymbolWalk>,
  ): Promise<Record<string, PositionPeak>> {
    const out: Record<string, PositionPeak> = {};

    // Symbols with any derivable date need bars; start the range at the
    // oldest needed date so one call covers every symbol's window.
    const needsBars = [...walks.entries()].filter(
      ([, s]) => s.holdingPeriod?.entryDate || s.holdingPeriod?.lastFillDate,
    );
    const earliest = needsBars
      .flatMap(([, s]) => [s.holdingPeriod!.entryDate, s.holdingPeriod!.lastFillDate])
      .filter((d): d is string => d !== null)
      .sort()[0];

    const barsBySymbol = new Map<string, EquityHistoricalBar[]>();
    if (earliest) {
      const symbols = needsBars.map(([sym]) => sym);
      for (let i = 0; i < symbols.length; i += HISTORICALS_SYMBOL_CHUNK) {
        const chunk = symbols.slice(i, i + HISTORICALS_SYMBOL_CHUNK);
        try {
          const hist = await this.client.getEquityHistoricals(
            chunk,
            'day',
            earliest,
            new Date().toISOString(),
          );
          for (const r of hist.data.results) {
            barsBySymbol.set(r.symbol, r.bars);
          }
        } catch {
          // Historicals failure → the chunk's symbols get null peaks below.
        }
      }
    }

    for (const [symbol, s] of walks) {
      const hp = s.holdingPeriod;
      const bars = barsBySymbol.get(symbol) ?? [];
      out[symbol] = {
        symbol,
        entryDate: hp?.entryDate ?? null,
        lastFillDate: hp?.lastFillDate ?? null,
        lifetime: hp?.entryDate ? peakSince(bars, hp.entryDate) : null,
        sinceLastFill: hp?.lastFillDate ? peakSince(bars, hp.lastFillDate) : null,
      };
    }
    return out;
  }
}
