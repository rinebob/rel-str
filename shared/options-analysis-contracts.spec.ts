/**
 * @topic #1238 — Options Backtest, Thread #1266 (Backtest Analytics)
 * @task #1367 — SHARED: Exit registry + analysis contracts
 *
 * Fixture validation for the analysis doc shapes: the discriminated union on
 * `outcome` carries per-variant fields, error records use the entry-day
 * placeholder convention, and aggregates exclude errors from the hit-rate
 * denominator.
 */

import { ANALYSIS_RESULT_STATUSES } from './options-analysis-contracts';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
  ExitTypeAggregate,
  OptionsAnalysisStartRequest,
  OptionsAnalysisStartResponse,
  OptionsAnalysisTaskPayload,
} from './options-analysis-contracts';

const BASE = {
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  contractListDocId: 'run-1_QQQ',
  exitId: 'target-90',
  pickDate: '2026-01-05',
  contractId: 'QQQ260220P00500000',
  entryMark: 4.2,
  daysHeld: 12,
  mae: { value: 6.1, date: '2026-01-12' },
  mfe: { value: 0.5, date: '2026-01-16' },
};

describe('options-analysis-contracts', () => {
  it('exit variant carries exit fields', () => {
    const rec: AnalysisTradeRecord = {
      ...BASE,
      outcome: 'exit',
      exitDate: '2026-01-17',
      exitPrice: 0.42,
    };
    expect(rec.outcome).toBe('exit');
    if (rec.outcome !== 'exit') throw new Error('unreachable');
    expect(rec.exitPrice).toBeLessThan(rec.entryMark);
    expect(rec.exitDate).toBe('2026-01-17');
  });

  it('expired variant carries expiry fields', () => {
    const rec: AnalysisTradeRecord = {
      ...BASE,
      outcome: 'expired',
      expiredItm: true,
      intrinsicAtExpiry: 3.1,
      // PERCENT convention (×100): 0.62% of underlying — not a ratio.
      assignmentDistancePct: 0.62,
    };
    expect(rec.outcome).toBe('expired');
    if (rec.outcome !== 'expired') throw new Error('unreachable');
    expect(rec.expiredItm).toBe(true);
    expect(rec.assignmentDistancePct).toBeLessThan(100);
  });

  it('error variant carries error + entry-day placeholder convention', () => {
    const rec: AnalysisTradeRecord = {
      ...BASE,
      outcome: 'error',
      daysHeld: 0,
      mae: { value: BASE.entryMark, date: BASE.pickDate },
      mfe: { value: BASE.entryMark, date: BASE.pickDate },
      error: 'series fetch 404',
    };
    expect(rec.outcome).toBe('error');
    if (rec.outcome !== 'error') throw new Error('unreachable');
    expect(rec.error).toBe('series fetch 404');
    expect(rec.daysHeld).toBe(0);
    expect(rec.mae.value).toBe(rec.entryMark);
    expect(rec.mae.date).toBe(rec.pickDate);
  });

  it('aggregate hitRate denominator excludes errorCount (PERCENT)', () => {
    // 10 contracts: 6 exits, 3 expiries, 1 error → hitRate 6/9.
    const agg: ExitTypeAggregate = {
      exitId: 'target-90',
      contractCount: 10,
      exitedCount: 6,
      expiredCount: 3,
      errorCount: 1,
      hitRatePct: (6 / 9) * 100,
      avgDaysToExit: 15.5,
      avgPremiumCapturedPct: 90,
      worstMae: 7.2,
    };
    expect(agg.exitedCount + agg.expiredCount + agg.errorCount).toBe(agg.contractCount);
    expect(agg.hitRatePct).toBeCloseTo(66.7, 1);
  });

  it('result doc shape: one doc per (list × exit) with registryVersion', () => {
    const expiredRec: AnalysisTradeRecord = {
      ...BASE,
      exitId: 'expiry',
      outcome: 'expired',
      expiredItm: false,
      intrinsicAtExpiry: 0,
      assignmentDistancePct: 31,
    };
    const doc: AnalysisResultDoc = {
      contractListDocId: 'run-1_QQQ',
      runId: 'run-1',
      symbol: 'QQQ',
      templateId: 'csp-45-20',
      exitId: 'expiry',
      registryVersion: 1,
      status: 'success',
      trades: [expiredRec],
      aggregate: {
        exitId: 'expiry',
        contractCount: 1,
        exitedCount: 0,
        expiredCount: 1,
        errorCount: 0,
        hitRatePct: 0,
        worstMae: 6.1,
      },
      generatedAt: '2026-11-02T00:00:00.000Z',
    };
    expect(doc.exitId).toBe('expiry');
    expect(doc.trades.every((t) => t.exitId === doc.exitId)).toBe(true);
    expect(doc.registryVersion).toBe(1);
  });

  describe('statuses + payloads', () => {
    it('ANALYSIS_RESULT_STATUSES lists running/success/failed', () => {
      expect(ANALYSIS_RESULT_STATUSES).toEqual([
        'running',
        'success',
        'failed',
      ]);
    });

    it('callable + task payload shapes', () => {
      const req: OptionsAnalysisStartRequest = {
        contractListDocId: 'run-1_QQQ',
      };
      const res: OptionsAnalysisStartResponse = { analysisId: req.contractListDocId };
      const task: OptionsAnalysisTaskPayload = {
        contractListDocId: req.contractListDocId,
        runId: 'run-1_QQQ',
        symbol: 'QQQ',
        templateId: 'csp-45-20',
        registryVersion: 1,
      };
      expect(res.analysisId).toBe(task.contractListDocId);
      // listDocId IS the runId under single-symbol runs (#1430).
      expect(task.contractListDocId).toBe(task.runId);
    });
  });
});
