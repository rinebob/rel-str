/**
 * Tests for paper-trading shared contracts — kind discrimination and
 * lifecycle shapes (Blueprint #557 / task #560).
 */

import {
  PaperTradingKind,
  PaperTradeStatus,
  PaperTradeSource,
  CURATED_VARIANT_KEYS,
  CURATED_GOVERNING_POLICY,
  GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS,
  DELETE_PAPER_TRADES_MAX_ITEMS,
  type GoverningPolicy,
  type SignalPick,
  type GeneratePaperSignalTradesRequest,
  type GeneratePaperSignalTradesResponse,
  type MintResult,
  type DeletePaperTradesRequest,
  type DeletePaperTradesResponse,
  type PaperFill,
  isPaperAccount,
  isPaperTrade,
  isPaperStats,
  isRawQuoteDoc,
  type PaperTradingDoc,
  type PaperAccount,
  type PaperTrade,
  type PaperStats,
  type RawQuoteDoc,
  type PaperTradeLeg,
  type VariantRun,
  type ExitVariantParams,
  isPaperStrategyInstance,
  DEFAULT_TRAILING_STOP_KEY,
  SIGNAL_GOVERNING_VARIANT,
  SIGNAL_SHADOW_VARIANT_KEYS,
  isGoverningEligiblePct,
  TERMINAL_VARIANT_FAMILIES,
  AUTO_PAPER_USER_ID,
  PAPER_TRADE_WRITABLE_STATUSES,
  type ClosePaperTradeRequest,
  type ClosePaperTradeResponse,
  type CancelPaperTradeRequest,
  type CancelPaperTradeResponse,
  signalPickFromReviewOccurrence,
  type SignalReviewOccurrence,
  type SignalReviewStateDoc,
  type SignalReviewQueueRow,
  type GetSignalReviewQueueResponse,
  type GetSignalReviewBundleResponse,
} from './paper-trading-contracts';
import { OptionType, OptionQuoteSource, StrategyFrequency } from './options-common';
import { TradeSide } from './common';
import { buildAccountId, buildTradeId, signalDedupeKey, signalTradeDesc } from './paper-trading-ids';
import { stSignalOccurrenceId } from './st-ids';
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
    positionGroupId: 'QQQ-260924-grp-01',
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
    variantKeys: ['trailing-20'],
    realizedPnl: 0,
    unrealizedPnl: 0,
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

  const docs: PaperTradingDoc[] = [account, trade, stats, raw];

  it('every record carries a kind', () => {
    for (const d of docs) expect(d.kind).toBeTruthy();
  });

  it('each guard accepts its own kind and rejects the others', () => {
    expect(docs.filter(isPaperAccount)).toEqual([account]);
    expect(docs.filter(isPaperTrade)).toEqual([trade]);
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

describe('trade exits contracts (#652)', () => {
  it('CANCELLED is a PaperTradeStatus member serializing to CANCELLED', () => {
    expect(PaperTradeStatus.CANCELLED).toBe('CANCELLED');
    expect(Object.values(PaperTradeStatus)).toContain('CANCELLED');
  });

  it('signal defaults seed a single governing trailing-8 run', () => {
    expect(SIGNAL_GOVERNING_VARIANT).toBe('trailing-8');
    expect(DEFAULT_TRAILING_STOP_KEY).toBe('trailing-8');
    expect(SIGNAL_SHADOW_VARIANT_KEYS).toEqual([]);
  });

  it('only trailing-stop is a terminal variant family', () => {
    expect(TERMINAL_VARIANT_FAMILIES).toEqual(['trailing-stop']);
    expect(TERMINAL_VARIANT_FAMILIES).not.toContain('initial-stop');
    expect(TERMINAL_VARIANT_FAMILIES).not.toContain('time-stop');
    expect(TERMINAL_VARIANT_FAMILIES).not.toContain('limit-stddev');
  });

  it('isGoverningEligiblePct rejects degenerate fractions', () => {
    expect(isGoverningEligiblePct(0.08)).toBe(true);
    expect(isGoverningEligiblePct(0.99)).toBe(true);
    expect(isGoverningEligiblePct(0)).toBe(false);
    expect(isGoverningEligiblePct(1)).toBe(false);
    expect(isGoverningEligiblePct(1.5)).toBe(false);
    expect(isGoverningEligiblePct(NaN)).toBe(false);
  });

  it('close/cancel callable contracts carry the documented shapes', () => {
    const closeReq: ClosePaperTradeRequest = { tradeId: 't1' };
    const closeRes: ClosePaperTradeResponse = {
      tradeId: 't1', exitPrice: 1.25, realizedPnl: -50,
      closedAt: '2026-09-28T20:00:00Z',
    };
    const cancelReq: CancelPaperTradeRequest = { tradeId: 't2' };
    const cancelRes: CancelPaperTradeResponse = { tradeId: 't2' };
    expect(closeReq.tradeId).toBe('t1');
    expect(closeRes.realizedPnl).toBe(-50);
    expect(cancelRes.tradeId).toBe(cancelReq.tradeId);
  });
});

describe('auto-paper signal trades (Thread #904)', () => {
  it('AUTO_PAPER_USER_ID is the dedicated system uid', () => {
    expect(AUTO_PAPER_USER_ID).toBe('auto-paper');
    expect(buildAccountId(AUTO_PAPER_USER_ID)).toBe('acct-auto-paper');
  });

  it('a fully-stamped auto-papered trade is a valid PaperTrade', () => {
    const autoTrade: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: '261008-sig-AAPL-EQV1L',
      createdAt: NOW, updatedAt: NOW,
      status: PaperTradeStatus.OPEN,
      userId: AUTO_PAPER_USER_ID,
      source: PaperTradeSource.SIGNAL,
      signalId: 'AAPL_D_ST_TREND_RIDER_V1_LONG_2026-10-08',
      symbol: 'AAPL',
      expression: 'EQ',
      governingVariant: 'trailing-8',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      fills: [{
        fillId: 'f1', role: 'entry', date: '2026-10-08', price: 245.5,
        quantity: 1, quoteSource: OptionQuoteSource.RH_MCP,
      }],
      legs: [{ kind: 'share', side: TradeSide.LONG, quantity: 1, multiplier: 1, entryMark: 245.5, lastMark: 245.5 }],
      marks: { '2026-10-08': { mark: 245.5 } },
      variantRuns: [{
        variantKey: 'trailing-8', governing: true, state: 'ACTIVE',
        workingState: { highWaterMark: 245.5 },
      }],
      variantKeys: ['trailing-8'],
      realizedPnl: 0,
      unrealizedPnl: 0,
      // auto-paper stamps
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
      signalTimeframe: 'D',
      signalBarDate: '2026-10-08',
      signalStatus: 'INTERIM',
      signalRunId: 'run-261008-1200',
      signalIndicators: { adx: 31.4, zone: 'bull', note: 'fresh' },
      sector: 'Technology',
      industry: 'Consumer Electronics',
      marketCapTier: 'mega',
      captureList: 'PRIMARY',
    };
    expect(isPaperTrade(autoTrade)).toBe(true);
    expect(autoTrade.signalType).toBe('D_ST_TREND_RIDER_V1_LONG');
    expect(autoTrade.signalIndicators?.zone).toBe('bull');
  });

  it('a manual trade compiles with every stamp field absent', () => {
    const manual: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: '261008-man-SPY-EQ',
      createdAt: NOW, updatedAt: NOW,
      status: PaperTradeStatus.OPEN,
      source: PaperTradeSource.MANUAL,
      symbol: 'SPY',
      expression: 'EQ',
      governingVariant: 'trailing-8',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 10 },
      fills: [],
      legs: [],
      marks: {},
      variantRuns: [],
      variantKeys: [],
      realizedPnl: 0,
      unrealizedPnl: 0,
    };
    expect(isPaperTrade(manual)).toBe(true);
    expect(manual.signalType).toBeUndefined();
  });
});

describe('PaperTrade st- lineage extensions (#984)', () => {
  it('carries positionGroupId + resolved contract fields at top level', () => {
    const trade: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: 'ADPT-260927-sig-CSP-01',
      createdAt: NOW, updatedAt: NOW,
      status: PaperTradeStatus.OPEN,
      source: PaperTradeSource.SIGNAL,
      positionGroupId: 'ADPT-260927-grp-01',
      strike: 155,
      expiration: '2026-11-20',
      optionType: OptionType.PUT,
      symbol: 'ADPT',
      expression: 'CSP',
      governingVariant: 'trailing-8',
      order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1 },
      fills: [],
      legs: [],
      marks: {},
      variantRuns: [],
      variantKeys: [],
      realizedPnl: 0,
      unrealizedPnl: 0,
    };
    expect(isPaperTrade(trade)).toBe(true);
    expect(trade.positionGroupId).toBe('ADPT-260927-grp-01');
    expect(trade.strike).toBe(155);
    expect(trade.expiration).toBe('2026-11-20');
    expect(trade.optionType).toBe(OptionType.PUT);
  });

  it('a share trade compiles with the contract fields absent', () => {
    const share: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: 'ADPT-260927-sig-EQ-01',
      createdAt: NOW, updatedAt: NOW,
      status: PaperTradeStatus.OPEN,
      source: PaperTradeSource.SIGNAL,
      positionGroupId: 'ADPT-260927-grp-01',
      symbol: 'ADPT',
      expression: 'EQ',
      governingVariant: 'trailing-8',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 10 },
      fills: [],
      legs: [],
      marks: {},
      variantRuns: [],
      variantKeys: [],
      realizedPnl: 0,
      unrealizedPnl: 0,
    };
    expect(share.strike).toBeUndefined();
    expect(share.optionType).toBeUndefined();
  });

  it('writable statuses exclude PENDING — tickets hold pending expressions', () => {
    expect(PAPER_TRADE_WRITABLE_STATUSES).not.toContain(PaperTradeStatus.PENDING);
    expect([...PAPER_TRADE_WRITABLE_STATUSES].sort()).toEqual([
      PaperTradeStatus.ASSIGNED,
      PaperTradeStatus.CANCELLED,
      PaperTradeStatus.CLOSED,
      PaperTradeStatus.EXPIRED,
      PaperTradeStatus.OPEN,
    ]);
    // PENDING stays in the enum — legacy docs + reads still honor it.
    expect(Object.values(PaperTradeStatus)).toContain('PENDING');
  });
});

describe('curated signal-trade contracts (Thread #906)', () => {
  it('pins the curated variant set — trailing-8 always present (policy fallback)', () => {
    expect([...CURATED_VARIANT_KEYS].sort()).toEqual([
      'ma-close-100',
      'ma-close-20',
      'ma-close-50',
      'target-100',
      'target-50',
      'trailing-5',
      'trailing-8',
    ]);
    expect(new Set(CURATED_VARIANT_KEYS).size).toBe(CURATED_VARIANT_KEYS.length);
    expect(CURATED_VARIANT_KEYS).toContain('trailing-8');
  });

  it('pins the governing-policy marker and the PaperTrade field shape', () => {
    expect(CURATED_GOVERNING_POLICY).toBe('deepest-stop-else-trailing-8');
    const policy: GoverningPolicy = CURATED_GOVERNING_POLICY;
    const trade: PaperTrade = {
      kind: PaperTradingKind.TRADE,
      id: '261008-sig-AAPL-EQV1L',
      createdAt: NOW, updatedAt: NOW,
      status: PaperTradeStatus.OPEN,
      userId: AUTO_PAPER_USER_ID,
      source: PaperTradeSource.SIGNAL,
      signalId: 'AAPL_D_ST_TREND_RIDER_V1_LONG_2026-10-08',
      symbol: 'AAPL',
      expression: 'EQ',
      governingVariant: 'trailing-8',
      governingPolicy: policy,
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
      fills: [],
      legs: [],
      marks: {},
      variantRuns: CURATED_VARIANT_KEYS.map((key) => ({
        variantKey: key,
        governing: key === 'trailing-8',
        state: 'ACTIVE' as const,
        workingState: {},
      })),
      variantKeys: [...CURATED_VARIANT_KEYS],
      realizedPnl: 0,
      unrealizedPnl: 0,
    };
    expect(isPaperTrade(trade)).toBe(true);
    expect(trade.governingPolicy).toBe('deepest-stop-else-trailing-8');
  });

  it('OptionQuoteSource gains SDS_BARS for bars-priced fills; existing members unchanged', () => {
    expect(OptionQuoteSource.SDS_BARS).toBe('SDS_BARS');
    expect(OptionQuoteSource.RH_MCP).toBe('RH_MCP');
    expect(OptionQuoteSource.AV_EOD).toBe('AV_EOD');
    expect(OptionQuoteSource.AV_REALTIME).toBe('AV_REALTIME');
    const backfilledFill: PaperFill = {
      fillId: 'f1', role: 'entry', date: '2024-03-11', price: 172.4,
      quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS,
    };
    expect(backfilledFill.quoteSource).toBe('SDS_BARS');
  });

  it('generatePaperSignalTrades request/response carry the documented shapes', () => {
    const pick: SignalPick = {
      symbol: 'AAPL',
      signalBarDate: '2024-03-11',
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
    };
    const req: GeneratePaperSignalTradesRequest = { items: [pick] };
    const created: MintResult = {
      signalId: 'AAPL_D_ST_TREND_RIDER_V1_LONG_2024-03-11',
      tradeId: '240311-sig-AAPL-EQV1L',
      status: 'created',
    };
    const deduped: MintResult = { ...created, status: 'deduped' };
    const errored: MintResult = {
      signalId: created.signalId, status: 'error', error: 'no bars for symbol',
    };
    const res: GeneratePaperSignalTradesResponse = {
      results: [created, deduped, errored],
    };
    expect(req.items).toHaveLength(1);
    expect(res.results.map((r) => r.status)).toEqual(['created', 'deduped', 'error']);
    expect(res.results[2].tradeId).toBeUndefined();
  });

  it('deletePaperTrades request/response carry the documented shapes', () => {
    const req: DeletePaperTradesRequest = {
      tradeIds: ['240311-sig-AAPL-EQV1L', '240312-sig-MSFT-EQV2S', '240312-man-TSLA-EQ'],
    };
    const res: DeletePaperTradesResponse = {
      deleted: ['240311-sig-AAPL-EQV1L'],
      notFound: ['240312-sig-MSFT-EQV2S'],
      failed: [{ tradeId: '240312-man-TSLA-EQ', error: 'not a signal-source trade' }],
    };
    expect(req.tradeIds).toHaveLength(3);
    expect(res.deleted).toHaveLength(1);
    expect(res.notFound).toEqual(['240312-sig-MSFT-EQV2S']);
    expect(res.failed[0].tradeId).toBe('240312-man-TSLA-EQ');
  });

  it('batch bounds are pinned constants shared by callers and the callable', () => {
    expect(GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS).toBe(50);
    expect(DELETE_PAPER_TRADES_MAX_ITEMS).toBe(50);
  });

  it('a SignalPick reproduces the live ingest ids — live capture and mint can never double-mint', () => {
    const pick: SignalPick = {
      symbol: 'aapl',
      signalBarDate: '2024-03-11',
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
    };
    // The live ingest's inputs (symbol, signalType, barDate) and the pick's
    // fields produce identical signalId + tradeId — one dedupe contract.
    const liveSignalId = signalDedupeKey('AAPL', pick.signalType, pick.signalBarDate);
    const mintSignalId = signalDedupeKey(pick.symbol, pick.signalType, pick.signalBarDate);
    const barDate = new Date(`${pick.signalBarDate}T12:00:00Z`);
    const liveTradeId = buildTradeId(barDate, 'sig', 'AAPL', signalTradeDesc(pick.signalType));
    const mintTradeId = buildTradeId(barDate, 'sig', pick.symbol, signalTradeDesc(pick.signalType));
    expect(mintSignalId).toBe(liveSignalId);
    expect(mintTradeId).toBe(liveTradeId);
  });
});

describe('signal-selection review contracts (Thread #1117)', () => {
  const checkedOccurrence: SignalReviewOccurrence = {
    occurrenceId: 'AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG',
    symbol: 'AAPL',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    signalBarDate: '2024-03-11',
    signalTimeframe: 'D',
    direction: TradeSide.LONG,
    signalStatus: 'CONFIRMED',
    signalIndicators: { sma20: 172.4 },
    sourceRunId: 'run-1',
    checked: true,
    tradeId: '240311-sig-AAPL-EQV1L',
    tradeStatus: PaperTradeStatus.OPEN,
  };
  const uncheckedOccurrence: SignalReviewOccurrence = {
    ...checkedOccurrence,
    occurrenceId: 'AAPL_2024-02-28_D_ST_TREND_RIDER_V1_SHORT',
    signalType: 'D_ST_TREND_RIDER_V1_SHORT',
    signalBarDate: '2024-02-28',
    direction: TradeSide.SHORT,
    signalStatus: 'INTERIM',
    checked: false,
  };

  it('signalPickFromReviewOccurrence maps {symbol, signalBarDate, signalType} exactly', () => {
    const pick: SignalPick = signalPickFromReviewOccurrence(checkedOccurrence);
    // Literal pin — this is THE site guarding the barDate/signalBarDate
    // rename across the seam (the signalDedupeKey vs stSignalOccurrenceId
    // field-order hazard).
    expect(pick).toEqual({
      symbol: 'AAPL',
      signalBarDate: '2024-03-11',
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
    });
    // No join/identity fields leak into the pick.
    expect(Object.keys(pick).sort()).toEqual(['signalBarDate', 'signalType', 'symbol']);
  });

  it('the mapper ignores the ledger-join fields — unchecked rows map identically', () => {
    const pick = signalPickFromReviewOccurrence(uncheckedOccurrence);
    expect(pick).toEqual({
      symbol: 'AAPL',
      signalBarDate: '2024-02-28',
      signalType: 'D_ST_TREND_RIDER_V1_SHORT',
    });
  });

  it('bundle response: previousOpenedAt is string|null (null = first visit, all-new divider)', () => {
    const firstVisit: GetSignalReviewBundleResponse = {
      symbol: 'AAPL',
      previousOpenedAt: null,
      openedAt: '2026-11-20T18:00:00Z',
      occurrences: [uncheckedOccurrence],
    };
    const revisit: GetSignalReviewBundleResponse = {
      ...firstVisit,
      previousOpenedAt: '2026-11-19T18:00:00Z',
    };
    expect(firstVisit.previousOpenedAt).toBeNull();
    expect(revisit.previousOpenedAt).toBe('2026-11-19T18:00:00Z');
    expect(firstVisit.occurrences[0].checked).toBe(false);
  });

  it('review-state doc + queue rows carry the documented shapes', () => {
    const state: SignalReviewStateDoc = {
      lastOpenedAt: { AAPL: '2026-11-20T18:00:00Z' },
    };
    const rowWithSignals: SignalReviewQueueRow = {
      symbol: 'AAPL',
      lastDailySignalDate: '2026-11-20',
      lastOpenedAt: '2026-11-20T18:00:00Z',
    };
    const rowNoSignals: SignalReviewQueueRow = { symbol: 'MSFT' };
    const res: GetSignalReviewQueueResponse = {
      rows: [rowWithSignals, rowNoSignals],
    };
    expect(state.lastOpenedAt['AAPL']).toBe('2026-11-20T18:00:00Z');
    expect(res.rows[0].lastDailySignalDate).toBe('2026-11-20');
    expect(res.rows[1].lastDailySignalDate).toBeUndefined();
    expect(res.rows[1].lastOpenedAt).toBeUndefined();
  });

  it('an occurrence id is the stSignalOccurrenceId layout — {SYM}_{barDate}_{type}', () => {
    // Fixture sanity via the canonical builder (never parsed at runtime —
    // signalType itself contains '_' so the id is not reversible).
    expect(checkedOccurrence.occurrenceId).toBe(
      stSignalOccurrenceId(
        checkedOccurrence.symbol,
        checkedOccurrence.signalBarDate,
        checkedOccurrence.signalType,
      ),
    );
    expect(checkedOccurrence.occurrenceId).toBe(
      'AAPL_2024-03-11_D_ST_TREND_RIDER_V1_LONG',
    );
  });
});
