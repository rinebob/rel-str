/**
 *
 * Unit tests for the settlement pass (#1714): position-grain sweep over all
 * OPEN option-leg trades — no instance enumeration, so legacy zombie docs
 * and trades on STOPPED instances settle alongside manage positions. Signal
 * trades are excluded (signalSettlementPass owns them — disjoint).
 *
 * A position settles when its LAST option leg expires on or before the run
 * date (missed nights retry — #724). Each leg's outcome is decided at its
 * OWN expiration-day close (walking back over weekends/holidays, never
 * before the leg's open): ITM → ASSIGNED, OTM/ATM → EXPIRED_WORTHLESS.
 * Net share delivery across assigned legs decides the position outcome:
 * net long shares → ASSIGNED_HOLDING_SHARES at the cash-weighted basis;
 * flat → EXPIRED_WORTHLESS; net short (uncovered call assignment) → error,
 * shares the paper model can't hold.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSettlementPass } from '../../../functions/src/options-strategy-engine/passes/settlement-pass';
import type {
  SettlementPassDependencies,
} from '../../../functions/src/options-strategy-engine/passes/settlement-pass';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type PaperTradeLeg,
} from '../../../shared/paper-trading-contracts';
import type { DailyUpdate, SettlementData, LegOutcomeUpdate } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';

type OptionLeg = Extract<PaperTradeLeg, { kind: 'option' }>;

function makeOptionLeg(overrides: Partial<OptionLeg> = {}): OptionLeg {
  return {
    kind: 'option',
    id: 'PUT-100.00-2025-08-17',
    side: TradeSide.SHORT,
    quantity: 1,
    multiplier: 100,
    entryMark: 0.5,
    lastMark: 0.4,
    contractID: 'SPY250817P00100000',
    type: OptionType.PUT,
    strike: 100,
    expiration: '2025-08-17',
    openDate: '2025-08-15',
    ...overrides,
  };
}

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 'inst-1-2025-08-15',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    strategyInstanceId: 'inst-1',
    symbol: 'SPY',
    expression: 'CSP',
    governingVariant: 'hold-exp',
    order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1, limitPrice: 0.5 },
    fills: [
      {
        fillId: 'f-1',
        role: 'entry',
        date: '2025-08-15',
        price: 0.5,
        quantity: 1,
        quoteSource: OptionQuoteSource.RH_MCP,
      },
    ],
    legs: [makeOptionLeg()],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 10,
    createdAt: '2025-08-15T00:00:00Z',
    updatedAt: '2025-08-16T18:00:00Z',
    ...overrides,
  };
}

interface SettlementCall {
  positionId: string;
  settlement: SettlementData;
  legOutcomes: LegOutcomeUpdate[];
  dailyUpdate?: DailyUpdate;
}

function makeSettlementDeps(overrides: {
  listOpenOptionTrades?: () => Promise<PaperTrade[]>;
  getUnderlyingClose?: (symbol: string, date: string) => Promise<number | null>;
  checkBrokerageOutcome?: ((position: unknown, leg: unknown) => Promise<{ assigned: boolean; contractsQuantity?: number }>) | null;
  markPositionSettled?: (
    positionId: string,
    settlement: SettlementData,
    legOutcomes: LegOutcomeUpdate[],
    dailyUpdate?: DailyUpdate,
  ) => Promise<void>;
} = {}): SettlementPassDependencies & {
  settleCalls: SettlementCall[];
} {
  const settleCalls: SettlementCall[] = [];
  return {
    listOpenOptionTrades:
      overrides.listOpenOptionTrades ?? (async () => [makeTrade()]),
    getUnderlyingClose:
      overrides.getUnderlyingClose ?? (async () => 98),
    // `null` explicitly omits the checker (the prod shape — orchestrator
    // never injects it); `undefined` falls back to the default stub.
    checkBrokerageOutcome:
      overrides.checkBrokerageOutcome === null
        ? undefined
        : (overrides.checkBrokerageOutcome ?? (async () => ({ assigned: false }))),
    markPositionSettled:
      overrides.markPositionSettled ??
      (async (
        positionId: string,
        settlement: SettlementData,
        legOutcomes: LegOutcomeUpdate[],
        dailyUpdate?: DailyUpdate,
      ) => {
        settleCalls.push({ positionId, settlement, legOutcomes, dailyUpdate });
      }),
    settleCalls,
  };
}

describe('runSettlementPass', () => {
  it('returns empty result when no open option trades', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [],
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.date, '2025-08-17');
    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('settles as EXPIRED_WORTHLESS when brokerage reports no assignment', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '2025-08-17', strike: 100 })] }),
      ],
      getUnderlyingClose: async () => 100,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);

    const settled = result.settled[0];
    assert.equal(settled.positionId, 'inst-1-2025-08-15');
    assert.equal(settled.outcome, 'EXPIRED_WORTHLESS');
    assert.equal(settled.underlyingClose, 100);
    assert.equal(settled.currentValue, 0);
    assert.equal(settled.unrealizedPnl, 50); // full premium retained

    assert.equal(deps.settleCalls.length, 1);
    const call = deps.settleCalls[0];
    assert.equal(call.positionId, 'inst-1-2025-08-15');
    assert.equal(call.settlement.status, 'EXPIRED_WORTHLESS');
    assert.equal(call.settlement.currentValue, 0);
    assert.equal(call.settlement.unrealizedPnl, 50);
    assert.equal(call.settlement.assignment, undefined);
    assert.equal(call.settlement.shares, undefined);
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
    ]);
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 100 });
  });

  it('settles as ASSIGNED_HOLDING_SHARES when brokerage reports assignment', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '2025-08-17', strike: 100 })] }),
      ],
      getUnderlyingClose: async () => 98,
      checkBrokerageOutcome: async () => ({ assigned: true, contractsQuantity: 1 }),
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);

    const settled = result.settled[0];
    assert.equal(settled.outcome, 'ASSIGNED_HOLDING_SHARES');
    assert.equal(settled.underlyingClose, 98);
    assert.equal(settled.currentValue, 9800); // 98 * 100 * 1
    assert.equal(settled.unrealizedPnl, -200); // (98 - 100) * 100 * 1

    assert.equal(deps.settleCalls.length, 1);
    const call = deps.settleCalls[0];
    assert.equal(call.settlement.status, 'ASSIGNED_HOLDING_SHARES');
    assert.equal(call.settlement.currentValue, 9800);
    assert.equal(call.settlement.unrealizedPnl, -200);
    assert.deepEqual(call.settlement.assignment, {
      strikePrice: 100,
      underlyingCloseAtExpiration: 98,
      assignedAt: '2025-08-17',
    });
    assert.deepEqual(call.settlement.shares, { quantity: 1, costBasis: 100 });
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
    ]);
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 98 });
  });

  it('errors when underlying closing bar is missing', async () => {
    const deps = makeSettlementDeps({
      getUnderlyingClose: async () => null,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('No underlying closing bar'));
  });

  it('skips positions whose last leg has not expired', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '2025-08-20' })] }),
      ],
      getUnderlyingClose: async () => 100,
      checkBrokerageOutcome: async () => ({ assigned: false }),
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(result.skippedNotExpired, 1);
  });

  it('settles a position whose expiration already passed (missed night)', async () => {
    // #724: strict === made a skipped/mismatched run date leave the trade
    // OPEN forever. Expired on 8-17, running on 8-19 must still settle —
    // priced at the EXPIRATION-day close, not the run date.
    const deps = makeSettlementDeps({
      getUnderlyingClose: async (_s, d) => (d === '2025-08-17' ? 100 : null),
    });

    const result = await runSettlementPass('2025-08-19', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);
    const call = deps.settleCalls[0];
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
    ]);
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-17', underlyingClose: 100 });
  });

  it('settles a weekend expiration at the prior trading-day close', async () => {
    // 2025-08-17 is a Sunday — no bar; the walk-back must reach Friday
    // 8-15's close and date the settlement to it.
    const deps = makeSettlementDeps({
      getUnderlyingClose: async (_s, d) => (d === '2025-08-15' ? 98 : null),
    });

    const result = await runSettlementPass('2025-08-18', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);
    const call = deps.settleCalls[0];
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-15', underlyingClose: 98 });
    assert.equal(call.legOutcomes[0].closeDate, '2025-08-15');
    assert.equal(call.settlement.assignment, undefined);
  });

  it('never settles on a close predating the position open', async () => {
    // Position opened 8-15; the only bar in the walk-back window is 8-14 —
    // a pre-entry close is a stale basis, so the position stays an error.
    const deps = makeSettlementDeps({
      getUnderlyingClose: async (_s, d) => (d === '2025-08-14' ? 98 : null),
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('No underlying closing bar'));
  });

  it('settles an OTM leg worthless when no brokerage checker is wired', async () => {
    // Prod shape: the orchestrator never injects checkBrokerageOutcome.
    // OTM (close 102 > strike 100) → worthless is honest regardless.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '2025-08-17', strike: 100 })] }),
      ],
      getUnderlyingClose: async () => 102,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.settled[0].outcome, 'EXPIRED_WORTHLESS');
  });

  it('settles an ITM put as ASSIGNED_HOLDING_SHARES when no checker is wired', async () => {
    // #728: prod wires no checker, so the outcome is computed locally —
    // close 98 < strike 100 → ITM short put assigns shares at strike.
    // Deterministic in the paper model; a wired checker would override.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '2025-08-17', strike: 100 })] }),
      ],
      getUnderlyingClose: async () => 98,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.settled[0].outcome, 'ASSIGNED_HOLDING_SHARES');

    const call = deps.settleCalls[0];
    assert.equal(call.settlement.status, 'ASSIGNED_HOLDING_SHARES');
    assert.equal(call.settlement.currentValue, 9800);
    assert.equal(call.settlement.unrealizedPnl, -200);
    assert.deepEqual(call.settlement.assignment, {
      strikePrice: 100,
      underlyingCloseAtExpiration: 98,
      assignedAt: '2025-08-17',
    });
    assert.deepEqual(call.settlement.shares, { quantity: 1, costBasis: 100 });
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
    ]);
    // Strike cash delivered + intrinsic per unit — the ledger books the
    // real cash debit and the variant run exits at intrinsic, not 0.
    assert.equal(call.settlement.deliveryCash, 100);
    assert.equal(call.settlement.orderExitPrice, 2);
  });

  it('settles an exactly-ATM put worthless when no checker is wired', async () => {
    // Boundary: close == strike is not ITM for a put → expires worthless.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '2025-08-17', strike: 100 })] }),
      ],
      getUnderlyingClose: async () => 100,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.settled[0].outcome, 'EXPIRED_WORTHLESS');
    assert.equal(deps.settleCalls[0].settlement.shares, undefined);
  });

  it('still floors the walk-back at position open when the leg lacks openDate', async () => {
    // Adapter emits openDate '' for migrated docs — falsy, not nullish, so
    // `??` would leave the floor disabled and a pre-open bar could settle
    // the trade. `||` must fall back to pos.openDate.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ openDate: '' })] }),
      ],
      getUnderlyingClose: async (_s, d) => (d === '2025-08-14' ? 98 : null),
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('No underlying closing bar'));
  });

  // ── #1714: position-grain selection ───────────────────────────────────────

  it('settles zombie trades with no strategyInstanceId', async () => {
    // The 260819-* legacy docs carry no instance — position-grain selection
    // must still reach them (the instance-grain loop never could).
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ id: '260819-abc', strategyInstanceId: undefined }),
      ],
      getUnderlyingClose: async () => 102,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].positionId, '260819-abc');
    assert.equal(deps.settleCalls[0].positionId, '260819-abc');
  });

  it('excludes signal-source trades (signalSettlementPass owns them)', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ id: 'sig-1', source: PaperTradeSource.SIGNAL }),
      ],
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(deps.settleCalls.length, 0);
  });

  it('settles positions across instances in one sweep', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ id: 'inst-1-pos', strategyInstanceId: 'inst-1' }),
        makeTrade({ id: 'inst-2-pos', strategyInstanceId: 'inst-2' }),
      ],
      getUnderlyingClose: async () => 102,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 2);
    assert.deepEqual(
      result.settled.map((s) => s.positionId),
      ['inst-1-pos', 'inst-2-pos'],
    );
  });

  // ── #1714: last-leg expiry rule ───────────────────────────────────────────

  it('waits for the LAST leg to expire — earlier expired legs do not settle the position', async () => {
    // Calendar-style split: front leg expired 8-17, back leg lives to 8-22.
    // Running on 8-20 must leave the whole position OPEN.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          legs: [
            makeOptionLeg({ id: 'PUT-100.00-2025-08-17', expiration: '2025-08-17' }),
            makeOptionLeg({
              id: 'PUT-95.00-2025-08-22',
              side: TradeSide.LONG,
              strike: 95,
              expiration: '2025-08-22',
              contractID: 'SPY250822P00095000',
            }),
          ],
        }),
      ],
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-20', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 0);
    assert.equal(result.skippedNotExpired, 1);
    assert.equal(deps.settleCalls.length, 0);
  });

  it('prices each leg at its OWN expiration close when expirations differ', async () => {
    // Same split, run after the back leg expires: leg outcomes date to their
    // own expiration closes, not the run date or each other's.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          legs: [
            makeOptionLeg({ id: 'PUT-100.00-2025-08-17', expiration: '2025-08-17' }),
            makeOptionLeg({
              id: 'PUT-95.00-2025-08-22',
              side: TradeSide.LONG,
              strike: 95,
              expiration: '2025-08-22',
              contractID: 'SPY250822P00095000',
            }),
          ],
        }),
      ],
      // Close 103 on both expiry dates → both legs OTM → worthless.
      getUnderlyingClose: async (_s, d) =>
        d === '2025-08-17' || d === '2025-08-22' ? 103 : null,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-23', deps);

    assert.equal(result.settled.length, 1);
    const call = deps.settleCalls[0];
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
      { legId: 'PUT-95.00-2025-08-22', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-22' },
    ]);
    // Settlement stamp rides the last-expiring leg's close.
    assert.deepEqual(call.dailyUpdate, { date: '2025-08-22', underlyingClose: 103 });
  });

  // ── #1714: multi-leg outcomes + CALL support ─────────────────────────────

  it('settles a put credit spread with only the short leg ITM → shares at the short strike', async () => {
    // Short 100 put + long 95 put; close 97 sits between the strikes —
    // short assigns (+1 contract of shares), long expires worthless.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          expression: 'BPS',
          legs: [
            makeOptionLeg({ id: 'PUT-100.00-2025-08-17', strike: 100 }),
            makeOptionLeg({
              id: 'PUT-95.00-2025-08-17',
              side: TradeSide.LONG,
              strike: 95,
              contractID: 'SPY250817P00095000',
            }),
          ],
        }),
      ],
      getUnderlyingClose: async () => 97,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].outcome, 'ASSIGNED_HOLDING_SHARES');
    const call = deps.settleCalls[0];
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
      { legId: 'PUT-95.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
    ]);
    assert.deepEqual(call.settlement.shares, { quantity: 1, costBasis: 100 });
    assert.equal(call.settlement.assignment?.strikePrice, 100);
  });

  it('expires a fully-ITM put spread flat — offsetting deliveries net to zero', async () => {
    // Close 90 is below both strikes: short assigns +1, long exercises −1 →
    // no shares held. Per-leg outcomes still record both assignments.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          expression: 'BPS',
          legs: [
            makeOptionLeg({ id: 'PUT-100.00-2025-08-17', strike: 100 }),
            makeOptionLeg({
              id: 'PUT-95.00-2025-08-17',
              side: TradeSide.LONG,
              strike: 95,
              contractID: 'SPY250817P00095000',
            }),
          ],
        }),
      ],
      getUnderlyingClose: async () => 90,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].outcome, 'EXPIRED_WORTHLESS');
    const call = deps.settleCalls[0];
    assert.deepEqual(call.legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
      { legId: 'PUT-95.00-2025-08-17', outcome: 'ASSIGNED', closeDate: '2025-08-17' },
    ]);
    assert.equal(call.settlement.shares, undefined);
    assert.equal(call.settlement.assignment, undefined);
    // Offsetting deliveries are not cash-neutral: the account pays the
    // short 100 strike and collects the long 95 → deliveryCash 5 → the
    // ledger books −$500, not 0. And the governing variant run exits at
    // the spread's net intrinsic (5/unit), not a fabricated 0/max-profit.
    assert.equal(call.settlement.deliveryCash, 5);
    assert.equal(call.settlement.orderExitPrice, 5);
  });

  it('settles an OTM short call worthless', async () => {
    // #1714 lifts the PUT-only restriction — a covered-call leg OTM at
    // expiry (close 98 < strike 100) expires worthless like any OTM leg.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          legs: [
            makeOptionLeg({
              id: 'CALL-100.00-2025-08-17',
              type: OptionType.CALL,
              strike: 100,
              contractID: 'SPY250817C00100000',
            }),
          ],
        }),
      ],
      getUnderlyingClose: async () => 98,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].outcome, 'EXPIRED_WORTHLESS');
    assert.deepEqual(deps.settleCalls[0].legOutcomes, [
      { legId: 'CALL-100.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
    ]);
  });

  it('settles an ITM long call to held shares', async () => {
    // Long call ITM (close 110 > strike 100) exercises → +shares at strike.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          order: { side: TradeSide.LONG, type: 'LIMIT', quantity: 1, limitPrice: 2 },
          legs: [
            makeOptionLeg({
              id: 'CALL-100.00-2025-08-17',
              side: TradeSide.LONG,
              type: OptionType.CALL,
              strike: 100,
              contractID: 'SPY250817C00100000',
            }),
          ],
        }),
      ],
      getUnderlyingClose: async () => 110,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].outcome, 'ASSIGNED_HOLDING_SHARES');
    assert.deepEqual(deps.settleCalls[0].settlement.shares, { quantity: 1, costBasis: 100 });
  });

  it('errors on uncovered short-call assignment (net short shares unsupported)', async () => {
    // Short call ITM → shares called away. The option doc holds no share
    // leg to satisfy delivery (synthetic CC lifecycle is future scope) —
    // net-negative delivery is an error, not a silent short position.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          legs: [
            makeOptionLeg({
              id: 'CALL-100.00-2025-08-17',
              type: OptionType.CALL,
              strike: 100,
              contractID: 'SPY250817C00100000',
            }),
          ],
        }),
      ],
      getUnderlyingClose: async () => 110,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('short'));
    assert.equal(deps.settleCalls.length, 0);
  });

  it('records outcomes for legs that carry no contractID', async () => {
    // Legacy zombie docs may lack contractID on legs — outcome math is
    // strike/close-based, so leg resolution must not depend on it.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          legs: [makeOptionLeg({ contractID: undefined })],
        }),
      ],
      getUnderlyingClose: async () => 102,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.deepEqual(deps.settleCalls[0].legOutcomes, [
      { legId: 'PUT-100.00-2025-08-17', outcome: 'EXPIRED_WORTHLESS', closeDate: '2025-08-17' },
    ]);
  });

  it('isolates per-position errors — one failure does not stop the sweep', async () => {
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ id: 'bad-pos', symbol: 'XXX' }),
        makeTrade({ id: 'good-pos' }),
      ],
      // Close exists for SPY only.
      getUnderlyingClose: async (s, d) => (s === 'SPY' && d === '2025-08-17' ? 100 : null),
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].positionId, 'good-pos');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'bad-pos');
  });

  it('isolates adapter failures — a malformed doc does not abort the sweep', async () => {
    // Zombie docs may lack fields the adapter dereferences (order, fills).
    // The failure lands in errors[] keyed by trade.id; good docs settle.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        { ...makeTrade({ id: 'malformed' }), order: undefined as unknown as PaperTrade['order'] },
        makeTrade({ id: 'good-pos' }),
      ],
      getUnderlyingClose: async () => 98,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 1);
    assert.equal(result.settled[0].positionId, 'good-pos');
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'malformed');
  });

  it('errors clearly on a leg with no expiration', async () => {
    // Missing expiration must fail as a malformed-leg error — not a
    // cryptic RangeError out of the date machinery.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({ legs: [makeOptionLeg({ expiration: '' })] }),
      ],
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    assert.equal(result.settled.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('expiration'));
  });

  it('honors leg quantity > 1 in delivery, basis, and exit price', async () => {
    // qty 3 short put ITM: 3 contracts delivered, strike cash ×3, and the
    // per-unit exit price still normalizes to intrinsic (2).
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 3, limitPrice: 0.5 },
          legs: [makeOptionLeg({ quantity: 3 })],
        }),
      ],
      getUnderlyingClose: async () => 98,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    const call = deps.settleCalls[0];
    assert.deepEqual(call.settlement.shares, { quantity: 3, costBasis: 100 });
    assert.equal(call.settlement.deliveryCash, 300);
    assert.equal(call.settlement.orderExitPrice, 2);
    assert.equal(call.settlement.currentValue, 98 * 100 * 3);
    assert.equal(result.settled.length, 1);
  });

  it('books a cash-weighted basis when multiple legs assign at different strikes', async () => {
    // Two short puts 100/110 both ITM at close 90 → 2 contracts delivered,
    // weighted basis (100 + 110) / 2 = 105. Exit price = combined intrinsic
    // (10 + 20) / order qty 1 = 30.
    const deps = makeSettlementDeps({
      listOpenOptionTrades: async () => [
        makeTrade({
          legs: [
            makeOptionLeg({ id: 'PUT-100.00-2025-08-17', strike: 100 }),
            makeOptionLeg({
              id: 'PUT-110.00-2025-08-17',
              strike: 110,
              contractID: 'SPY250817P00110000',
            }),
          ],
        }),
      ],
      getUnderlyingClose: async () => 90,
      checkBrokerageOutcome: null,
    });

    const result = await runSettlementPass('2025-08-17', deps);

    const call = deps.settleCalls[0];
    assert.equal(result.settled[0].outcome, 'ASSIGNED_HOLDING_SHARES');
    assert.deepEqual(call.settlement.shares, { quantity: 2, costBasis: 105 });
    assert.equal(call.settlement.deliveryCash, 210);
    assert.equal(call.settlement.orderExitPrice, 30);
    assert.equal(call.settlement.assignment?.strikePrice, 105);
  });
});
