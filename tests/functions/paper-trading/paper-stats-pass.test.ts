/**
 * @topic #553 — Paper Trading Infra (task #565)
 *
 * Generalized paper-wide stats pass: one trade listing fans out to rollup
 * scopes across every dimension field — all, inst-*, var-*, cohort-*,
 * sig-*, sym-* — each written as a `paper-trading/stats/items/stats-{scope}`
 * doc via the shared recompute seam (equity curve + drawdown included).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TradeSide } from '../../../shared/common';
import {
  PaperTradingKind,
  PaperTradeSource,
  PaperTradeStatus,
} from '../../../shared/paper-trading-contracts';
import type { PaperTrade } from '../../../shared/paper-trading-contracts';
import {
  runPaperStatsPass,
  tradeScopes,
  type PaperStatsPassDeps,
} from '../../../functions/src/paper-trading/passes/paper-stats-pass';
import type { Position } from '../../../functions/src/paper-trading/engine/types';

function trade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 't-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 10,
    unrealizedPnl: -5,
    createdAt: '2026-09-25T12:00:00Z',
    updatedAt: '2026-09-25T12:00:00Z',
    ...overrides,
  };
}

function deps(trades: PaperTrade[]): PaperStatsPassDeps & {
  written: { scope: string; date: string; positions: Position[] }[];
} {
  const written: { scope: string; date: string; positions: Position[] }[] = [];
  return {
    written,
    listTrades: async () => trades,
    recomputeStats: async (scope, date, positions) => {
      written.push({ scope, date, positions });
    },
  };
}

describe('tradeScopes', () => {
  it('emits all + every populated dimension', () => {
    const t = trade({
      strategyInstanceId: 'inst-1',
      cohortId: 'cohort-1',
      signalId: 'sig-1',
      variantKeys: ['trailing-20', 'initial-stop-10'],
    });
    assert.deepEqual(tradeScopes(t).sort(), [
      'all',
      'cohort-1',
      'inst-inst-1',
      'sig-sig-1',
      'sym-QQQM',
      'var-initial-stop-10',
      'var-trailing-20',
    ]);
  });

  it('emits only all + sym when optional dims are absent', () => {
    assert.deepEqual(tradeScopes(trade({ symbol: 'spy' })).sort(), [
      'all',
      'sym-SPY',
    ]);
  });
});

describe('runPaperStatsPass', () => {
  const DATE = '2026-09-25';

  it('writes all + every derived scope from one trade listing', async () => {
    const t1 = trade({
      strategyInstanceId: 'inst-1',
      variantKeys: ['trailing-20'],
    });
    const t2 = trade({
      id: 't-2',
      symbol: 'AAPL',
      source: PaperTradeSource.SIGNAL,
      cohortId: 'cohort-9',
      signalId: 'sig-9',
      variantKeys: ['trailing-20', 'time-9d'],
    });
    const d = deps([t1, t2]);
    const res = await runPaperStatsPass(DATE, d);

    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.scopesWritten.sort(), [
      'all',
      'cohort-9',
      'inst-inst-1',
      'sig-sig-9',
      'sym-AAPL',
      'sym-QQQM',
      'var-time-9d',
      'var-trailing-20',
    ]);
    // 'all' sees both trades; cohort sees only t2.
    const all = d.written.find((w) => w.scope === 'all')!;
    assert.equal(all.positions.length, 2);
    assert.equal(all.date, DATE);
    const cohort = d.written.find((w) => w.scope === 'cohort-9')!;
    assert.equal(cohort.positions.length, 1);
    assert.equal(cohort.positions[0].id, 't-2');
    const variant = d.written.find((w) => w.scope === 'var-trailing-20')!;
    assert.equal(variant.positions.length, 2);
  });

  it('still writes an all-scope doc when no trades exist', async () => {
    const d = deps([]);
    const res = await runPaperStatsPass(DATE, d);
    assert.deepEqual(res.scopesWritten, ['all']);
    assert.equal(d.written[0].positions.length, 0);
  });

  it('isolates per-scope errors instead of aborting the pass', async () => {
    const d = deps([trade({ strategyInstanceId: 'inst-1' })]);
    const orig = d.recomputeStats;
    d.recomputeStats = async (scope, date, positions) => {
      if (scope === 'inst-inst-1') throw new Error('boom');
      return orig(scope, date, positions);
    };
    const res = await runPaperStatsPass(DATE, d);
    assert.deepEqual(res.scopesWritten, ['all', 'sym-QQQM']);
    assert.equal(res.errors.length, 1);
    assert.match(res.errors[0], /inst-inst-1.*boom/);
  });
});
