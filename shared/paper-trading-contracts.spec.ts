/**
 * Tests for paper-trading shared contracts — kind discrimination and
 * lifecycle shapes (Blueprint #557 / task #560).
 */

import {
  PaperTradingKind,
  PaperTradeStatus,
  PaperTradeSource,
  isPaperAccount,
  isPaperTrade,
  isPaperCohort,
  isPaperStats,
  isRawQuoteDoc,
  type PaperTradingDoc,
  type PaperAccount,
  type PaperTrade,
  type PaperCohort,
  type PaperStats,
  type RawQuoteDoc,
  type PaperTradeLeg,
  type VariantRun,
  type ExitVariantParams,
  isPaperStrategyInstance,
} from './paper-trading-contracts';
import { OptionType, OptionQuoteSource, StrategyFrequency } from './options-common';
import { TradeSide } from './common';
import { LifecycleState } from './options-strategy-engine-contracts';
import type { PaperStrategyInstance } from './paper-trading-contracts';

const NOW = '2026-09-24T19:00:00Z';

function base<K extends PaperTradingKind>(kind: K, id: string) {
  return { kind, id, createdAt: NOW, updatedAt: NOW };
}

describe('paper-trading kind guards', () => {
  const account: PaperAccount = {
    ...base(PaperTradingKind.ACCOUNT, 'acct-u1'),
    userId: 'u1', cash: 100_000, equity: 100_000, realizedPnl: 0, openTradeCount: 0,
  };

  const trade: PaperTrade = {
    ...base(PaperTradingKind.TRADE, '260924-sig-QQQ-EQ'),
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.SIGNAL,
    signalId: 'sig-1',
    cohortId: 'cohort-260924-QQQ-01',
    symbol: 'QQQ',
    expression: 'EQ',
    governingVariant: 'trailing-20',
    ticket: { signalId: 'sig-1', refId: 'ref-1', acceptedAt: NOW },
    order: { side: TradeSide.LONG, type: 'MARKET', quantity: 100 },
    fills: [{
      fillId: 'f1', role: 'entry', date: '2026-09-24', price: 590,
      quantity: 100, quoteSource: OptionQuoteSource.RH_MCP,
    }],
    legs: [{ kind: 'share', side: TradeSide.LONG, quantity: 100, multiplier: 1, entryMark: 590, lastMark: 590 }],
    marks: { '2026-09-24': { mark: 590, underlyingClose: 590 } },
    variantRuns: [{
      variantKey: 'trailing-20', governing: true, state: 'ACTIVE',
      workingState: { highWaterMark: 590 },
    }],
    realizedPnl: 0,
    unrealizedPnl: 0,
  };

  const cohort: PaperCohort = {
    ...base(PaperTradingKind.COHORT, 'cohort-260924-QQQ-01'),
    signalId: 'sig-1', symbol: 'QQQ', direction: TradeSide.LONG,
    acceptedAt: NOW, tradeIds: [trade.id], expressionTemplates: ['BCS-015-40'],
  };

  const stats: PaperStats = {
    ...base(PaperTradingKind.STATS, 'stats-all'),
    scope: 'all', totalRealizedPnl: 0, totalUnrealizedPnl: 0,
    openTradeCount: 1, closedTradeCount: 0, maxDrawdown: 0,
    equityCurve: [{ date: '2026-09-24', cumulativePnl: 0 }],
  };

  const raw: RawQuoteDoc = {
    ...base(PaperTradingKind.RAW_QUOTE, 'rq-260924-sig-QQQ-EQ-260924'),
    tradeId: trade.id, date: '2026-09-24', rawResponse: { bid: 1, ask: 2 },
  };

  const docs: PaperTradingDoc[] = [account, trade, cohort, stats, raw];

  it('every record carries a kind', () => {
    for (const d of docs) expect(d.kind).toBeTruthy();
  });

  it('each guard accepts its own kind and rejects the others', () => {
    expect(docs.filter(isPaperAccount)).toEqual([account]);
    expect(docs.filter(isPaperTrade)).toEqual([trade]);
    expect(docs.filter(isPaperCohort)).toEqual([cohort]);
    expect(docs.filter(isPaperStats)).toEqual([stats]);
    expect(docs.filter(isRawQuoteDoc)).toEqual([raw]);
  });
});

describe('PaperTrade lifecycle shapes', () => {
  it('an option leg carries contract identity; a share leg cannot', () => {
    const optionLeg: PaperTradeLeg = {
      kind: 'option',
      contractID: 'QQQ251120P00580000',
      type: OptionType.PUT, strike: 580, expiration: '2025-11-20',
      side: TradeSide.SHORT, quantity: 1, multiplier: 100,
      entryMark: 2.1, lastMark: 1.9,
    };
    const shareLeg: PaperTradeLeg = {
      kind: 'share',
      side: TradeSide.LONG, quantity: 100, multiplier: 1,
      entryMark: 590, lastMark: 590,
    };
    expect(optionLeg.kind === 'option' && optionLeg.contractID).toBeTruthy();
    expect(shareLeg.kind === 'share' && !('contractID' in shareLeg)).toBe(true);
  });

  it('a shadow variant run records an exit event without touching the trade', () => {
    const run: VariantRun = {
      variantKey: 'time-30d', governing: false, state: 'EXITED',
      workingState: {},
      exitEvent: { date: '2026-10-24', price: 620, pnl: 3000, daysHeld: 30 },
    };
    expect(run.exitEvent?.daysHeld).toBe(30);
    expect(run.governing).toBe(false);
  });
});

describe('PaperStrategyInstance', () => {
  it('carries the existing instance config plus kind + account link', () => {
    const inst: PaperStrategyInstance = {
      kind: PaperTradingKind.INSTANCE,
      id: '260924-QQQM-CSP-020-30-D-1200',
      symbol: 'QQQM',
      optionType: OptionType.PUT,
      side: TradeSide.SHORT,
      phases: [],
      frequency: StrategyFrequency.DAILY,
      openTimePT: '12:00',
      exitPolicies: [],
      lifecycleState: LifecycleState.ACTIVE,
      userId: 'u1',
      createdAt: NOW,
      updatedAt: NOW,
      paperAccountId: 'acct-u1',
      governingVariant: 'trailing-20',
    };
    expect(inst.paperAccountId).toBe('acct-u1');
    expect(isPaperStrategyInstance(inst)).toBe(true);
  });
});

describe('ExitVariantParams', () => {
  it('serializes and round-trips every variant kind', () => {
    const variants: ExitVariantParams[] = [
      { type: 'initial-stop', pct: 10 },
      { type: 'trailing-stop', pct: 20 },
      { type: 'time-stop', days: 30 },
      { type: 'limit-stddev', sdMultiplier: 1 },
    ];
    for (const v of variants) {
      expect(JSON.parse(JSON.stringify(v)) as ExitVariantParams).toEqual(v);
    }
  });
});
