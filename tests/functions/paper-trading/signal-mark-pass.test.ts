/**
 * @topic #553 — Paper Trading Infra (task #676)
 *
 * signal-mark-pass: marks OPEN signal-source trades nightly so a governing
 * trailing-stop run has a fresh `marks[ptDate].mark` to evaluate. Option
 * legs resolve through the option quote provider; share legs through the
 * equity quote tool — same plumbing as `netExitPrice` (close path).
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
  runSignalMarkPass,
  type SignalMarkPassDeps,
} from '../../../functions/src/paper-trading/passes/signal-mark-pass';

const NOW = new Date('2026-09-30T19:30:00.000Z'); // 12:30 PT
const PT_DATE = '2026-09-30';

function signalTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260930-sig-QQQM-CSP',
    status: PaperTradeStatus.OPEN,
    userId: 'user1',
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    fills: [
      {
        fillId: 'entry-1',
        role: 'entry',
        date: '2026-09-29',
        price: 2.8,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [
      {
        kind: 'option',
        contractID: 'QQQM261106P00580000',
        type: OptionType.PUT,
        strike: 580,
        expiration: '2026-11-06',
        side: TradeSide.SHORT,
        quantity: 1,
        multiplier: 100,
        entryMark: 2.8,
        lastMark: 2.8,
      },
    ],
    marks: { '2026-09-29': { mark: 2.8 } },
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<SignalMarkPassDeps> = {}) {
  const marks: { tradeId: string; update: unknown; rawQuote: unknown }[] = [];
  const deps: SignalMarkPassDeps = {
    listOpenSignalTrades: overrides.listOpenSignalTrades ?? (async () => [signalTrade()]),
    netMark:
      overrides.netMark ??
      (async () => ({
        mark: 2.1,
        legs: [{ contractID: 'QQQM261106P00580000', mark: 2.1 }],
      })),
    markTrade: async (tradeId, update, rawQuote) => {
      marks.push({ tradeId, update, rawQuote });
      return true;
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, marks };
}

describe('runSignalMarkPass', () => {
  it('marks an OPEN signal trade under the PT market-date key with live quote', async () => {
    const { deps, marks } = makeDeps();
    const summary = await runSignalMarkPass(deps);

    assert.equal(summary.marked, 1);
    assert.equal(summary.errors.length, 0);
    assert.equal(marks.length, 1);

    const [m] = marks;
    assert.equal(m.tradeId, '260930-sig-QQQM-CSP');
    const update = m.update as { mark: number; unrealizedPnl: number };
    assert.equal(update.mark, 2.1);
    // SHORT 1×100: entry 2.80 → mark 2.10 → +$70 unrealized.
    assert.ok(Math.abs(update.unrealizedPnl - 70) < 1e-9);
    const rawQuote = m.rawQuote as { date: string };
    assert.equal(rawQuote.date, PT_DATE);
  });

  it('skips a trade whose mark is unavailable — no write, counted', async () => {
    const { deps, marks } = makeDeps({ netMark: async () => undefined });
    const summary = await runSignalMarkPass(deps);
    assert.equal(summary.marked, 0);
    assert.equal(summary.skipped, 1);
    assert.equal(marks.length, 0, 'no mark write on quote miss');
  });

  it('marks a share-leg signal trade with the equity price', async () => {
    const equity = signalTrade({
      id: '260930-sig-QQQ-EQ',
      expression: 'EQ',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 5 },
      fills: [
        {
          fillId: 'entry-1',
          role: 'entry',
          date: '2026-09-29',
          price: 100,
          quantity: 5,
          quoteSource: OptionQuoteSource.RH_MCP,
        },
      ],
      legs: [
        {
          kind: 'share',
          side: TradeSide.LONG,
          quantity: 5,
          multiplier: 1,
          entryMark: 100,
          lastMark: 100,
        },
      ],
    });
    const { deps, marks } = makeDeps({
      listOpenSignalTrades: async () => [equity],
      netMark: async () => ({ mark: 103, legs: [{ symbol: 'QQQ', mark: 103 }] }),
    });
    const summary = await runSignalMarkPass(deps);
    assert.equal(summary.marked, 1);
    const update = marks[0].update as { mark: number; unrealizedPnl: number };
    assert.equal(update.mark, 103);
    // LONG 5×1: entry $100 → mark $103 → +$15.
    assert.ok(Math.abs(update.unrealizedPnl - 15) < 1e-9);
  });

  it('normalizes a post-UTC-midnight mark to the PT market date', async () => {
    // 02:00 UTC = 19:00 PT on the previous day.
    const lateNow = new Date('2026-10-01T02:00:00.000Z');
    const { deps, marks } = makeDeps({ now: () => lateNow });
    await runSignalMarkPass(deps);
    const rawQuote = marks[0].rawQuote as { date: string };
    assert.equal(rawQuote.date, '2026-09-30');
  });

  it('a quote-miss skip is counted per trade and does not abort the pass', async () => {
    const good = signalTrade();
    const bad = signalTrade({ id: 'bad-trade' });
    const { deps, marks } = makeDeps({
      listOpenSignalTrades: async () => [bad, good],
      netMark: async (t) =>
        t.id === 'bad-trade' ? undefined : { mark: 2.1, legs: [] },
    });
    const summary = await runSignalMarkPass(deps);
    assert.equal(summary.marked, 1);
    assert.equal(summary.skipped, 1);
    assert.deepEqual(summary.skippedTradeIds, ['bad-trade']);
    assert.equal(marks.length, 1);
    assert.equal(marks[0].tradeId, '260930-sig-QQQM-CSP');
  });

  it('a thrown per-trade failure lands in errors[] and does not abort', async () => {
    const good = signalTrade();
    const bad = signalTrade({ id: 'bad-trade' });
    const { deps, marks } = makeDeps({
      listOpenSignalTrades: async () => [bad, good],
      netMark: async (t) => {
        if (t.id === 'bad-trade') throw new Error('provider boom');
        return { mark: 2.1, legs: [] };
      },
    });
    const summary = await runSignalMarkPass(deps);
    assert.equal(summary.marked, 1);
    assert.equal(summary.skipped, 0);
    assert.deepEqual(summary.errors, [
      { tradeId: 'bad-trade', error: 'provider boom' },
    ]);
    assert.equal(marks.length, 1);
  });

  it('skips a leg-less trade instead of writing a fabricated mark=0', async () => {
    const legless = signalTrade({ legs: [] });
    const { deps, marks } = makeDeps({
      listOpenSignalTrades: async () => [legless],
    });
    const summary = await runSignalMarkPass(deps);
    assert.equal(summary.marked, 0);
    assert.deepEqual(summary.skippedTradeIds, [legless.id]);
    assert.equal(marks.length, 0);
  });

  it('records an expired option leg as an error, not a skip', async () => {
    const expired = signalTrade({
      id: 'expired-trade',
      legs: [
        {
          kind: 'option',
          contractID: 'QQZM260918P00580000',
          type: OptionType.PUT,
          strike: 580,
          expiration: '2026-09-18', // < markDate
          side: TradeSide.SHORT,
          quantity: 1,
          multiplier: 100,
          entryMark: 2.8,
          lastMark: 2.8,
        },
      ],
    });
    const { deps, marks } = makeDeps({
      listOpenSignalTrades: async () => [expired],
    });
    const summary = await runSignalMarkPass(deps);
    assert.equal(summary.marked, 0);
    assert.equal(summary.skipped, 0);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].tradeId, 'expired-trade');
    assert.match(summary.errors[0].error, /expired/);
    assert.equal(marks.length, 0);
  });
});
