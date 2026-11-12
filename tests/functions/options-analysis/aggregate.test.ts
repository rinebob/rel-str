/**
 * Unit tests for `aggregateExitType` — per-exit-type aggregation
 * (Topic #1238, Thread #1266, task #1372). Synthetic record sets only.
 *
 * Covers TEST-BE §Aggregator:
 * - hitRatePct / avgDaysToExit / avgPremiumCapturedPct / worstMae /
 *   maeP50 / maeP90 over synthetic sets
 * - empty-set and all-error edge cases → defined, no NaN
 * - hitRate denominator EXCLUDES error records
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aggregateExitType } from '../../../functions/src/options-analysis/aggregate';
import type { AnalysisTradeRecord } from '@options-analysis/contracts';

// ==========================
// Fixtures
// ==========================

const BASE = {
  runId: 'run-1',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  contractListDocId: 'run-1_QQQ',
  exitId: 'target-90',
};

function exitRec(over: Partial<{
  pickDate: string; contractId: string; entryMark: number;
  daysHeld: number; exitDate: string; exitPrice: number;
  mae: number; mfe: number;
}> = {}): AnalysisTradeRecord {
  return {
    ...BASE,
    pickDate: over.pickDate ?? '2026-01-05',
    contractId: over.contractId ?? 'C1',
    entryMark: over.entryMark ?? 2.0,
    daysHeld: over.daysHeld ?? 10,
    mae: { value: over.mae ?? 2.0, date: '2026-01-05' },
    mfe: { value: over.mfe ?? 1.0, date: '2026-01-06' },
    outcome: 'exit',
    exitDate: over.exitDate ?? '2026-01-15',
    exitPrice: over.exitPrice ?? 1.0,
  };
}

function expiredRec(over: Partial<{ mae: number; mfe: number; daysHeld: number }> = {}): AnalysisTradeRecord {
  return {
    ...BASE,
    pickDate: '2026-01-05',
    contractId: 'C1',
    entryMark: 2.0,
    daysHeld: over.daysHeld ?? 46,
    mae: { value: over.mae ?? 3.0, date: '2026-01-10' },
    mfe: { value: over.mfe ?? 0.0, date: '2026-02-20' },
    outcome: 'expired',
    expiredItm: false,
    intrinsicAtExpiry: 0,
    assignmentDistancePct: 4,
  };
}

function openRec(over: Partial<{ mae: number; mfe: number; daysHeld: number }> = {}): AnalysisTradeRecord {
  return {
    ...BASE,
    pickDate: '2026-01-05',
    contractId: 'C1',
    entryMark: 2.0,
    daysHeld: over.daysHeld ?? 3,
    mae: { value: over.mae ?? 2.6, date: '2026-01-07' },
    mfe: { value: over.mfe ?? 1.4, date: '2026-01-06' },
    outcome: 'open',
    lastBarDate: '2026-01-08',
  };
}

function errorRec(contractId = 'C1'): AnalysisTradeRecord {
  return {
    ...BASE,
    pickDate: '2026-01-05',
    contractId,
    entryMark: 2.0,
    daysHeld: 0,
    mae: { value: 2.0, date: '2026-01-05' },
    mfe: { value: 2.0, date: '2026-01-05' },
    outcome: 'error',
    error: 'fetch failed',
  };
}

// ==========================
// Counts + hitRate
// ==========================

describe('aggregateExitType — counts + hitRatePct', () => {
  it('counts each outcome; hitRate denominator excludes errors', () => {
    const records = [exitRec(), expiredRec(), errorRec('C2'), errorRec('C3')];
    const a = aggregateExitType('target-90', 4, records);
    assert.equal(a.contractCount, 4);
    assert.equal(a.exitedCount, 1);
    assert.equal(a.expiredCount, 1);
    assert.equal(a.errorCount, 2);
    // 1 exit / (4 − 2 errors) = 50%
    assert.equal(a.hitRatePct, 50);
  });

  it('counts open positions; hitRate denominator excludes open AND error', () => {
    // 5 records: 1 exit, 1 expired, 2 open, 1 error → denom 5−2−1 = 2.
    const records = [
      exitRec(),
      expiredRec(),
      openRec(),
      { ...openRec(), contractId: 'C2' },
      errorRec('C3'),
    ];
    const a = aggregateExitType('target-90', 5, records);
    assert.equal(a.openCount, 2);
    assert.equal(a.errorCount, 1);
    // 1 exit / (5 − 2 open − 1 error) = 50%
    assert.equal(a.hitRatePct, 50);
  });

  it("hold-to-expiry's hit is REACHING expiry — numerator is expiredCount, not exitedCount (#1431)", () => {
    // expiry rule: 8 expired (3 ITM), 1 open, 1 error → denom 8, hits 8.
    const records = [
      ...Array.from({ length: 8 }, (_, i) => ({ ...expiredRec(), contractId: `E${i}` })),
      openRec(),
      errorRec('C9'),
    ];
    const a = aggregateExitType('expiry', 10, records);
    assert.equal(a.exitedCount, 0);
    assert.equal(a.expiredCount, 8);
    assert.equal(a.openCount, 1);
    assert.equal(a.hitRatePct, 100);
    // A firing rule over the same set still counts exits.
    const b = aggregateExitType('target-90', 10, records);
    assert.equal(b.hitRatePct, 0);
  });

  it('open excursions count toward MAE stats (live data, not placeholders)', () => {
    const records = [exitRec({ mae: 2.5 }), openRec({ mae: 4.1 }), errorRec('C9')];
    const a = aggregateExitType('stop-200', 3, records);
    assert.equal(a.worstMae, 4.1);
    assert.equal(a.maeP90, 4.1);
  });

  it('empty set → zero counts, all optional stats absent', () => {
    const a = aggregateExitType('expiry', 0, []);
    assert.deepEqual(a, {
      exitId: 'expiry',
      contractCount: 0,
      exitedCount: 0,
      expiredCount: 0,
      openCount: 0,
      errorCount: 0,
    });
  });

  it('all-error set → hitRatePct absent (denominator 0), no NaN', () => {
    const a = aggregateExitType('dte-21', 2, [errorRec('C1'), errorRec('C2')]);
    assert.equal(a.errorCount, 2);
    assert.equal(a.hitRatePct, undefined);
    assert.equal(a.worstMae, undefined);
    assert.equal(a.maeP50, undefined);
    assert.equal(a.maeP90, undefined);
    assert.equal(a.avgDaysToExit, undefined);
  });
});

// ==========================
// Exit-derived stats
// ==========================

describe('aggregateExitType — exit-derived stats', () => {
  it('avgDaysToExit is the mean over exited records only', () => {
    const records = [exitRec({ daysHeld: 4 }), exitRec({ daysHeld: 10, contractId: 'C2' }), expiredRec()];
    const a = aggregateExitType('target-90', 3, records);
    assert.equal(a.avgDaysToExit, 7);
  });

  it('avgPremiumCapturedPct = mean (entryMark − exitPrice)/entryMark ×100', () => {
    // (2−1)/2 = 50%, (2−0.4)/2 = 80% → mean 65
    const records = [
      exitRec({ entryMark: 2.0, exitPrice: 1.0 }),
      exitRec({ entryMark: 2.0, exitPrice: 0.4, contractId: 'C2' }),
    ];
    const a = aggregateExitType('target-90', 2, records);
    assert.equal(a.avgPremiumCapturedPct, 65);
  });

  it('avgDaysToExit/avgPremiumCapturedPct absent when nothing exited', () => {
    const a = aggregateExitType('expiry', 1, [expiredRec()]);
    assert.equal(a.avgDaysToExit, undefined);
    assert.equal(a.avgPremiumCapturedPct, undefined);
  });
});

// ==========================
// Excursion stats
// ==========================

describe('aggregateExitType — excursion stats', () => {
  it('worstMae is max mae over non-error; error excursion excluded', () => {
    const records = [
      exitRec({ mae: 3.5 }),
      expiredRec({ mae: 4.2 }),
      errorRec('C9'), // placeholder mae = entryMark 2.0 — must not count
    ];
    const a = aggregateExitType('stop-200', 3, records);
    assert.equal(a.worstMae, 4.2);
  });

  it('maeP50/maeP90 use nearest-rank over non-error records', () => {
    // maes 1,2,3,4,5 → p50 = 3rd (ceil(2.5)=3), p90 = 5th (ceil(4.5)=5)
    const records = [1, 2, 3, 4, 5].map((m, i) =>
      exitRec({ contractId: `C${i}`, mae: m }),
    );
    const a = aggregateExitType('target-90', 5, records);
    assert.equal(a.maeP50, 3);
    assert.equal(a.maeP90, 5);
  });

  it('single non-error record → all excursion stats = its mae', () => {
    const a = aggregateExitType('expiry', 2, [expiredRec({ mae: 2.6 }), errorRec('C2')]);
    assert.equal(a.worstMae, 2.6);
    assert.equal(a.maeP50, 2.6);
    assert.equal(a.maeP90, 2.6);
  });
});
