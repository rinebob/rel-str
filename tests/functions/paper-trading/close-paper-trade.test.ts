/**
 * @topic #553 — Paper Trading Infra (task #667)
 *
 * closePaperTrade callable: closes an OPEN paper trade at a live RH quote
 * (no stored-mark fallback, no user-entered price). Per-leg marks net to an
 * order-level exit price signed so the ledger's cashDelta equals the
 * position's liquidation value; the governing run finalizes EXITED with
 * its exitEvent in the same handler.
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
  type PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import {
  handleClosePaperTrade,
  type ClosePaperTradeDeps,
} from '../../../functions/src/paper-trading/callables';
import type { ExitFillInput, ApplyFillResult } from '../../../functions/src/paper-trading/ledger';
import type { VariantRun } from '../../../shared/paper-trading-contracts';

const NOW = new Date('2026-09-28T17:00:00.000Z'); // PT market date 2026-09-28

const EQUITY_QUOTE = {
  data: { results: [{ quote: { symbol: 'QQQM', last_trade_price: '612.40' } }] },
};

function optionLeg(overrides: Partial<PaperTradeLeg> = {}): PaperTradeLeg {
  return {
    kind: 'option',
    contractID: 'QQQM251120P00570000',
    type: OptionType.PUT,
    strike: 570,
    expiration: '2026-11-20',
    side: TradeSide.SHORT,
    quantity: 1,
    multiplier: 100,
    entryMark: 2.1,
    lastMark: 2.1,
    ...overrides,
  };
}

function shareLeg(): PaperTradeLeg {
  return {
    kind: 'share',
    side: TradeSide.LONG,
    quantity: 100,
    multiplier: 1,
    entryMark: 590,
    lastMark: 595,
  };
}

function openTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: '260928-sig-QQQM-EQ',
    status: PaperTradeStatus.OPEN,
    userId: 'user1',
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'EQ',
    governingVariant: 'trailing-8',
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
    fills: [
      { fillId: 'e1', role: 'entry', date: '2026-09-25', price: 590, quantity: 100,
        quoteSource: OptionQuoteSource.RH_MCP },
    ],
    legs: [shareLeg()],
    marks: {},
    variantRuns: [
      { variantKey: 'trailing-8', governing: true, state: 'ACTIVE', workingState: {} },
    ],
    variantKeys: ['trailing-8'],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ClosePaperTradeDeps> = {}, trade = openTrade()) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const exits: ExitFillInput[] = [];
  const runUpdates: { tradeId: string; run: VariantRun }[] = [];

  const deps: ClosePaperTradeDeps = {
    getTrade: overrides.getTrade ?? (async () => trade),
    getOptionQuotes:
      overrides.getOptionQuotes ??
      (async () => [{ contractID: 'QQQM251120P00570000', mark: 1.55 }]),
    callTool:
      overrides.callTool ??
      (async (name, args) => {
        calls.push({ name, args });
        return EQUITY_QUOTE;
      }),
    applyExitFill: async (input) => {
      exits.push(input);
      // Mirror the ledger's realized P&L so response assertions exercise
      // the real wiring, not a canned value.
      const entry = trade.fills.find((f) => f.role === 'entry');
      const mult = Math.max(...trade.legs.map((l) => l.multiplier), 1);
      const dir = trade.order.side === TradeSide.SHORT ? -1 : 1;
      const realizedPnl =
        (input.fill.price - (entry?.price ?? 0)) * input.fill.quantity * mult * dir;
      return {
        trade: {
          ...trade,
          status: PaperTradeStatus.CLOSED,
          fills: [...trade.fills, input.fill],
          realizedPnl,
        },
        cashDelta: 0,
      } as ApplyFillResult;
    },
    updateRun: async (tradeId, run) => {
      runUpdates.push({ tradeId, run });
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls, exits, runUpdates };
}

const authed = { auth: { uid: 'user1' }, data: { tradeId: '260928-sig-QQQM-EQ' } };

async function expectHttpsError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.equal((err as { code?: string }).code, code);
    return true;
  });
}

describe('handleClosePaperTrade', () => {
  it('closes an OPEN equity trade at the live RH quote and finalizes the governing run', async () => {
    const { deps, calls, exits, runUpdates } = makeDeps();
    const res = await handleClosePaperTrade(authed, deps);

    assert.equal(res.tradeId, '260928-sig-QQQM-EQ');
    assert.ok(Math.abs(res.exitPrice - 612.4) < 1e-9);
    // LONG 100 shares bought at 590 → +2240
    assert.ok(Math.abs(res.realizedPnl - 2240) < 1e-9);

    // only read-only quote tools
    assert.equal(calls.length, 1);
    assert.match(calls[0].name, /get_equity_quotes$/);

    const exit = exits[0];
    assert.equal(exit.fill.role, 'exit');
    assert.equal(exit.fill.price, 612.4);
    assert.equal(exit.fill.quantity, 100);
    assert.equal(exit.fill.date, '2026-09-28'); // PT market date
    assert.equal(exit.fill.quoteSource, OptionQuoteSource.RH_MCP);

    assert.equal(runUpdates.length, 1);
    const run = runUpdates[0].run;
    assert.equal(run.state, 'EXITED');
    assert.ok(Math.abs((run.exitEvent?.price ?? 0) - 612.4) < 1e-9);
    assert.ok(Math.abs((run.exitEvent?.pnl ?? 0) - 2240) < 1e-9);
    assert.equal(run.exitEvent?.daysHeld, 3); // 09-25 → 09-28
  });

  it('closes an option trade at the option mark (short entry → signed exit price)', async () => {
    const trade = openTrade({
      legs: [optionLeg()],
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
      fills: [
        { fillId: 'e1', role: 'entry', date: '2026-09-25', price: 2.1, quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP },
      ],
    });
    const { deps, exits, runUpdates } = makeDeps({}, trade);
    const res = await handleClosePaperTrade(authed, deps);

    // short put bought back at 1.55 → exit fill price is the mark itself
    assert.ok(Math.abs(exits[0].fill.price - 1.55) < 1e-9);
    assert.ok(Math.abs(res.realizedPnl - 55) < 1e-9); // (2.10 − 1.55) × 100
    assert.equal(runUpdates[0].run.state, 'EXITED');
  });

  it('nets a multi-leg spread to one unit price', async () => {
    const trade = openTrade({
      legs: [
        optionLeg(), // short 570p
        optionLeg({ contractID: 'QQQM251120P00550000', side: TradeSide.LONG, strike: 550 }),
      ],
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    });
    const { deps, exits } = makeDeps(
      {
        getOptionQuotes: async (ids) => [
          { contractID: 'QQQM251120P00570000', mark: 1.55 },
          { contractID: 'QQQM251120P00550000', mark: 0.55 },
        ],
      },
      trade,
    );
    await handleClosePaperTrade(authed, deps);
    // buyback cost = 1.55 − 0.55 = 1.00 debit per share → fill.price = 1.00
    assert.equal(exits[0].fill.price, 1);
    assert.equal(exits[0].fill.quantity, 1);
  });

  it('unavailable when the equity quote is missing — no ledger write', async () => {
    const { deps, exits, runUpdates } = makeDeps({
      callTool: async () => ({ data: { results: [] } }),
    });
    await expectHttpsError(handleClosePaperTrade(authed, deps), 'unavailable');
    assert.equal(exits.length, 0);
    assert.equal(runUpdates.length, 0);
  });

  it('unavailable when the option provider throws (quote miss is not internal)', async () => {
    const trade = openTrade({
      legs: [optionLeg()],
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    });
    const { deps, exits } = makeDeps(
      {
        getOptionQuotes: async () => {
          throw new Error('RH MCP quote provider: missing quote for QQQM251120P00570000');
        },
      },
      trade,
    );
    await expectHttpsError(handleClosePaperTrade(authed, deps), 'unavailable');
    assert.equal(exits.length, 0);
  });

  it('a failed run-finalize does not hide a committed close', async () => {
    const { deps } = makeDeps({
      updateRun: async () => {
        throw new Error('transient write failure');
      },
    });
    const res = await handleClosePaperTrade(authed, deps);
    assert.equal(res.tradeId, '260928-sig-QQQM-EQ');
  });

  it('unavailable when an option leg has no quote', async () => {
    const trade = openTrade({
      legs: [optionLeg()],
      order: { side: TradeSide.SHORT, type: 'MARKET', quantity: 1 },
    });
    const { deps, exits } = makeDeps(
      { getOptionQuotes: async () => [{ contractID: 'QQQM251120P00570000', mark: NaN }] },
      trade,
    );
    await expectHttpsError(handleClosePaperTrade(authed, deps), 'unavailable');
    assert.equal(exits.length, 0);
  });

  it('unavailable when the equity quote call throws (same class as option miss)', async () => {
    const { deps, exits } = makeDeps({
      callTool: async () => {
        throw new Error('MCP session dead');
      },
    });
    await expectHttpsError(handleClosePaperTrade(authed, deps), 'unavailable');
    assert.equal(exits.length, 0);
  });

  it('requires auth + valid tradeId', async () => {
    const { deps, exits } = makeDeps();
    await expectHttpsError(handleClosePaperTrade({ data: { tradeId: 'x' } }, deps), 'unauthenticated');
    await expectHttpsError(
      handleClosePaperTrade({ auth: { uid: 'u' }, data: {} }, deps),
      'invalid-argument',
    );
    assert.equal(exits.length, 0);
  });

  it('not-found for a missing trade', async () => {
    const { deps } = makeDeps({ getTrade: async () => null });
    await expectHttpsError(handleClosePaperTrade(authed, deps), 'not-found');
  });

  it('permission-denied for another user or an ownerless trade (fail closed)', async () => {
    for (const t of [openTrade({ userId: 'other' }), openTrade({ userId: undefined })]) {
      const { deps, exits } = makeDeps({ getTrade: async () => t });
      await expectHttpsError(handleClosePaperTrade(authed, deps), 'permission-denied');
      assert.equal(exits.length, 0);
    }
  });

  it('failed-precondition for non-OPEN trades', async () => {
    for (const status of [
      PaperTradeStatus.PENDING,
      PaperTradeStatus.CLOSED,
      PaperTradeStatus.CANCELLED,
      PaperTradeStatus.EXPIRED,
      PaperTradeStatus.ASSIGNED,
    ]) {
      const { deps, exits } = makeDeps({ getTrade: async () => openTrade({ status }) });
      await expectHttpsError(handleClosePaperTrade(authed, deps), 'failed-precondition');
      assert.equal(exits.length, 0);
    }
  });

  it('maps a ledger not-open rejection to failed-precondition (concurrent close race)', async () => {
    const { deps } = makeDeps({
      applyExitFill: async () => {
        throw new Error('paper trade x is not open (status CLOSED)');
      },
    });
    await expectHttpsError(handleClosePaperTrade(authed, deps), 'failed-precondition');
  });
});
