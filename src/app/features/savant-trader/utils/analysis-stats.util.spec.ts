/**
 * Analysis stats utils (Thread #1059, task #1084) — pure computations over
 * the workbench's filtered row set: stats block, histogram bins, scatter
 * points. The AC fixture numbers (98 closed / ~32.7% / payoff ~1.30) are
 * reproduced in the service-level spec; here the formulas are pinned on
 * small hand-computed sets.
 */
import { PaperTradeStatus } from '@paper-trading/contracts';
import { TradeSide } from '@common';
import {
  AnalysisCohort,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import {
  computeAnalysisStats,
  histogramBins,
  scatterPoints,
} from './analysis-stats.util';

function row(over: Partial<TradeAnalysisRow> = {}): TradeAnalysisRow {
  return {
    tradeId: 'tr-x',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    symbol: 'AMAT',
    direction: TradeSide.LONG,
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: PaperTradeStatus.CLOSED,
    entryDate: '2024-10-01',
    tradeRetPct: 0,
    daysHeld: 10,
    mfePct: 5,
    maePct: -2,
    givebackRatio: 0.3,
    ...over,
  } as TradeAnalysisRow;
}

describe('computeAnalysisStats', () => {
  it('empty input returns zeros/nulls — never NaN', () => {
    const s = computeAnalysisStats([]);
    expect(s.count).toBe(0);
    expect(s.profitablePct).toBeNull();
    expect(s.avgRetPct).toBeNull();
    expect(s.medianRetPct).toBeNull();
    expect(s.payoff).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.bySignalType).toEqual([]);
  });

  it('core metrics on a hand-computed set', () => {
    // rets: +10, +5, -4, -8  → 2W/2L, win 50%, avg 0.75, median 0.5
    const rows = [
      row({ tradeRetPct: 10, entryDate: '2024-01-01' }),
      row({ tradeRetPct: 5, entryDate: '2024-01-05' }),
      row({ tradeRetPct: -4, entryDate: '2024-01-09' }),
      row({ tradeRetPct: -8, entryDate: '2024-01-13' }),
    ];
    const s = computeAnalysisStats(rows);
    expect(s.count).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.losses).toBe(2);
    expect(s.profitablePct).toBeCloseTo(50);
    expect(s.avgRetPct).toBeCloseTo(0.75);
    expect(s.medianRetPct).toBeCloseTo(0.5);
    expect(s.avgWinPct).toBeCloseTo(7.5);
    expect(s.avgLossPct).toBeCloseTo(-6);
    // payoff = avgWin / |avgLoss| = 7.5/6 = 1.25
    expect(s.payoff).toBeCloseTo(1.25);
    // profit factor = gross wins / |gross losses| = 15/12 = 1.25
    expect(s.profitFactor).toBeCloseTo(1.25);
    expect(s.expectancyPct).toBeCloseTo(0.75);
  });

  it('a zero return counts as neither win nor loss', () => {
    const s = computeAnalysisStats([
      row({ tradeRetPct: 0 }),
      row({ tradeRetPct: 4 }),
    ]);
    expect(s.count).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(0);
  });

  it('profit factor is Infinity when every trade won; 0 when every trade lost', () => {
    expect(
      computeAnalysisStats([row({ tradeRetPct: 3 })]).profitFactor,
    ).toBe(Infinity);
    expect(
      computeAnalysisStats([row({ tradeRetPct: -3 })]).profitFactor,
    ).toBe(0);
  });

  it('max consecutive wins/losses follow entryDate order, not input order', () => {
    const rows = [
      row({ tradeRetPct: 1, entryDate: '2024-01-04' }), // W (latest)
      row({ tradeRetPct: -1, entryDate: '2024-01-01' }), // L
      row({ tradeRetPct: -2, entryDate: '2024-01-02' }), // L
      row({ tradeRetPct: 3, entryDate: '2024-01-03' }), // W
    ];
    const s = computeAnalysisStats(rows);
    expect(s.maxConsecutiveWins).toBe(2); // W,W at the end
    expect(s.maxConsecutiveLosses).toBe(2); // L,L at the start
  });

  it('context metrics average over rows that carry them', () => {
    const s = computeAnalysisStats([
      row({ daysHeld: 10, mfePct: 8, maePct: -4, givebackRatio: 0.5 }),
      row({ daysHeld: 20, mfePct: 12, maePct: -6, givebackRatio: 0.25 }),
      row({ daysHeld: null, mfePct: null, maePct: null, givebackRatio: null }),
    ]);
    expect(s.avgDaysHeld).toBeCloseTo(15);
    expect(s.avgMfePct).toBeCloseTo(10);
    expect(s.avgMaePct).toBeCloseTo(-5);
    expect(s.avgGivebackRatio).toBeCloseTo(0.375);
  });

  it('per-signalType breakdown carries count, win rate, avg return, profit factor', () => {
    const rows = [
      row({ signalType: 'A', tradeRetPct: 10 }),
      row({ signalType: 'A', tradeRetPct: -5 }),
      row({ signalType: 'B', tradeRetPct: 20 }),
    ];
    const s = computeAnalysisStats(rows);
    const a = s.bySignalType.find((x) => x.signalType === 'A')!;
    const b = s.bySignalType.find((x) => x.signalType === 'B')!;
    expect(a.count).toBe(2);
    expect(a.winPct).toBeCloseTo(50);
    expect(a.avgRetPct).toBeCloseTo(2.5);
    expect(a.profitFactor).toBeCloseTo(2);
    expect(b.winPct).toBeCloseTo(100);
  });
});

describe('histogramBins', () => {
  it('bins tradeRetPct at the given width, edges aligned to zero', () => {
    const rows = [
      row({ tradeRetPct: 12 }),
      row({ tradeRetPct: 3 }),
      row({ tradeRetPct: -7 }),
      row({ tradeRetPct: -1 }),
      row({ tradeRetPct: -1.5 }),
    ];
    const bins = histogramBins(rows, 'tradeRetPct', 5);
    // Edges: -10..-5 → {-7}, -5..0 → {-1,-1.5}, 0..5 → {3}, 10..15 → {12}
    expect(bins).toEqual([
      { x0: -10, x1: -5, count: 1, wins: 0, losses: 1 },
      { x0: -5, x1: 0, count: 2, wins: 0, losses: 2 },
      { x0: 0, x1: 5, count: 1, wins: 1, losses: 0 },
      { x0: 10, x1: 15, count: 1, wins: 1, losses: 0 },
    ]);
  });

  it('marks whether a bin is on the win or loss side for coloring', () => {
    const bins = histogramBins([row({ tradeRetPct: -3 })], 'tradeRetPct', 5);
    expect(bins[0].losses).toBe(1);
  });

  it('a zero return lands in the non-negative bin but counts as neither win nor loss', () => {
    const bins = histogramBins([row({ tradeRetPct: 0 })], 'tradeRetPct', 5);
    expect(bins).toEqual([{ x0: 0, x1: 5, count: 1, wins: 0, losses: 0 }]);
  });

  it('skips null returns and returns [] on empty', () => {
    expect(
      histogramBins([row({ tradeRetPct: null })], 'tradeRetPct', 5),
    ).toEqual([]);
  });
});

describe('scatterPoints', () => {
  it('maps rows to {x,y,color,tradeId} and drops nulls on either axis', () => {
    const rows = [
      row({ tradeId: 'a', tradeRetPct: 5, daysHeld: 10, mfePct: 8 }),
      row({ tradeId: 'b', tradeRetPct: -3, daysHeld: null, mfePct: 8 }),
      row({ tradeId: 'c', tradeRetPct: 7, daysHeld: 4, mfePct: null }),
    ];
    expect(
      scatterPoints(rows, 'daysHeld', 'tradeRetPct', 'signalType'),
    ).toEqual([
      { x: 10, y: 5, color: 'D_ST_TREND_RIDER_V1_LONG', tradeId: 'a' },
      { x: 4, y: 7, color: 'D_ST_TREND_RIDER_V1_LONG', tradeId: 'c' },
    ]);
  });

  it('drops NaN/Infinity values on either axis — they are not plottable', () => {
    const rows = [
      row({ tradeId: 'a', tradeRetPct: NaN, daysHeld: 10 }),
      row({ tradeId: 'b', tradeRetPct: 5, daysHeld: Infinity }),
      row({ tradeId: 'c', tradeRetPct: 7, daysHeld: 4 }),
    ];
    expect(scatterPoints(rows, 'daysHeld', 'tradeRetPct')).toEqual([
      { x: 4, y: 7, color: undefined, tradeId: 'c' },
    ]);
  });

  it('omits the color field when no color column is chosen', () => {
    const [p] = scatterPoints([row()], 'daysHeld', 'tradeRetPct');
    expect(p.color).toBeUndefined();
  });
});
