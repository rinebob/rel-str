/**
 * Unit tests for the IBS filter in detectAllStTrendRiderSignals / detectLastBarSignals
 * and the StrategyConfig → IbsFilterContext plumbing (task #1677, Thread #1665).
 *
 * Filter semantics (IMPL doc):
 * - LONG candidate emits when bar IBS >= T (default 0.5); SHORT when IBS <= 1 - T.
 * - IBS === undefined (bar too young — pre-activation) → filter not applicable → emit.
 * - Suppression skips emission only — the state machine still transitions to FIRED.
 * - Emitted signals record `indicators.ibs` (number | null) for auditability.
 * - `ibs` param omitted entirely → regression-identical unfiltered candidate list.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detectAllStTrendRiderSignals,
  detectLastBarSignals,
} from '../../functions/src/st-cloud-function/strategies/signal-detection';
import { ibsFilterFromConfig, execute } from '../../functions/src/st-cloud-function/strategies/st-trend-rider/st-trend-rider.strategy';
import type { OHLCV, StrategyInput } from '../../functions/src/st-cloud-function/strategies/base-strategy';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Bars where every bar has range [0,10] and the LAST bar's close yields the
 * requested IBS (close = ibs * 10). Earlier bars sit at IBS 0.5. Dates are
 * January 2026 — completed periods, always available.
 */
function signalBarIbs(ibs: number, n = 3): OHLCV[] {
  return Array.from({ length: n }, (_, i) => ({
    open: 5,
    high: 10,
    low: 0,
    close: i === n - 1 ? ibs * 10 : 5,
    date: `2026-01-${String(i + 12).padStart(2, '0')}`,
  }));
}

/** Per-bar IBS control: closes[i] = ibsValues[i] * 10. */
function barsFromIbs(ibsValues: number[]): OHLCV[] {
  return ibsValues.map((v, i) => ({
    open: 5,
    high: 10,
    low: 0,
    close: v * 10,
    date: `2026-01-${String(i + 12).padStart(2, '0')}`,
  }));
}

/** Long at index 2: zone flat +1 then upticks to +2 under a positive window. */
const LONG_ZONE = [1, 1, 2];
/** Short at index 2: zone flat -1 then downticks to -2 under a negative window. */
const SHORT_ZONE = [-1, -1, -2];

// ─── Long filter ──────────────────────────────────────────────────────────────

describe('IBS filter — long signals', () => {
  it('emits a long when the signal bar IBS is above the threshold (0.8)', () => {
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, signalBarIbs(0.8), 'V1', 'D', {},
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'LONG');
    assert.equal(signals[0].signalType, 'D_ST_TREND_RIDER_V1_LONG');
    assert.equal(signals[0].indicators.ibs, 0.8);
  });

  it('suppresses a long when the signal bar IBS is below the threshold (0.4)', () => {
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, signalBarIbs(0.4), 'V1', 'D', {},
    );
    assert.equal(signals.length, 0);
  });

  it('emits a long at exactly the threshold (IBS 0.5 — inclusive bound)', () => {
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, signalBarIbs(0.5), 'V1', 'D', {},
    );
    assert.equal(signals.length, 1);
  });

  it('V2 daily: same gating applies', () => {
    const suppressed = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, signalBarIbs(0.4), 'V2', 'D', {},
    );
    assert.equal(suppressed.length, 0);
    const emitted = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, signalBarIbs(0.9), 'V2', 'D', {},
    );
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].signalType, 'D_ST_TREND_RIDER_V2_LONG');
  });
});

// ─── Short filter ─────────────────────────────────────────────────────────────

describe('IBS filter — short signals', () => {
  it('emits a short when the signal bar IBS is below 1 - T (0.2)', () => {
    const signals = detectAllStTrendRiderSignals(
      SHORT_ZONE, SHORT_ZONE, signalBarIbs(0.2), 'V1', 'D', {},
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].action, 'SHORT');
    assert.equal(signals[0].indicators.ibs, 0.2);
  });

  it('suppresses a short when the signal bar IBS is above 1 - T (0.6)', () => {
    const signals = detectAllStTrendRiderSignals(
      SHORT_ZONE, SHORT_ZONE, signalBarIbs(0.6), 'V1', 'D', {},
    );
    assert.equal(signals.length, 0);
  });

  it('emits a short at exactly the bound (IBS 0.5 — inclusive)', () => {
    const signals = detectAllStTrendRiderSignals(
      SHORT_ZONE, SHORT_ZONE, signalBarIbs(0.5), 'V1', 'D', {},
    );
    assert.equal(signals.length, 1);
  });

  it('V1 weekly: a short on a completed-week bar is filtered the same way', () => {
    const bars = signalBarIbs(0.6);
    assert.equal(
      detectAllStTrendRiderSignals(SHORT_ZONE, SHORT_ZONE, bars, 'V1', 'W', {}).length,
      0,
    );
    const emitBars = signalBarIbs(0.2);
    const emitted = detectAllStTrendRiderSignals(SHORT_ZONE, SHORT_ZONE, emitBars, 'V1', 'W', {});
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].signalType, 'W_ST_TREND_RIDER_V1_SHORT');
  });

  it('inclusive bound holds for T where 1−T rounds below the literal (T=0.15, IBS=0.85)', () => {
    // 1 - 0.15 === 0.8499999999999999 in IEEE — an exact-0.85 bar must still emit.
    const signals = detectAllStTrendRiderSignals(
      SHORT_ZONE, SHORT_ZONE, signalBarIbs(0.85), 'V1', 'D', { threshold: 0.15 },
    );
    assert.equal(signals.length, 1);
  });
});

// ─── Threshold override ─────────────────────────────────────────────────────

describe('IBS filter — threshold override', () => {
  it('threshold 0.6: long suppressed at 0.55, emitted at 0.65', () => {
    assert.equal(
      detectAllStTrendRiderSignals(LONG_ZONE, LONG_ZONE, signalBarIbs(0.55), 'V1', 'D', { threshold: 0.6 }).length,
      0,
    );
    assert.equal(
      detectAllStTrendRiderSignals(LONG_ZONE, LONG_ZONE, signalBarIbs(0.65), 'V1', 'D', { threshold: 0.6 }).length,
      1,
    );
  });

  it('threshold 0.6: short bound tightens to 0.4 — IBS 0.5 suppressed', () => {
    assert.equal(
      detectAllStTrendRiderSignals(SHORT_ZONE, SHORT_ZONE, signalBarIbs(0.5), 'V1', 'D', { threshold: 0.6 }).length,
      0,
    );
    assert.equal(
      detectAllStTrendRiderSignals(SHORT_ZONE, SHORT_ZONE, signalBarIbs(0.4), 'V1', 'D', { threshold: 0.6 }).length,
      1,
    );
  });
});

// ─── Availability pass-through ──────────────────────────────────────────────

describe('IBS filter — developing-period availability', () => {
  // ET instants under EST (UTC−5).
  const TUE_0900_ET = new Date('2026-11-24T14:00:00Z');  // Tue 2026-11-24 09:00 ET
  const TUE_1300_ET = new Date('2026-11-24T18:00:00Z');  // Tue 2026-11-24 13:00 ET
  const MON_1000_ET = new Date('2026-11-23T15:00:00Z');  // Mon 2026-11-23 10:00 ET
  const WED_1000_ET = new Date('2026-11-25T15:00:00Z');  // Wed 2026-11-25 10:00 ET

  it('daily bar dated today + pre-activation now → IBS undefined → emits unfiltered', () => {
    const bars = signalBarIbs(0.4);
    bars[2].date = '2026-11-24'; // "today" in ET at TUE_0900_ET
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, bars, 'V1', 'D', { now: TUE_0900_ET },
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].indicators.ibs, null); // undefined → recorded null
  });

  it('daily bar dated today + post-activation now → filter applies (0.4 suppressed)', () => {
    const bars = signalBarIbs(0.4);
    bars[2].date = '2026-11-24';
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, bars, 'V1', 'D', { now: TUE_1300_ET },
    );
    assert.equal(signals.length, 0);
  });

  it('weekly bar in the current week + Monday now → IBS undefined → emits', () => {
    const bars = signalBarIbs(0.4);
    bars[2].date = '2026-11-25'; // Wed of the week containing Mon 11-23
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, bars, 'V2', 'W', { now: MON_1000_ET },
    );
    assert.equal(signals.length, 1);
  });

  it('weekly bar in the current week + Wednesday now → filter applies (0.4 suppressed)', () => {
    const bars = signalBarIbs(0.4);
    bars[2].date = '2026-11-25';
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, bars, 'V2', 'W', { now: WED_1000_ET },
    );
    assert.equal(signals.length, 0);
  });

  it('weekly emitted on activation day carries the computed IBS', () => {
    const bars = signalBarIbs(0.8);
    bars[2].date = '2026-11-25';
    const signals = detectAllStTrendRiderSignals(
      LONG_ZONE, LONG_ZONE, bars, 'V2', 'W', { now: WED_1000_ET },
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].signalType, 'W_ST_TREND_RIDER_V2_LONG');
    assert.equal(signals[0].indicators.ibs, 0.8);
  });
});

// ─── State-machine integrity ────────────────────────────────────────────────

describe('IBS filter — state machine integrity', () => {
  it('a suppressed uptick still consumes FIRED — a continued uptick does not re-fire', () => {
    // i=2 uptick suppressed (IBS 0.4) → FIRED; i=3 uptick while FIRED → nothing.
    const signals = detectAllStTrendRiderSignals(
      [1, 1, 2, 3], [1, 1, 2, 3], barsFromIbs([0.5, 0.5, 0.4, 0.9]), 'V1', 'D', {},
    );
    assert.equal(signals.length, 0);
  });

  it('re-arm then a new uptick emits a new signal filtered on its own bar', () => {
    // i=2 suppressed; i=3 delta<0 re-arms; i=4 uptick passes IBS 0.9 → emits.
    const signals = detectAllStTrendRiderSignals(
      [1, 1, 2, 1, 2], [1, 1, 2, 1, 2], barsFromIbs([0.5, 0.5, 0.4, 0.5, 0.9]), 'V1', 'D', {},
    );
    assert.equal(signals.length, 1);
    assert.equal(signals[0].index, 4);
    assert.equal(signals[0].indicators.ibs, 0.9);
  });

  it('re-arm then a new uptick on a failing bar is suppressed too', () => {
    const signals = detectAllStTrendRiderSignals(
      [1, 1, 2, 1, 2], [1, 1, 2, 1, 2], barsFromIbs([0.5, 0.5, 0.4, 0.5, 0.3]), 'V1', 'D', {},
    );
    assert.equal(signals.length, 0);
  });

  it('omitted ibs param → regression-identical candidate list', () => {
    const zones = [1, 1, 2, 1, 2];
    const bars = barsFromIbs([0.5, 0.5, 0.4, 0.5, 0.3]);
    const unfiltered = detectAllStTrendRiderSignals(zones, zones, bars, 'V1', 'D');
    assert.equal(unfiltered.length, 2); // both upticks emit
    assert.deepEqual(unfiltered.map(s => s.index), [2, 4]);
    // indicators still record the computed IBS for auditability.
    assert.equal(unfiltered[0].indicators.ibs, 0.4);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('IBS filter — edge cases', () => {
  it('zero-range signal bar (H==L → IBS 0.5) emits at the default threshold', () => {
    const bars: OHLCV[] = signalBarIbs(0.5);
    bars[2] = { open: 5, high: 5, low: 5, close: 5, date: '2026-01-14' };
    const signals = detectAllStTrendRiderSignals(LONG_ZONE, LONG_ZONE, bars, 'V1', 'D', {});
    assert.equal(signals.length, 1);
    assert.equal(signals[0].indicators.ibs, 0.5);
  });

  it('signal bar with missing H/L/C → IBS undefined → emits (filter not applicable)', () => {
    const bars: OHLCV[] = signalBarIbs(0.4);
    bars[2] = { date: '2026-01-14' };
    const signals = detectAllStTrendRiderSignals(LONG_ZONE, LONG_ZONE, bars, 'V1', 'D', {});
    assert.equal(signals.length, 1);
    assert.equal(signals[0].indicators.ibs, null);
  });

  it('detectLastBarSignals applies the filter — suppressed last bar returns null', () => {
    const bars = signalBarIbs(0.4);
    const unfiltered = detectLastBarSignals(LONG_ZONE, LONG_ZONE, bars, 'V1', 'D');
    assert.ok(unfiltered);
    const filtered = detectLastBarSignals(LONG_ZONE, LONG_ZONE, bars, 'V1', 'D', {});
    assert.equal(filtered, null);
  });
});

// ─── execute() integration ──────────────────────────────────────────────────

/**
 * 49-bar synthetic path that produces a V1 daily uptick on the LAST bar
 * (zone tail …2→3; pinned against the real band/zone computation):
 * 42-bar +1% drift, 5-bar −1% pullback, one +1% bar, then a wide-range
 * last bar (high = open×1.03, low = open×0.995) whose close placement
 * sets its IBS — closePct 1.01 → IBS ≈ 0.43, closePct 1.025 → IBS ≈ 0.86.
 */
function strategyInput(lastClosePct: number): StrategyInput {
  const bars: OHLCV[] = [];
  let p = 100;
  const push = (o: number, c: number) => {
    // Monotonic dates from 2026-01-01 — all safely in the past, so IBS is
    // defined under the real wall clock (execute() injects no `now` by design).
    const d = new Date(Date.UTC(2026, 0, 1 + bars.length)).toISOString().slice(0, 10);
    bars.push({
      open: o, high: Math.max(o, c) * 1.004, low: Math.min(o, c) * 0.996, close: c,
      date: d,
    });
  };
  for (let i = 0; i < 42; i++) { const c = p * 1.01; push(p, c); p = c; }
  for (let i = 0; i < 5; i++) { const c = p * 0.99; push(p, c); p = c; }
  { const c = p * 1.01; push(p, c); p = c; }
  bars.push({
    open: p, high: p * 1.03, low: p * 0.995, close: p * lastClosePct,
    date: new Date(Date.UTC(2026, 0, 1 + bars.length)).toISOString().slice(0, 10),
  });
  return { symbol: 'TEST', marketDate: '2026-02-18', bars };
}

describe('execute() — IBS filter end to end', () => {
  it('suppresses the V1 daily long when the last bar closes in the lower half (IBS ≈ 0.43)', () => {
    const out = execute(strategyInput(1.01), { ibsThreshold: 0.5 });
    assert.equal(out.filter(s => s.signalType === 'D_ST_TREND_RIDER_V1_LONG').length, 0);
  });

  it('emits the V1 daily long when the last bar closes in the upper half (IBS ≈ 0.86)', () => {
    const out = execute(strategyInput(1.025), { ibsThreshold: 0.5 });
    const longs = out.filter(s => s.signalType === 'D_ST_TREND_RIDER_V1_LONG');
    assert.equal(longs.length, 1);
    assert.equal(longs[0].action, 'LONG');
    const ibs = longs[0].indicators?.ibs;
    assert.ok(typeof ibs === 'number' && ibs > 0.8);
  });

  it('empty config still gates at the default threshold', () => {
    const out = execute(strategyInput(1.01), {});
    assert.equal(out.filter(s => s.signalType === 'D_ST_TREND_RIDER_V1_LONG').length, 0);
  });
});

// ─── StrategyConfig plumbing ────────────────────────────────────────────────

describe('ibsFilterFromConfig — StrategyConfig → IbsFilterContext', () => {
  it('maps the documented keys', () => {
    const filter = ibsFilterFromConfig({
      ibsThreshold: 0.6,
      ibsActivateAtEtMin: 600,
      ibsActivateAtWeekday: 4,
    });
    assert.equal(filter.threshold, 0.6);
    assert.equal(filter.activateAtEtMin, 600);
    assert.equal(filter.activateAtWeekday, 4);
    assert.equal(filter.now, undefined); // wall clock is the run's truth — never set here
  });

  it('empty config → defaults left to the filter', () => {
    const filter = ibsFilterFromConfig({});
    assert.equal(filter.threshold, undefined);
    assert.equal(filter.activateAtEtMin, undefined);
    assert.equal(filter.activateAtWeekday, undefined);
  });

  it('non-numeric values are ignored', () => {
    const filter = ibsFilterFromConfig({ ibsThreshold: 'high' });
    assert.equal(filter.threshold, undefined);
  });
});
