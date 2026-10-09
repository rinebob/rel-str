/**
 * Tests for paper-trading ID builders and collection-path helpers.
 *
 * Approved formats (Blueprint #557):
 *   acct-{userId}
 *   inst: existing generateInstanceId convention
 *   trade: YYMMDD-{origin}-{SYMBOL}-{desc}  (origin: st|sig|man; desc: EQ or SPREAD-DELTA-DTE; -HHMM collision suffix)
 *   cohort-YYMMDD-{SYMBOL}-{seq}
 *   stats-{scope}
 *   rq-{tradeId}-{YYMMDD}
 */

import {
  PAPER_TRADING_ROOT,
  PaperTradingKind,
  paperTradingItemsPath,
  paperTradingDocPath,
  buildAccountId,
  buildTradeId,
  EQUITY_TRADE_DESC,
  buildSpreadTradeDesc,
  signalTradeDesc,
  signalDedupeKey,
  buildCohortId,
  buildStatsId,
  statsScopeAll,
  statsScopeInstance,
  statsScopeVariant,
  statsScopeCohort,
  statsScopeSignal,
  statsScopeSymbol,
  statsScopeSignalType,
  statsScopeDirection,
  statsScopeSector,
  statsScopeIndustry,
  statsScopeCapTier,
  statsScopeSignalStatus,
  buildRawQuoteId,
  parseTradeId,
  type TradeOrigin,
} from './paper-trading-ids';
import { TradeSide } from './common';

const DAY = new Date('2026-09-24T18:30:00Z');

describe('paper-trading collection paths', () => {
  it('root collection is paper-trading', () => {
    expect(PAPER_TRADING_ROOT).toBe('paper-trading');
  });

  it.each([
    [PaperTradingKind.ACCOUNT, 'accounts'],
    [PaperTradingKind.INSTANCE, 'instances'],
    [PaperTradingKind.COHORT, 'cohorts'],
    [PaperTradingKind.TRADE, 'trades'],
    [PaperTradingKind.STATS, 'stats'],
    [PaperTradingKind.RAW_QUOTE, 'raw-quotes'],
  ])('items path for %s is paper-trading/%s/items', (kind, anchor) => {
    expect(paperTradingItemsPath(kind)).toBe(`paper-trading/${anchor}/items`);
  });

  it('doc path appends the id under items', () => {
    expect(paperTradingDocPath(PaperTradingKind.TRADE, '260924-sig-QQQ-EQ'))
      .toBe('paper-trading/trades/items/260924-sig-QQQ-EQ');
  });
});

describe('buildAccountId', () => {
  it('prefixes the user id', () => {
    expect(buildAccountId('a1b2c3')).toBe('acct-a1b2c3');
  });
});

describe('buildTradeId', () => {
  it('builds a signal equity trade id', () => {
    expect(buildTradeId(DAY, 'sig', 'qqq', 'EQ')).toBe('260924-sig-QQQ-EQ');
  });

  it('builds a strategy spread trade id', () => {
    expect(buildTradeId(DAY, 'st', 'QQQM', 'CSP-020-30')).toBe('260924-st-QQQM-CSP-020-30');
  });

  it('supports a manual origin', () => {
    expect(buildTradeId(DAY, 'man', 'SPY', 'EQ')).toBe('260924-man-SPY-EQ');
  });

  it('appends -HHMM when a collision suffix is requested', () => {
    expect(buildTradeId(DAY, 'sig', 'QQQ', 'EQ', { timeSuffix: '0935' })).toBe('260924-sig-QQQ-EQ-0935');
  });

  it('rejects an unknown origin', () => {
    expect(() => buildTradeId(DAY, 'xx' as TradeOrigin, 'QQQ', 'EQ')).toThrow();
  });
});

describe('trade desc helpers', () => {
  it('equity desc is EQ', () => {
    expect(EQUITY_TRADE_DESC).toBe('EQ');
  });

  it('spread desc is {CODE}-{DELTA3}-{DTE2}', () => {
    expect(buildSpreadTradeDesc('CSP', 0.2, 30)).toBe('CSP-020-30');
    expect(buildSpreadTradeDesc('BCS', 0.15, 40)).toBe('BCS-015-40');
  });
});

describe('buildCohortId', () => {
  it('builds cohort-YYMMDD-{SYMBOL}-{seq2}', () => {
    expect(buildCohortId(DAY, 'qqq', 1)).toBe('cohort-260924-QQQ-01');
    expect(buildCohortId(DAY, 'QQQ', 12)).toBe('cohort-260924-QQQ-12');
  });
});

describe('buildStatsId and scopes', () => {
  it('stats-all for the global scope', () => {
    expect(buildStatsId(statsScopeAll())).toBe('stats-all');
  });

  it('per-instance scope', () => {
    expect(buildStatsId(statsScopeInstance('260924-QQQM-CSP-020-30-D-1200')))
      .toBe('stats-inst-260924-QQQM-CSP-020-30-D-1200');
  });

  it('per-variant scope', () => {
    expect(buildStatsId(statsScopeVariant('trailing-20'))).toBe('stats-var-trailing-20');
  });

  it('per-cohort scope does not double the cohort- prefix', () => {
    expect(buildStatsId(statsScopeCohort('cohort-260924-QQQ-01'))).toBe('stats-cohort-260924-QQQ-01');
  });

  it('per-signal scope', () => {
    expect(buildStatsId(statsScopeSignal('sig-123'))).toBe('stats-sig-sig-123');
  });

  it('per-symbol scope', () => {
    expect(buildStatsId(statsScopeSymbol('qqq'))).toBe('stats-sym-QQQ');
  });
});

describe('buildRawQuoteId', () => {
  it('builds rq-{tradeId}-{YYMMDD}', () => {
    expect(buildRawQuoteId('260924-st-QQQM-CSP-020-30', new Date('2026-09-25')))
      .toBe('rq-260924-st-QQQM-CSP-020-30-260925');
  });
});

describe('signalTradeDesc and signalDedupeKey (Thread #904)', () => {
  it.each([
    ['D_ST_TREND_RIDER_V1_LONG', 'EQV1L'],
    ['D_ST_TREND_RIDER_V1_SHORT', 'EQV1S'],
    ['D_ST_TREND_RIDER_V2_LONG', 'EQV2L'],
    ['D_ST_TREND_RIDER_V2_SHORT', 'EQV2S'],
  ])('maps %s → %s', (signalType, desc) => {
    expect(signalTradeDesc(signalType)).toBe(desc);
  });

  it('produces trade ids that round-trip through parseTradeId', () => {
    const id = buildTradeId(DAY, 'sig', 'AAPL', signalTradeDesc('D_ST_TREND_RIDER_V1_LONG'));
    expect(id).toBe('260924-sig-AAPL-EQV1L');
    expect(parseTradeId(id)).toEqual({
      date: '260924', origin: 'sig', symbol: 'AAPL', desc: 'EQV1L', suffix: undefined,
    });
  });

  it('gives V1 and V2 distinct ids for the same symbol/day', () => {
    const v1 = buildTradeId(DAY, 'sig', 'AAPL', signalTradeDesc('D_ST_TREND_RIDER_V1_LONG'));
    const v2 = buildTradeId(DAY, 'sig', 'AAPL', signalTradeDesc('D_ST_TREND_RIDER_V2_LONG'));
    expect(v1).not.toBe(v2);
  });

  it('throws on a signal type without the version/direction suffix', () => {
    expect(() => signalTradeDesc('SOME_OTHER_SIGNAL')).toThrow();
    expect(() => signalTradeDesc('D_ST_TREND_RIDER_V1')).toThrow();
  });

  it('throws on non-daily signals rather than colliding on tradeId', () => {
    // W_/M_ twins would produce the same EQV{L|S} desc — silent dedupe
    // collision — so unsupported timeframes fail loudly.
    expect(() => signalTradeDesc('W_ST_TREND_RIDER_V1_LONG')).toThrow();
    expect(() => signalTradeDesc('M_ST_TREND_RIDER_V2_SHORT')).toThrow();
    // Different daily strategy would collide on EQV{L|S} too — fails loud.
    expect(() => signalTradeDesc('D_MEAN_REVERT_V1_LONG')).toThrow();
  });

  it('dedupe key is SYMBOL_SIGNALTYPE_BARDATE, symbol uppercased', () => {
    expect(signalDedupeKey('aapl', 'D_ST_TREND_RIDER_V1_LONG', '2026-10-08'))
      .toBe('AAPL_D_ST_TREND_RIDER_V1_LONG_2026-10-08');
  });
});

describe('auto-paper stats scopes (Thread #904)', () => {
  it('per-signalType scope slugifies the type', () => {
    expect(statsScopeSignalType('D_ST_TREND_RIDER_V1_LONG'))
      .toBe('sigtype-d-st-trend-rider-v1-long');
  });

  it('per-direction scope keys off the TradeSide value', () => {
    expect(statsScopeDirection(TradeSide.LONG)).toBe('dir-long');
    expect(statsScopeDirection(TradeSide.SHORT)).toBe('dir-short');
  });

  it('sector/industry scopes slugify display strings', () => {
    expect(statsScopeSector('Health Care')).toBe('sector-health-care');
    expect(statsScopeIndustry('Medical Devices')).toBe('ind-medical-devices');
    expect(statsScopeIndustry('Banks—Diversified')).toBe('ind-banks-diversified');
  });

  it('cap-tier scope', () => {
    expect(statsScopeCapTier('mega')).toBe('captier-mega');
    expect(statsScopeCapTier('LARGE_CAP')).toBe('captier-large-cap');
  });

  it('separator-only differences slugify to the same scope (accepted collision)', () => {
    expect(statsScopeIndustry('A-B')).toBe(statsScopeIndustry('A B'));
  });

  it('signal-status scope', () => {
    expect(statsScopeSignalStatus('INTERIM')).toBe('sigstatus-interim');
    expect(statsScopeSignalStatus('CONFIRMED')).toBe('sigstatus-confirmed');
  });

  it('is deterministic', () => {
    expect(statsScopeSector('Health Care')).toBe(statsScopeSector('Health Care'));
  });
});

describe('parseTradeId', () => {
  it('parses a signal equity trade id', () => {
    expect(parseTradeId('260924-sig-QQQ-EQ')).toEqual({
      date: '260924', origin: 'sig', symbol: 'QQQ', desc: 'EQ', suffix: undefined,
    });
  });

  it('parses a strategy spread id', () => {
    expect(parseTradeId('260924-st-QQQM-CSP-020-30')).toEqual({
      date: '260924', origin: 'st', symbol: 'QQQM', desc: 'CSP-020-30', suffix: undefined,
    });
  });

  it('parses a collision-suffixed id', () => {
    expect(parseTradeId('260924-sig-QQQ-EQ-0935')).toEqual({
      date: '260924', origin: 'sig', symbol: 'QQQ', desc: 'EQ', suffix: '0935',
    });
  });

  it('returns null for malformed ids', () => {
    expect(parseTradeId('not-a-trade')).toBeNull();
    expect(parseTradeId('260924-xx-QQQ-EQ')).toBeNull();
  });

  it('round-trips buildTradeId → parseTradeId', () => {
    const cases: [Date, TradeOrigin, string, string, { timeSuffix?: string }?][] = [
      [DAY, 'sig', 'QQQ', EQUITY_TRADE_DESC],
      [DAY, 'st', 'QQQM', buildSpreadTradeDesc('CSP', 0.2, 30)],
      [DAY, 'sig', 'QQQ', 'EQ', { timeSuffix: '0935' }],
    ];
    for (const [d, origin, symbol, desc, opts] of cases) {
      const id = buildTradeId(d, origin, symbol, desc, opts);
      const p = parseTradeId(id);
      expect(p).not.toBeNull();
      expect(p).toEqual({
        date: '260924',
        origin,
        symbol: symbol.toUpperCase(),
        desc,
        suffix: opts?.timeSuffix,
      });
    }
  });
});
