/**
 * Unit tests for `evaluateExit` — pure per-kind exit evaluators
 * (Topic #1238, Thread #1266, task #1371). No network, no Firestore —
 * synthetic `{date, mark}` series only.
 *
 * Covers TEST-BE §Exit evaluators:
 * - target-pct-premium / absolute-price / stop-pct-premium / dte-time:
 *   fires on first qualifying day, inclusive boundaries, never-fires case
 * - hold-to-expiry: never fires
 * - non-termination: each rule scans the SAME series independently — one
 *   rule's early fire never truncates another's scan
 * - MAE/MFE over the rule's own entry→exit window only (not beyond)
 * - same-day exit → dayIndex 0
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateExit,
  type ExitScanBar,
} from '../../../functions/src/options-analysis/exit-evaluators';
import type { ExitStrategyDef } from '@options-analysis/registry';
import { EXIT_STRATEGIES, getExitStrategy } from '@options-analysis/registry';

// ==========================
// Fixtures
// ==========================

const EXPIRY = '2026-02-20';
const ENTRY = 2.0;

function series(...marks: [date: string, mark: number][]): ExitScanBar[] {
  return marks.map(([date, mark]) => ({ date, mark }));
}

const rule = (exitId: string): ExitStrategyDef => {
  const r = getExitStrategy(exitId);
  assert.ok(r, `seed '${exitId}' must exist`);
  return r;
};

// ==========================
// target-pct-premium
// ==========================

describe('target-pct-premium (target-90: mark <= entry*0.10)', () => {
  it('fires on the first day mark hits the threshold, inclusive', () => {
    // entry 2.00, target-90 → threshold is 0.1999…96 in IEEE (this is
    // the float-noise case EPS exists to absorb, not an exact boundary)
    const s = series(
      ['2026-01-05', 2.0],
      ['2026-01-06', 0.21],
      ['2026-01-07', 0.2], // == threshold → fires here
      ['2026-01-08', 0.05],
    );
    const r = evaluateExit(s, ENTRY, rule('target-90'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.exitDate, '2026-01-07');
      assert.equal(r.exitPrice, 0.2);
      assert.equal(r.dayIndex, 2);
    }
  });

  it('does not fire when the threshold is never reached', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 0.5], ['2026-01-07', 0.21]);
    const r = evaluateExit(s, ENTRY, rule('target-90'), EXPIRY);
    assert.equal(r.fired, false);
    // Full-window excursion even when nothing fires.
    assert.deepEqual(r.mae, { value: 2.0, date: '2026-01-05' });
    assert.deepEqual(r.mfe, { value: 0.21, date: '2026-01-07' });
  });
});

// ==========================
// absolute-price
// ==========================

describe('absolute-price (price-100 / price-50)', () => {
  it('fires at the exact $1.00 boundary, inclusive', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 1.0]);
    const r = evaluateExit(s, ENTRY, rule('price-100'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) assert.equal(r.exitPrice, 1.0);
  });

  it('does not fire at $1.01 (just above) but does at $0.50 boundary', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 1.01], ['2026-01-07', 0.5]);
    const r100 = evaluateExit(s, ENTRY, rule('price-100'), EXPIRY);
    assert.equal(r100.fired, true);
    if (r100.fired) assert.equal(r100.exitDate, '2026-01-07'); // 1.01 did NOT fire $1.00
    const r50 = evaluateExit(s, ENTRY, rule('price-50'), EXPIRY);
    assert.equal(r50.fired, true);
    if (r50.fired) assert.equal(r50.exitDate, '2026-01-07');
  });

  it('does not fire when the mark never reaches the price', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 0.6], ['2026-01-07', 0.51]);
    const r = evaluateExit(s, ENTRY, rule('price-50'), EXPIRY);
    assert.equal(r.fired, false);
  });
});

// ==========================
// stop-pct-premium
// ==========================

describe('stop-pct-premium (stop-200: mark >= entry*2)', () => {
  it('fires at exactly 2× entry, inclusive', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 3.99], ['2026-01-07', 4.0]);
    const r = evaluateExit(s, ENTRY, rule('stop-200'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.exitDate, '2026-01-07');
      assert.equal(r.exitPrice, 4.0);
      // The firing bar IS in the excursion window — adverse side too.
      assert.deepEqual(r.mae, { value: 4.0, date: '2026-01-07' });
    }
  });

  it('never fires on favorable (declining) marks', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 1.0], ['2026-01-07', 0.1]);
    const r = evaluateExit(s, ENTRY, rule('stop-200'), EXPIRY);
    assert.equal(r.fired, false);
    assert.deepEqual(r.mfe, { value: 0.1, date: '2026-01-07' });
  });
});

// ==========================
// dte-time
// ==========================

describe('dte-time (dte-21: remaining DTE <= 21)', () => {
  it('fires on the first bar whose remaining DTE is <= 21', () => {
    // expiry 2026-02-20 → remaining 22 on 01-29, 21 on 01-30
    const s = series(
      ['2026-01-05', 2.0],
      ['2026-01-29', 1.5],
      ['2026-01-30', 1.4],
      ['2026-02-20', 0.0],
    );
    const r = evaluateExit(s, ENTRY, rule('dte-21'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.exitDate, '2026-01-30'); // remaining = 21, inclusive
      assert.equal(r.dayIndex, 2);
    }
  });

  it('does not fire before the DTE bound even late in the series', () => {
    const s = series(['2026-01-28', 1.0]); // remaining 23 → no fire, and series ends
    const r = evaluateExit(s, ENTRY, rule('dte-21'), EXPIRY);
    assert.equal(r.fired, false);
  });

  it('fires when the series starts on the expiry bar (remaining 0)', () => {
    const s = series(['2026-02-20', 0.0]);
    const r = evaluateExit(s, ENTRY, rule('dte-21'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.exitDate, '2026-02-20');
      assert.equal(r.dayIndex, 0);
    }
  });
});

// ==========================
// hold-to-expiry
// ==========================

describe('hold-to-expiry (expiry)', () => {
  it('never fires; excursion covers the whole series', () => {
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 5.0], ['2026-02-20', 0.0]);
    const r = evaluateExit(s, ENTRY, rule('expiry'), EXPIRY);
    assert.equal(r.fired, false);
    assert.deepEqual(r.mae, { value: 5.0, date: '2026-01-06' });
    assert.deepEqual(r.mfe, { value: 0.0, date: '2026-02-20' });
  });
});

// ==========================
// Non-termination property (PRD story 6)
// ==========================

describe('non-termination — rules scan independently', () => {
  it('an early-firing rule does not truncate other rules scans', () => {
    // price-100 fills day 2; the SAME series still yields complete
    // dte-21 and expiry scans to the last bar.
    const s = series(
      ['2026-01-05', 2.0],
      ['2026-01-06', 1.0], // price-100 fires here
      ['2026-01-30', 1.5], // dte-21 fires here (remaining 21)
      ['2026-02-20', 1.2],
    );
    const results = Object.fromEntries(
      EXIT_STRATEGIES.map((r) => [r.exitId, evaluateExit(s, ENTRY, r, EXPIRY)]),
    );
    const { 'target-90': target90, 'price-100': price100, 'price-50': price50,
      'stop-200': stop200, 'dte-21': dte21, expiry } = results;
    assert.equal(target90.fired, false);
    assert.equal(price100.fired, true);
    assert.equal(price50.fired, false);
    assert.equal(stop200.fired, false);
    assert.equal(dte21.fired, true);
    assert.equal(expiry.fired, false);
    // Expiry's excursion still saw the last bar (full window).
    assert.deepEqual(expiry.mfe, { value: 1.0, date: '2026-01-06' });
    assert.deepEqual(expiry.mae, { value: 2.0, date: '2026-01-05' });
  });
});

// ==========================
// MAE/MFE window discipline
// ==========================

describe('MAE/MFE — entry→exit window only', () => {
  it('ignores marks beyond the exit bar', () => {
    const s = series(
      ['2026-01-05', 2.0],
      ['2026-01-06', 3.0], // in-window worst
      ['2026-01-07', 1.0], // price-100 exits here
      ['2026-01-08', 9.9], // beyond exit — must NOT count
      ['2026-01-09', 0.01], // beyond exit — must NOT count
    );
    const r = evaluateExit(s, ENTRY, rule('price-100'), EXPIRY);
    assert.equal(r.fired, true);
    assert.deepEqual(r.mae, { value: 3.0, date: '2026-01-06' });
    assert.deepEqual(r.mfe, { value: 1.0, date: '2026-01-07' });
    // And the whole-series scan (expiry) DOES see them.
    const all = evaluateExit(s, ENTRY, rule('expiry'), EXPIRY);
    assert.deepEqual(all.mae, { value: 9.9, date: '2026-01-08' });
    assert.deepEqual(all.mfe, { value: 0.01, date: '2026-01-09' });
  });
});

// ==========================
// Post-expiry clip
// ==========================

describe('post-expiry bars are clipped from the scan', () => {
  const s = series(
    ['2026-01-05', 2.0],
    ['2026-01-06', 0.8],
    ['2026-02-21', 9.9], // AFTER expiry 2026-02-20 — dead contract;
    ['2026-02-25', 0.3], // 0.3 would satisfy price-50 if scanned
  );

  it('a mark rule cannot fire on a post-expiry bar', () => {
    const r = evaluateExit(s, ENTRY, rule('price-50'), EXPIRY);
    assert.equal(r.fired, false);
    // Dead-contract marks don't leak into excursion on EITHER side —
    // 9.9 would take mae if scanned; 0.3 would take mfe.
    assert.deepEqual(r.mae, { value: 2.0, date: '2026-01-05' });
    assert.deepEqual(r.mfe, { value: 0.8, date: '2026-01-06' });
  });

  it('a mark rule CAN fire on the expiry bar itself (clip is strict >)', () => {
    const onExpiry = series(['2026-01-05', 2.0], ['2026-02-20', 0.4]);
    const r = evaluateExit(onExpiry, ENTRY, rule('price-50'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.exitDate, '2026-02-20');
      assert.equal(r.dayIndex, 1);
    }
  });

  it('dte-time does not fire on post-expiry bars either', () => {
    // Last live bar (01-06) has remaining 45 > 21 → no fire; the
    // post-expiry bars (negative remaining) would satisfy <= 21
    // trivially if they were scanned — the clip is what makes this false.
    const r = evaluateExit(s, ENTRY, rule('dte-21'), EXPIRY);
    assert.equal(r.fired, false);
  });

  it('a rule that fires pre-expiry is unaffected by a post-expiry tail', () => {
    const r = evaluateExit(s, ENTRY, rule('price-100'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.exitDate, '2026-01-06');
      // Excursion stops at the exit bar AND can't see the tail.
      assert.deepEqual(r.mae, { value: 2.0, date: '2026-01-05' });
      assert.deepEqual(r.mfe, { value: 0.8, date: '2026-01-06' });
    }
  });
});

// ==========================
// Boundary guards + degenerate input
// ==========================

describe('same-day exit + degenerate input', () => {
  it('fires on the pick-day bar itself → dayIndex 0', () => {
    const s = series(['2026-01-05', 0.5]); // already ≤ $1.00 at entry day
    const r = evaluateExit(s, ENTRY, rule('price-100'), EXPIRY);
    assert.equal(r.fired, true);
    if (r.fired) {
      assert.equal(r.dayIndex, 0);
      assert.equal(r.exitDate, '2026-01-05');
    }
  });

  it('a mark genuinely above the threshold does NOT fire (EPS is not a fudge)', () => {
    // 0.200001 vs target-90 threshold 0.1999…96 — real gap ~1e-6 >> 1e-9.
    const s = series(['2026-01-05', 2.0], ['2026-01-06', 0.200001]);
    const r = evaluateExit(s, ENTRY, rule('target-90'), EXPIRY);
    assert.equal(r.fired, false);
  });

  it('first occurrence wins excursion ties', () => {
    const s = series(
      ['2026-01-05', 2.0],
      ['2026-01-06', 3.0], // first max
      ['2026-01-07', 3.0], // tied max — date must stay 01-06
      ['2026-01-08', 0.4], // first min
      ['2026-01-09', 0.4], // tied min — date must stay 01-08
    );
    const r = evaluateExit(s, ENTRY, rule('expiry'), EXPIRY);
    assert.deepEqual(r.mae, { value: 3.0, date: '2026-01-06' });
    assert.deepEqual(r.mfe, { value: 0.4, date: '2026-01-08' });
  });

  it('empty series → not fired, entry-day placeholder excursion', () => {
    const r = evaluateExit([], ENTRY, rule('target-90'), EXPIRY);
    assert.equal(r.fired, false);
    assert.deepEqual(r.mae, { value: ENTRY, date: '' });
    assert.deepEqual(r.mfe, { value: ENTRY, date: '' });
  });
});
