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
  buildCohortId,
  buildStatsId,
  statsScopeAll,
  statsScopeInstance,
  statsScopeVariant,
  statsScopeCohort,
  statsScopeSignal,
  statsScopeSymbol,
  buildRawQuoteId,
  parseTradeId,
  type TradeOrigin,
} from './paper-trading-ids';

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
