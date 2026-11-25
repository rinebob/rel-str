/**
 * @topic #137 — Strategy Manager (task #1712)
 *
 * Unified position-grain mark pass: selection = OPEN trades carrying option
 * legs (era- and source-agnostic — no instance enumeration), each option leg
 * marked from its own quote, signed netMark → currentValue/unrealizedPnl via
 * shared/options-position-math, and marks[date].mark kept in the order-level
 * exit-price space (orderPriceForLiquidationValue) eval readers consume.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runMarkPass } from '../../../functions/src/options-strategy-engine/passes/mark-pass';
import type {
  BatchQuoteProvider,
  MarkPassDependencies,
} from '../../../functions/src/options-strategy-engine/passes/mark-pass';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { OptionQuote } from '../../../shared/options-strategy-engine-contracts';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type {
  PaperTrade,
  PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import type {
  PositionMarkUpdate,
  RawQuote,
} from '../../../functions/src/options-strategy-engine/types';
import { getMarketDatePT } from '../../../functions/src/common/pt-date-utils';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeOptionLeg(
  overrides: Partial<Extract<PaperTradeLeg, { kind: 'option' }>> = {},
): PaperTradeLeg {
  return {
    kind: 'option',
    id: 'PUT-100.00-2025-08-17',
    contractID: 'SPY250817P00100000',
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    strike: 100,
    expiration: '2025-08-17',
    quantity: 1,
    multiplier: 100,
    entryMark: 0.5,
    lastMark: 0.5,
    openDate: '2025-08-15',
    ...overrides,
  };
}

function makeShareLeg(
  overrides: Partial<Extract<PaperTradeLeg, { kind: 'share' }>> = {},
): PaperTradeLeg {
  return {
    kind: 'share',
    id: 'SHARES-100',
    side: TradeSide.LONG,
    quantity: 100,
    multiplier: 1,
    entryMark: 100,
    lastMark: 102,
    openDate: '2025-08-15',
    ...overrides,
  };
}

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 'trade-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'SPY',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    strategyInstanceId: 'inst-1',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [],
    legs: [makeOptionLeg()],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2025-08-15T00:00:00Z',
    updatedAt: '2025-08-15T00:00:00Z',
    ...overrides,
  };
}

function makeQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
  return {
    contractID: 'SPY250817P00100000',
    symbol: 'SPY',
    expiration: '2025-08-17',
    strike: 100,
    type: OptionType.PUT,
    side: TradeSide.SHORT,
    mark: 0.4,
    source: OptionQuoteSource.RH_MCP,
    asOf: '2025-08-15T18:00:00Z',
    ...overrides,
  };
}

interface WriteRecord {
  positionId: string;
  update: PositionMarkUpdate;
  rawQuote: RawQuote;
}

function makeDeps(overrides: {
  listOpenOptionTrades?: () => Promise<PaperTrade[]>;
  quoteProvider?: BatchQuoteProvider;
  writes?: WriteRecord[];
} = {}) {
  const writes = overrides.writes ?? [];
  const deps: MarkPassDependencies = {
    listOpenOptionTrades:
      overrides.listOpenOptionTrades ?? (async () => [makeTrade()]),
    quoteProvider:
      overrides.quoteProvider ??
      ({ getQuotes: async () => [makeQuote()] }),
    markPositionLegs: async (positionId, update, rawQuote) => {
      writes.push({ positionId, update, rawQuote });
    },
  };
  return { deps, writes };
}

// ── runMarkPass — selection contract ─────────────────────────────────────────

describe('runMarkPass', () => {
  it('returns empty result when no open option positions exist', async () => {
    const { deps } = makeDeps({ listOpenOptionTrades: async () => [] });
    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 0);
    assert.ok(result.markedAt);
  });

  it('throws when quoteProvider is not provided', async () => {
    await assert.rejects(
      () => runMarkPass({ listOpenOptionTrades: async () => [] }),
      /quoteProvider is required/,
    );
  });

  it('marks every open option trade regardless of era/source — stock-only and non-OPEN skipped', async () => {
    const stockOnly = makeTrade({
      id: 'signal-stock',
      source: PaperTradeSource.SIGNAL,
      legs: [makeShareLeg()],
    });
    const closed = makeTrade({
      id: 'closed-spread',
      status: PaperTradeStatus.CLOSED,
      legs: [makeOptionLeg()],
    });
    // Legacy era (strategy instance id), manage era (no legacy instance
    // markers), and signal-source option trade — all mark.
    const legacy = makeTrade({ id: 'open-csp' });
    const manage = makeTrade({
      id: 'manage-cc',
      strategyInstanceId: 'M-SPY-CC-30-45',
      governingVariant: 'NONE',
    });
    const signalOption = makeTrade({
      id: 'signal-call',
      source: PaperTradeSource.SIGNAL,
      strategyInstanceId: '',
    });
    const { deps } = makeDeps({
      listOpenOptionTrades: async () => [stockOnly, closed, legacy, manage, signalOption],
    });

    const result = await runMarkPass(deps);
    assert.deepEqual(
      result.positions.map((p) => p.positionId).sort(),
      ['manage-cc', 'open-csp', 'signal-call'],
    );
    assert.equal(result.errors.length, 0);
  });

  // ── Marking + signed net P&L ───────────────────────────────────────────

  it('marks a single-leg SHORT position — legacy parity (mark +0.40, pnl +10)', async () => {
    const { deps, writes } = makeDeps();

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 1);
    const pos = result.positions[0];
    assert.equal(pos.positionId, 'trade-1');
    assert.deepEqual(pos.contractIDs, ['SPY250817P00100000']);
    // signed liquidation value: −0.40 × 100
    assert.equal(pos.netMark, -40);
    // order-level exit price stamped on marks[] — a SHORT order's cost to
    // buy back; unchanged from the legacy pass
    assert.equal(pos.mark, 0.4);
    // signedEntryPremium +50 + netMark −40 = +10 (same as premium − value)
    assert.equal(pos.unrealizedPnl, 10);

    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].update.legMarks, {
      SPY250817P00100000: 0.4,
    });
    assert.equal(writes[0].update.mark, 0.4);
    assert.equal(writes[0].update.unrealizedPnl, 10);
    assert.equal(writes[0].update.currentValueAsOf, '2025-08-15T18:00:00Z');
    // Raw-quote convention: one doc per position per market date
    assert.equal(writes[0].rawQuote.date, getMarketDatePT());
  });

  it('marks each leg of a credit spread with its own quote — no findPrimaryLeg', async () => {
    const spread = makeTrade({
      id: 'bcs-1',
      expression: 'BCS',
      legs: [
        makeOptionLeg({ id: 'leg-short', contractID: 'SPY250817P00100000', entryMark: 0.6 }),
        makeOptionLeg({
          id: 'leg-long',
          contractID: 'SPY250817P00095000',
          side: TradeSide.LONG,
          strike: 95,
          entryMark: 0.35,
        }),
      ],
    });
    const quotes = [
      makeQuote({ contractID: 'SPY250817P00100000', mark: 0.5 }),
      makeQuote({ contractID: 'SPY250817P00095000', side: TradeSide.LONG, mark: 0.3 }),
    ];
    const { deps, writes } = makeDeps({
      listOpenOptionTrades: async () => [spread],
      quoteProvider: {
        getQuotes: async (ids: string[]) =>
          quotes.filter((q) => ids.includes(q.contractID)),
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 1);
    const pos = result.positions[0];
    // netMark = −0.50×100 + 0.30×100 = −20
    assert.equal(pos.netMark, -20);
    // exit price = cost to buy back = short − long = 0.50 − 0.30
    assert.equal(pos.mark, 0.2);
    // entry: premium +25; pnl = 25 − 20 = 5
    assert.equal(pos.unrealizedPnl, 5);
    // Each leg carries ITS OWN mark — not one stamp
    assert.deepEqual(writes[0].update.legMarks, {
      SPY250817P00100000: 0.5,
      SPY250817P00095000: 0.3,
    });
  });

  it('marks a debit spread — positive netMark, positive exit-price mark', async () => {
    const debit = makeTrade({
      id: 'cds-1',
      expression: 'CDS',
      // A debit spread is a BUY — order-level exit price is the proceeds
      // to sell, signed + by orderPriceForLiquidationValue.
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      legs: [
        makeOptionLeg({
          id: 'leg-long',
          contractID: 'SPY250919C00100000',
          type: OptionType.CALL,
          side: TradeSide.LONG,
          entryMark: 0.5,
        }),
        makeOptionLeg({
          id: 'leg-short',
          contractID: 'SPY250919C00105000',
          type: OptionType.CALL,
          strike: 105,
          entryMark: 0.25,
        }),
      ],
    });
    const quotes = [
      makeQuote({ contractID: 'SPY250919C00100000', type: OptionType.CALL, side: TradeSide.LONG, mark: 0.7 }),
      makeQuote({ contractID: 'SPY250919C00105000', type: OptionType.CALL, mark: 0.3 }),
    ];
    const { deps, writes } = makeDeps({
      listOpenOptionTrades: async () => [debit],
      quoteProvider: {
        getQuotes: async (ids: string[]) =>
          quotes.filter((q) => ids.includes(q.contractID)),
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 1);
    const pos = result.positions[0];
    // netMark = +70 − 30 = +40 (debit spread is an asset)
    assert.equal(pos.netMark, 40);
    // LONG-order exit price: you'd SELL for +0.40 — the same convention
    // eval-pass books as the exit fill price.
    assert.equal(pos.mark, 0.4);
    // premium −25 + netMark +40 = +15
    assert.equal(pos.unrealizedPnl, 15);
    assert.equal(writes[0].update.mark, 0.4);
  });

  it('writes the per-unit mark when order quantity > 1', async () => {
    const qty2 = makeTrade({
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 2 },
      legs: [makeOptionLeg({ quantity: 2 })],
    });
    const { deps } = makeDeps({ listOpenOptionTrades: async () => [qty2] });

    const result = await runMarkPass(deps);
    const pos = result.positions[0];
    // netMark = −0.40 × 100 × 2
    assert.equal(pos.netMark, -80);
    // exit price stays per-unit: orderPriceForLiquidationValue divides by
    // order.quantity × multiplier — the mark eval compares to fill prices.
    assert.equal(pos.mark, 0.4);
    // pnl = +100 entry premium − 80 = +20
    assert.equal(pos.unrealizedPnl, 20);
  });

  it('marks only option legs on a mixed stock+option position — share leg keeps stored mark', async () => {
    const covered = makeTrade({
      id: 'cc-1',
      expression: 'CC',
      legs: [
        makeShareLeg({ id: 'shares', entryMark: 100, lastMark: 102 }),
        makeOptionLeg({
          id: 'call-leg',
          contractID: 'SPY250817C00105000',
          type: OptionType.CALL,
          side: TradeSide.SHORT,
          strike: 105,
          entryMark: 0.75,
        }),
      ],
    });
    const { deps, writes } = makeDeps({
      listOpenOptionTrades: async () => [covered],
      quoteProvider: {
        getQuotes: async () => [
          makeQuote({ contractID: 'SPY250817C00105000', type: OptionType.CALL, mark: 2.0 }),
        ],
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 1);
    const pos = result.positions[0];
    // netMark = +102×100 − 2.0×100 = +10000 (share leg contributes stored mark)
    assert.equal(pos.netMark, 10000);
    // order-level exit price: −netMark/(1×100) = −100 — the unwind value
    // per contract unit under orderPriceForLiquidationValue (SHORT order).
    assert.equal(pos.mark, -100);
    // entry: +10000 − 75 = +9925 net value → premium −9925; pnl = −9925 + 10000 = 75
    assert.equal(pos.unrealizedPnl, 75);
    // Only the option leg's mark was fetched + written
    assert.deepEqual(writes[0].update.legMarks, { SPY250817C00105000: 2.0 });
  });

  it('quotes each side group separately so quotes carry their leg side', async () => {
    const spread = makeTrade({
      legs: [
        makeOptionLeg({ id: 'leg-short', contractID: 'SHORT-ID' }),
        makeOptionLeg({ id: 'leg-long', contractID: 'LONG-ID', side: TradeSide.LONG, strike: 95 }),
      ],
    });
    const calls: { ids: string[]; side: TradeSide }[] = [];
    const { deps } = makeDeps({
      listOpenOptionTrades: async () => [spread],
      quoteProvider: {
        getQuotes: async (ids: string[], side: TradeSide) => {
          calls.push({ ids, side });
          return ids.map((id) => makeQuote({ contractID: id, side }));
        },
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 1);
    assert.equal(calls.length, 2);
    const shortCall = calls.find((c) => c.side === TradeSide.SHORT);
    const longCall = calls.find((c) => c.side === TradeSide.LONG);
    assert.deepEqual(shortCall?.ids, ['SHORT-ID']);
    assert.deepEqual(longCall?.ids, ['LONG-ID']);
  });

  // ── Per-position error isolation ───────────────────────────────────────────

  it('isolates a provider failure to its position — other positions still mark', async () => {
    const bad = makeTrade({
      id: 'bad-pos',
      legs: [makeOptionLeg({ contractID: 'BAD-ID' })],
    });
    const good = makeTrade({ id: 'good-pos' });
    const { deps } = makeDeps({
      listOpenOptionTrades: async () => [bad, good],
      quoteProvider: {
        getQuotes: async (ids: string[]) => {
          if (ids.includes('BAD-ID')) throw new Error('MCP connection failed');
          return ids.map((id) => makeQuote({ contractID: id }));
        },
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0].positionId, 'good-pos');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'bad-pos');
    assert.equal(result.errors[0].error, 'MCP connection failed');
  });

  it('errors the whole position when a leg quote is missing — no partial write', async () => {
    const spread = makeTrade({
      id: 'spread-gap',
      legs: [
        makeOptionLeg({ id: 'leg-short', contractID: 'HAS-QUOTE' }),
        makeOptionLeg({ id: 'leg-long', contractID: 'NO-QUOTE', side: TradeSide.LONG, strike: 95 }),
      ],
    });
    const writes: WriteRecord[] = [];
    const { deps } = makeDeps({
      writes,
      listOpenOptionTrades: async () => [spread],
      // Provider echoes quotes for whatever it was asked — one leg absent
      quoteProvider: {
        getQuotes: async (ids: string[]) =>
          ids.filter((id) => id !== 'NO-QUOTE').map((id) => makeQuote({ contractID: id, side: TradeSide.LONG })),
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'spread-gap');
    assert.equal(result.errors[0].contractID, 'NO-QUOTE');
    assert.equal(writes.length, 0);
  });

  it('errors a position whose option leg carries no contractID', async () => {
    const trade = makeTrade({
      id: 'no-contract',
      legs: [makeOptionLeg({ contractID: '' })],
    });
    const { deps, writes } = makeDeps({
      listOpenOptionTrades: async () => [trade],
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'no-contract');
    assert.match(result.errors[0].error, /contractID/);
    assert.equal(writes.length, 0);
  });

  // ── Quote metadata ────────────────────────────────────────────────────────

  it('stamps all leg quotes on the position raw-quote doc', async () => {
    const spread = makeTrade({
      legs: [
        makeOptionLeg({ id: 'a', contractID: 'A' }),
        makeOptionLeg({ id: 'b', contractID: 'B', side: TradeSide.LONG, strike: 95 }),
      ],
    });
    const quotes = [
      makeQuote({ contractID: 'A' }),
      makeQuote({ contractID: 'B', side: TradeSide.LONG }),
    ];
    const { deps, writes } = makeDeps({
      listOpenOptionTrades: async () => [spread],
      quoteProvider: {
        getQuotes: async (ids: string[]) =>
          quotes.filter((q) => ids.includes(q.contractID)),
      },
    });

    await runMarkPass(deps);
    assert.equal(writes.length, 1);
    const raw = writes[0].rawQuote.rawResponse as OptionQuote[];
    assert.equal(raw.length, 2);
    assert.deepEqual(raw.map((q) => q.contractID).sort(), ['A', 'B']);
  });

  it('flags interpolatedClose when any leg quote is interpolated', async () => {
    const spread = makeTrade({
      legs: [
        makeOptionLeg({ id: 'a', contractID: 'A' }),
        makeOptionLeg({ id: 'b', contractID: 'B', side: TradeSide.LONG, strike: 95 }),
      ],
    });
    const { deps } = makeDeps({
      listOpenOptionTrades: async () => [spread],
      quoteProvider: {
        getQuotes: async (ids: string[]) =>
          ids.map((id) =>
            makeQuote({ contractID: id, interpolatedClose: id === 'B' }),
          ),
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions[0].interpolatedClose, true);
  });

  it('uses the latest quote asOf across legs for the position timestamp', async () => {
    const spread = makeTrade({
      legs: [
        makeOptionLeg({ id: 'a', contractID: 'A' }),
        makeOptionLeg({ id: 'b', contractID: 'B', side: TradeSide.LONG, strike: 95 }),
      ],
    });
    const { deps, writes } = makeDeps({
      listOpenOptionTrades: async () => [spread],
      quoteProvider: {
        getQuotes: async (ids: string[]) =>
          ids.map((id) =>
            makeQuote({
              contractID: id,
              asOf: id === 'A' ? '2025-08-15T18:00:00Z' : '2025-08-15T19:30:00Z',
            }),
          ),
      },
    });

    const result = await runMarkPass(deps);
    assert.equal(result.positions[0].asOf, '2025-08-15T19:30:00Z');
    assert.equal(writes[0].update.currentValueAsOf, '2025-08-15T19:30:00Z');
  });
});
