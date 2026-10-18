/**
 * @topic #553 — Paper Trading Infra · Thread #1059 (task #1078)
 *
 * Replay pass: per symbol in scope, load SDS daily bars → compute zones →
 * detectAllStTrendRiderSignals (the real detector — never a reimpl) →
 * filter to params (signalTypes ∩ barRange) → walk each signal forward on
 * daily closes under the exit-registry grammar via evaluateVariant →
 * TradeAnalysisRow (modeled lifecycle, excursionSource 'replay') →
 * writeDataset. Specs inject a canned detector for walk coverage and a
 * spy to prove the seam is honored; the prod deps wire the real
 * detector + registry evaluator (pinned by the wiring spec + the AMAT
 * parity relay in #1079).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PaperTradeStatus } from '../../../shared/paper-trading-contracts';
import { TradeSide } from '../../../shared/common';
import {
  AnalysisCohort,
  type AnalysisRunParams,
  type TradeAnalysisRow,
} from '../../../shared/analysis-dataset-contracts';
import type { OhlcBar } from '../../../functions/src/common/market-data-types';
import { evaluateVariant } from '../../../functions/src/paper-trading/exits/registry';
import { detectAllStTrendRiderSignals } from '../../../functions/src/st-cloud-function/strategies/signal-detection';
import type { ZoneSignal } from '../../../functions/src/st-cloud-function/strategies/signal-detection';
import {
  runReplay,
  replaySignalToRow,
  replayDeps,
  type ReplayDeps,
} from '../../../functions/src/paper-trading/analysis/replay';

const DS = 'ds-20261020-replay-deadbeef';

const PARAMS: AnalysisRunParams = {
  origin: 'replay',
  symbolScope: ['AMAT'],
  signalTypes: [],
  exitRule: 'trailing-8',
  barRange: { from: '2020-01-01', to: '2026-12-31' },
  entryConvention: 'signal-bar-close',
};

/** 60 monotone bars starting 2026-01-01 — enough history for zone/strength. */
function flatBars(start = '2026-01-01', n = 60, base = 100): OhlcBar[] {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(startMs + i * 86400000).toISOString().slice(0, 10);
    return { d, o: base, h: base + 0.5, l: base - 0.5, c: base };
  });
}

/** Bars with a run-up then a drawdown — trailing-8 fires on the drawdown. */
function trailBars(): OhlcBar[] {
  const bars = flatBars();
  // signal at index 20 (close 100); then rally to 120 hwm, drop to 110
  // → 110 <= 120*0.92 = 110.4 fires.
  const closes = [...Array(21).fill(100), 105, 112, 120, 118, 110, 112, 115];
  closes.forEach((c, i) => {
    bars[i].c = c;
    bars[i].h = c + 0.5;
    bars[i].l = c - 0.5;
  });
  return bars;
}

const LONG_SIG: ZoneSignal = {
  action: 'LONG' as never,
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  reason: 'test',
  index: 20,
  indicators: { zoneV2: 4, zoneV2Prev: 3, windowV2: 1, delta: 1 },
};

function deps(overrides: Partial<ReplayDeps> = {}): ReplayDeps & {
  rows: TradeAnalysisRow[];
  detectCalls: number;
} {
  const state = { rows: [] as TradeAnalysisRow[], detectCalls: 0 };
  return {
    get rows() { return state.rows; },
    get detectCalls() { return state.detectCalls; },
    listSymbols: async () => ['AMAT'],
    loadDailyBars: async () => trailBars(),
    // V1 returns nothing, V2 returns the canned signal — mirrors reality
    // (each version emits its own signalType) and keeps row counts honest.
    detectSignals: (_z, _w, _b, version) => {
      state.detectCalls++;
      return version === 'V2' ? [LONG_SIG] : [];
    },
    evaluateExit: evaluateVariant,
    writeDataset: async (rows) => {
      state.rows.push(...rows);
    },
    ...overrides,
  };
}

describe('replaySignalToRow — modeled lifecycle', () => {
  const strength = {
    'strength.diPlus': 30,
    'strength.diMinus': 20,
    'strength.diHist': 10,
    'strength.adx': 25,
  };

  it('trailing-8 fires → CLOSED, exit at the mark, registry reason', () => {
    const bars = trailBars();
    const row = replaySignalToRow(LONG_SIG, 'AMAT', bars, strength, PARAMS, DS);
    assert.equal(row.status, PaperTradeStatus.CLOSED);
    assert.equal(row.exitDate, bars[25].d);
    assert.equal(row.exitPrice, 110);
    assert.equal(row.exitReason, 'trailing-8');
    assert.equal(row.tradeRetPct, 10); // (110-100)/100
    assert.equal(row.symbolMovePct, 10);
    assert.equal(row.excursionSource, 'replay');
    assert.equal(row.source, 'replay');
    assert.equal(row.analysisCohort, AnalysisCohort.SIGNAL_EQUITY);
    assert.equal(row.direction, TradeSide.LONG);
    assert.equal(row.entryDate, bars[20].d);
    assert.equal(row.entryPrice, 100);
    assert.equal(row.signalBarDate, bars[20].d);
    assert.ok((row.daysHeld ?? 0) > 0);
    // excursion from intraday extremes: hwm 120.5 → mfe ~20.5%
    assert.ok((row.mfePct ?? 0) > 20);
    assert.equal(row.mfeDate, bars[23].d);
    assert.ok(row.givebackRatio !== null && row.givebackRatio > 0);
    // stamped indicators + strength at signal index
    assert.equal(row['ind.zoneV2'], 4);
    assert.equal(row['ind.delta'], 1);
    assert.equal(row['strength.diPlus'], 30);
    assert.equal(row.tradeId, `replay-AMAT-${bars[20].d.replaceAll('-', '')}-V2L`);
    // modeled rows carry no ledger provenance
    assert.equal(row.signalId, null);
    assert.equal(row.realizedPnl, null);
    assert.equal(row.qty, null);
  });

  it('short signal → direction-aware ret/mfe/mae', () => {
    const bars = flatBars();
    // entry 100 at idx 20; slide to 92 (fav for short), bounce to 99
    const closes = [...Array(21).fill(100), 96, 92, 94, 99, 97];
    closes.forEach((c, i) => {
      bars[i].c = c;
      bars[i].h = c + 0.5;
      bars[i].l = c - 0.5;
    });
    const sig: ZoneSignal = {
      ...LONG_SIG,
      signalType: 'D_ST_TREND_RIDER_V2_SHORT',
      action: 'SHORT' as never,
      indicators: { zoneV2: -4, zoneV2Prev: -3, windowV2: -1, delta: -1 },
    };
    const row = replaySignalToRow(sig, 'AMAT', bars, strength, PARAMS, DS);
    // low-water 92 → trailing-8 fires when c >= 92*1.08 = 99.36; last shown
    // c=97 stays under → OPEN vs last close 97? walk continues flat 100s →
    // c=100 >= 99.36 fires on bar 26.
    assert.equal(row.status, PaperTradeStatus.CLOSED);
    assert.equal(row.exitPrice, 100);
    assert.ok(Math.abs(row.tradeRetPct ?? NaN) < 1e-9); // (100-100)/100 * -1
    assert.ok(Math.abs(row.symbolMovePct ?? NaN) < 1e-9);
    // mfe for a short: entry - lowest low (92-0.5=91.5) → +8.5%
    assert.ok(row.mfePct !== null && row.mfePct > 8);
    // mae for a short: highest high seen (bar 25 c=99 → h=99.5) → -0.5%
    assert.ok(row.maePct !== null && row.maePct < 0);
    assert.match(row.tradeId, /-V2S$/);
  });

  it('no trigger → OPEN, null exits, provisional ret vs last close', () => {
    const bars = flatBars(); // flat 100s — nothing fires
    const row = replaySignalToRow(LONG_SIG, 'AMAT', bars, strength, PARAMS, DS);
    assert.equal(row.status, PaperTradeStatus.OPEN);
    assert.equal(row.exitDate, null);
    assert.equal(row.exitPrice, null);
    assert.equal(row.exitReason, null);
    assert.equal(row.daysHeld, null);
    assert.equal(row.tradeRetPct, 0);
  });

  it('never-favorable trade → negative mfePct (least-bad observation, live convention)', () => {
    const bars = flatBars();
    // entry 100 at idx 20; everything below entry forever after
    for (let i = 21; i < bars.length; i++) {
      bars[i] = { ...bars[i], o: 95, h: 96, l: 94, c: 95 };
    }
    const row = replaySignalToRow(LONG_SIG, 'AMAT', bars, strength, PARAMS, DS);
    assert.ok(row.mfePct !== null && row.mfePct < 0); // best seen: h=96 → -4%
    assert.ok((row.maePct ?? 0) < row.mfePct!);
  });

  it('time-10d fires on daysHeld; initial-stop fires on adverse close', () => {
    const bars = flatBars();
    const timeRow = replaySignalToRow(
      LONG_SIG, 'AMAT', bars, strength,
      { ...PARAMS, exitRule: 'time-10d' }, DS,
    );
    assert.equal(timeRow.status, PaperTradeStatus.CLOSED);
    assert.equal(timeRow.exitReason, 'time-10d');
    assert.equal(timeRow.daysHeld, 10);

    const drop = trailBars();
    drop[21] = { ...drop[21], c: 90, h: 90.5, l: 89.5 }; // -10% close
    const stopRow = replaySignalToRow(
      LONG_SIG, 'AMAT', drop, strength,
      { ...PARAMS, exitRule: 'initial-stop-8' }, DS,
    );
    assert.equal(stopRow.status, PaperTradeStatus.CLOSED);
    assert.equal(stopRow.exitReason, 'initial-stop-8');
    assert.equal(stopRow.exitPrice, 90);
    assert.equal(stopRow.tradeRetPct, -10);
  });
});

describe('runReplay — pass behavior', () => {
  it('rows accumulate per symbol; writeDataset gets them all', async () => {
    const d = deps();
    await runReplay(PARAMS, DS, d);
    assert.equal(d.rows.length, 1);
    assert.equal(d.rows[0].symbol, 'AMAT');
    assert.equal(d.detectCalls, 2); // V1 + V2 detection runs
  });

  it('detectSignals + evaluateExit seams honored (spy)', async () => {
    let evalCalls = 0;
    const d = deps({
      evaluateExit: (ctx) => {
        evalCalls++;
        return evaluateVariant(ctx);
      },
    });
    await runReplay(PARAMS, DS, d);
    assert.ok(d.detectCalls > 0);
    assert.ok(evalCalls > 0);
  });

  it('signalTypes + barRange.from filter signals', async () => {
    const d = deps({
      detectSignals: (_z, _w, _b, version) =>
        version === 'V2' ? [LONG_SIG] : [],
    });
    // V1 filter drops the V2 signal entirely
    const d1 = deps({
      detectSignals: (_z, _w, _b, version) =>
        version === 'V2' ? [LONG_SIG] : [],
    });
    await runReplay({ ...PARAMS, signalTypes: ['D_ST_TREND_RIDER_V1_LONG'] }, DS, d);
    assert.equal(d.rows.length, 0);
    await runReplay({ ...PARAMS, signalTypes: ['D_ST_TREND_RIDER_V2_LONG'] }, DS, d1);
    assert.equal(d1.rows.length, 1);
    // barRange.from past the signal date → dropped
    const bars = trailBars();
    const d2 = deps();
    await runReplay(
      { ...PARAMS, barRange: { from: '2099-01-01', to: '2099-12-31' } },
      DS, d2,
    );
    assert.equal(d2.rows.length, 0);
    void bars;
  });

  it('missing/empty bars → symbol logged + skipped, run completes', async () => {
    const d = deps({
      listSymbols: async () => ['AMAT', 'NOBARS'],
      loadDailyBars: async (s) => (s === 'NOBARS' ? [] : trailBars()),
    });
    const rows = await runReplay({ ...PARAMS, symbolScope: [] }, DS, d);
    assert.equal(rows, 1);
    assert.equal(d.rows.length, 1);
  });

  it('empty symbolScope → listSymbols enumerates the universe', async () => {
    let listed = 0;
    const d = deps({
      listSymbols: async () => {
        listed++;
        return ['AMAT'];
      },
    });
    await runReplay({ ...PARAMS, symbolScope: [] }, DS, d);
    assert.equal(listed, 1);
  });

  it('prod deps wire the REAL detector + registry evaluator', () => {
    const real = replayDeps();
    assert.equal(real.detectSignals, detectAllStTrendRiderSignals);
    assert.equal(real.evaluateExit, evaluateVariant);
  });
});
