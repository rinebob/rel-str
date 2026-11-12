/**
 * Analysis-results emit util specs (#1431 item 12).
 *
 * Pure seam: AnalysisResultDoc → PlottedEntry[] for the option chart.
 * Each contract's markerDates is the union of pick days + that pick's
 * terminal marker under the doc's rule — exitDate for 'exit', OCC
 * expiration for 'expired', lastBarDate for 'open', pick-day-only for
 * 'error'. The exit price rides implicitly: the dot lands on the
 * plotted series at that date, which IS the mark.
 */
import { EXIT_REGISTRY_VERSION } from '@options-analysis/registry';
import type {
  AnalysisErrorTrade,
  AnalysisExitTrade,
  AnalysisExpiredTrade,
  AnalysisOpenTrade,
  AnalysisResultDoc,
  AnalysisTradeRecord,
} from '@options-analysis/contracts';
import { resultDocToPlottedEntries } from './analysis-results-emit.util';

const tradeBase = (over: Partial<AnalysisExitTrade> = {}) => ({
  runId: 'run-1',
  symbol: 'SPY',
  templateId: 'csp-45-20',
  contractListDocId: 'run-1_SPY',
  exitId: 'target-90',
  pickDate: '2026-06-10',
  contractId: 'SPY260731P00500000', // expiry 2026-07-31, strike 500
  entryMark: 2.5,
  daysHeld: 9,
  mae: { value: 1.2, date: '2026-06-12' },
  mfe: { value: 3.1, date: '2026-06-18' },
  ...over,
});

const exitRec = (over: Partial<AnalysisExitTrade> = {}): AnalysisExitTrade => ({
  ...tradeBase(),
  outcome: 'exit',
  exitDate: '2026-06-19',
  exitPrice: 0.25,
  ...over,
});

const expiredRec = (over: Partial<AnalysisExpiredTrade> = {}): AnalysisExpiredTrade => ({
  ...tradeBase(),
  outcome: 'expired',
  expiredItm: false,
  intrinsicAtExpiry: 0,
  assignmentDistancePct: 3.2,
  ...over,
});

const openRec = (over: Partial<AnalysisOpenTrade> = {}): AnalysisOpenTrade => ({
  ...tradeBase(),
  outcome: 'open',
  lastBarDate: '2026-06-25',
  ...over,
});

const errorRec = (over: Partial<AnalysisErrorTrade> = {}): AnalysisErrorTrade => ({
  ...tradeBase(),
  outcome: 'error',
  error: 'no series',
  daysHeld: 0,
  ...over,
});

const doc = (trades: AnalysisTradeRecord[]): AnalysisResultDoc => ({
  contractListDocId: 'run-1_SPY',
  runId: 'run-1',
  symbol: 'SPY',
  templateId: 'csp-45-20',
  exitId: 'target-90',
  registryVersion: EXIT_REGISTRY_VERSION,
  status: 'success',
  trades,
  aggregate: {
    exitId: 'target-90',
    contractCount: trades.length,
    exitedCount: 0,
    expiredCount: 0,
    openCount: 0,
    errorCount: 0,
  },
  generatedAt: '2026-11-10T00:00:00Z',
});

describe('resultDocToPlottedEntries', () => {
  it('one entry per unique contract — markerDates = pick day ∪ terminal marker', () => {
    const entries = resultDocToPlottedEntries(
      doc([
        exitRec({ contractId: 'SPY260731P00500000' }),
        exitRec({ contractId: 'SPY260731P00510000', pickDate: '2026-06-11' }),
      ]),
    );
    expect(entries.map((e) => e.contractId)).toEqual([
      'SPY260731P00500000',
      'SPY260731P00510000',
    ]);
    expect(entries[0].markerDates).toEqual(['2026-06-10', '2026-06-19']);
    expect(entries[0].openDate).toBe('2026-06-10');
  });

  it('expired carries the OCC-parsed expiration as its terminal marker', () => {
    const entries = resultDocToPlottedEntries(doc([expiredRec()]));
    // SPY260731P00500000 → 2026-07-31.
    expect(entries[0].markerDates).toEqual(['2026-06-10', '2026-07-31']);
  });

  it('open carries the last observed bar as its as-of marker', () => {
    const entries = resultDocToPlottedEntries(doc([openRec()]));
    expect(entries[0].markerDates).toEqual(['2026-06-10', '2026-06-25']);
  });

  it('error records contribute the pick day only — no terminal marker exists', () => {
    const entries = resultDocToPlottedEntries(doc([errorRec()]));
    expect(entries[0].markerDates).toEqual(['2026-06-10']);
  });

  it('consecutive picks of the same contract union into one entry (all dots)', () => {
    const entries = resultDocToPlottedEntries(
      doc([
        exitRec({ pickDate: '2026-06-10', exitDate: '2026-06-19' }),
        exitRec({ pickDate: '2026-06-15', exitDate: '2026-06-22' }),
      ]),
    );
    expect(entries.length).toBe(1);
    expect(entries[0].markerDates).toEqual([
      '2026-06-10',
      '2026-06-15',
      '2026-06-19',
      '2026-06-22',
    ]);
    expect(entries[0].openDate).toBe('2026-06-10');
  });

  it('sorts entries by earliest marker then contractId', () => {
    const entries = resultDocToPlottedEntries(
      doc([
        exitRec({ contractId: 'SPY260731P00520000', pickDate: '2026-06-12' }),
        exitRec({ contractId: 'SPY260731P00510000', pickDate: '2026-06-10' }),
        exitRec({ contractId: 'SPY260731P00500000', pickDate: '2026-06-10' }),
      ]),
    );
    expect(entries.map((e) => e.contractId)).toEqual([
      'SPY260731P00500000',
      'SPY260731P00510000',
      'SPY260731P00520000',
    ]);
  });

  it('empty trades → empty entries', () => {
    expect(resultDocToPlottedEntries(doc([]))).toEqual([]);
  });
});
