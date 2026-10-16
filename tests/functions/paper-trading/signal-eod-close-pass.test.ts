/**
 * @topic #553 — Paper Trading Infra (task #983)
 *
 * signal-eod-close-pass: stamps the official SDS daily close into
 * `marks[date]` on OPEN signal-source trades during the nightly chain —
 * BEFORE the exit eval pass, so trailing-stop eval and the persisted
 * daily mark both reflect the official close rather than the last ~1 PM
 * PT intraday RH quote. Share-leg trades only (order mark = underlying
 * close); option-leg trades keep their intraday mark (settled at expiry
 * by the signal settlement pass). Missing SDS bars leave the intraday
 * mark standing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource, OptionType } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
} from '../../../shared/paper-trading-contracts';
import {
  runSignalEodClosePass,
  type SignalEodClosePassDeps,
} from '../../../functions/src/paper-trading/passes/signal-eod-close-pass';
import { runSettlementForAllInstances } from '../../../functions/src/paper-trading/engine/options-strategy-pass-orchestrators';

const MARKET_DATE = '2026-10-15';

function shareSignalTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '261013-sig-AAPL-EQV1L',
    status: PaperTradeStatus.OPEN,
    userId: 'auto-paper',
    source: PaperTradeSource.SIGNAL,
    symbol: 'AAPL',
    expression: 'EQV1L',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 10 },
    fills: [
      {
        fillId: 'entry-1',
        role: 'entry',
        date: '2026-10-13',
        price: 240,
        quantity: 10,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'share',
        side: TradeSide.LONG,
        quantity: 10,
        multiplier: 1,
        entryMark: 240,
        lastMark: 241.5, // last intraday mark — superseded by the close
      },
    ],
    marks: { '2026-10-15': { mark: 241.5 } },
    variantRuns: [
      { variantKey: 'trailing-8', governing: true, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['trailing-8'],
    realizedPnl: 0,
    unrealizedPnl: 15,
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  };
}

function optionSignalTrade(): PaperTrade {
  const leg = shareSignalTrade().legs[0];
  return shareSignalTrade({
    legs: [
      {
        ...leg,
        kind: 'option',
        contractID: 'AAPL261030C00250000',
        type: OptionType.CALL,
        strike: 250,
        expiration: '2026-10-30',
      } as PaperTrade['legs'][number],
    ],
  });
}

function makeDeps(overrides: Partial<SignalEodClosePassDeps> = {}) {
  const writes: { tradeId: string; update: unknown; rawQuote: unknown }[] = [];
  const deps: SignalEodClosePassDeps = {
    listOpenSignalTrades:
      overrides.listOpenSignalTrades ?? (async () => [shareSignalTrade()]),
    getUnderlyingClose: overrides.getUnderlyingClose ?? (async () => 245),
    markTrade:
      overrides.markTrade ??
      (async (tradeId, update, rawQuote) => {
        writes.push({ tradeId, update, rawQuote });
        return true;
      }),
    now: () => new Date('2026-10-15T23:30:00.000Z'),
    ...overrides,
  };
  return { deps, writes };
}

describe('runSignalEodClosePass', () => {
  it('stamps the official close over the intraday mark on a share trade', async () => {
    const { deps, writes } = makeDeps();
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.equal(summary.stamped, 1);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.skippedNoClose, 0);
    assert.equal(summary.errors.length, 0);

    assert.equal(writes.length, 1);
    const w = writes[0];
    assert.equal(w.tradeId, '261013-sig-AAPL-EQV1L');
    const update = w.update as {
      mark: number;
      underlyingClose?: number;
      unrealizedPnl?: number;
      asOf: string;
    };
    assert.equal(update.mark, 245);
    assert.equal(update.underlyingClose, 245);
    // LONG 10 @ entry 240 → close 245: +50 unrealized (supersedes the 15 stored).
    assert.equal(update.unrealizedPnl, 50);
    const rq = w.rawQuote as { date: string; rawResponse: { pass: string } };
    assert.equal(rq.date, MARKET_DATE);
    assert.equal(rq.rawResponse.pass, 'eod-close');
  });

  it('leaves the intraday mark standing when SDS has no bar for the date', async () => {
    const { deps, writes } = makeDeps({
      getUnderlyingClose: async () => null,
    });
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.equal(summary.stamped, 0);
    assert.equal(summary.skippedNoClose, 1);
    assert.equal(writes.length, 0);
  });

  it('skips option-leg signal trades — underlying close is not the order mark', async () => {
    const { deps, writes } = makeDeps({
      listOpenSignalTrades: async () => [optionSignalTrade()],
    });
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.equal(summary.stamped, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(writes.length, 0);
  });

  it('skips a trade that left OPEN between listing and write', async () => {
    const { deps, writes } = makeDeps({ markTrade: async () => false });
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.equal(summary.stamped, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(writes.length, 0);
  });

  it('skips a leg-less trade rather than stamping', async () => {
    const { deps, writes } = makeDeps({
      listOpenSignalTrades: async () => [shareSignalTrade({ legs: [] })],
    });
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.equal(summary.stamped, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(writes.length, 0);
  });

  it('records a per-trade error when the write throws', async () => {
    const { deps } = makeDeps({
      markTrade: async () => {
        throw new Error('txn conflict');
      },
    });
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.equal(summary.stamped, 0);
    assert.equal(summary.errors.length, 1);
    assert.match(summary.errors[0].error, /txn conflict/);
  });

  it('no open signal trades → empty summary', async () => {
    const { deps } = makeDeps({ listOpenSignalTrades: async () => [] });
    const summary = await runSignalEodClosePass(MARKET_DATE, deps);

    assert.deepEqual(
      { stamped: summary.stamped, skipped: summary.skipped, skippedNoClose: summary.skippedNoClose, errors: summary.errors },
      { stamped: 0, skipped: 0, skippedNoClose: 0, errors: [] },
    );
  });
});

describe('runSettlementForAllInstances — eod-close ordering', () => {
  it('stamps EOD closes before the exit eval pass', async () => {
    const order: string[] = [];
    await runSettlementForAllInstances(
      MARKET_DATE,
      async () => [], // no instances
      undefined,      // settlementPass — never called with zero instances
      undefined,      // heldSharesPass
      undefined,      // statsPass
      undefined,      // statsDepsFactory
      async () => {
        order.push('eval');
        return {
          evaluated: 0,
          skipsNoMark: 0,
          governingCloses: 0,
          shadowExits: 0,
          stateUpdates: 0,
          errors: [],
        };
      },
      async () => {
        order.push('paper-stats');
        return { scopesWritten: [], errors: [] };
      },
      async () => {
        order.push('signal-settlement');
        return { marketDate: MARKET_DATE, settled: 0, skipped: 0, errors: [] };
      },
      async () => {
        order.push('eod-close');
        return {
          marketDate: MARKET_DATE,
          stamped: 0,
          skipped: 0,
          skippedNoClose: 0,
          errors: [],
        };
      },
    );
    assert.deepEqual(order, ['eod-close', 'eval', 'signal-settlement', 'paper-stats']);
  });
});
