/**
 * @topic #553 — Paper Trading Infra (task #1574)
 *
 * Unit tests for `selectGoverningRun` — the curated governing policy
 * ('deepest-stop-else-trailing-8') — and the `smaAt` indicator helper.
 * Pure functions: fixture runs + levels in, a VariantRun (or undefined)
 * out.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type VariantRun,
} from '../../../shared/paper-trading-contracts';
import { selectGoverningRun, smaAt } from '../../../functions/src/paper-trading/exits/governing-policy';
import type { OhlcBar } from '../../../functions/src/common/market-data-types';

function makeTrade(side: TradeSide, entry = 80, overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 't-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'EQ',
    governingVariant: 'trailing-8',
    governingPolicy: 'deepest-stop-else-trailing-8',
    order: { side, type: 'MARKET', quantity: 1 },
    fills: [
      { fillId: 'entry-t-1', role: 'entry', date: '2026-09-01', price: entry, quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS },
    ],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: '2026-09-01T12:00:00Z',
    updatedAt: '2026-09-01T12:00:00Z',
    ...overrides,
  };
}

function run(variantKey: string, state: 'ACTIVE' | 'EXITED' = 'ACTIVE', workingState: Record<string, number> = {}): VariantRun {
  return { variantKey, governing: variantKey === 'trailing-8', state, workingState };
}

describe('selectGoverningRun — long side (#1574)', () => {
  const trade = makeTrade(TradeSide.LONG, 80);

  it('picks the deepest level below the mark', () => {
    // mark 100, watermark 100 → trailing-5 level 95, trailing-8 92; sma20 90.
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
      { trade, mark: 100, indicators: { sma: { 20: 90 } } },
    );
    assert.equal(pick?.variantKey, 'ma-close-20'); // 90 < 92 < 95 → deepest
  });

  it('falls back to trailing-8 when the deepest level sits below entry', () => {
    // entry 95 → deepest (sma 90) is below entry → trailing-8 governs.
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
      { trade: makeTrade(TradeSide.LONG, 95), mark: 100, indicators: { sma: { 20: 90 } } },
    );
    assert.equal(pick?.variantKey, 'trailing-8');
  });

  it('dead fallback — EXITED trailing-8 yields the deepest ACTIVE candidate', () => {
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8', 'EXITED'), run('ma-close-20')],
      { trade: makeTrade(TradeSide.LONG, 95), mark: 100, indicators: { sma: { 20: 90 } } },
    );
    assert.equal(pick?.variantKey, 'ma-close-20'); // can't name an exited run
  });

  it('excludes EXITED runs from candidacy', () => {
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8'), run('ma-close-20', 'EXITED')],
      { trade, mark: 100, indicators: { sma: { 20: 90 } } },
    );
    // ma-close-20's 90 would be deepest but its run is EXITED → trailing-8@92.
    assert.equal(pick?.variantKey, 'trailing-8');
  });

  it('excludes levels above the trade high watermark — a level past the peak is consumed', () => {
    // sma 110 > watermark 100 → degenerate level, not a candidate.
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
      { trade, mark: 100, indicators: { sma: { 20: 110 } } },
    );
    assert.equal(pick?.variantKey, 'trailing-8'); // deepest of {95, 92}
  });

  it('breach-day: a stop breached today still governs — its level sits below the watermark', () => {
    // hwm 100 → trailing-5 95, trailing-8 92, sma 90. Mark 85 breached all
    // three, but every level is still below the watermark → candidates.
    // Deepest = sma 90; its trigger fires today (85 ≤ 90) → it closes.
    const pick = selectGoverningRun(
      [
        run('trailing-5', 'ACTIVE', { highWaterMark: 100 }),
        run('trailing-8', 'ACTIVE', { highWaterMark: 100 }),
        run('ma-close-20'),
      ],
      { trade, mark: 85, indicators: { sma: { 20: 90 } } },
    );
    assert.equal(pick?.variantKey, 'ma-close-20');
  });

  it('levels undefined (time/none/unparsed) are never candidates', () => {
    const pick = selectGoverningRun(
      [run('time-30d'), run('none'), run('trailing-8')],
      { trade, mark: 100 },
    );
    assert.equal(pick?.variantKey, 'trailing-8');
  });

  it('returns undefined when nothing qualifies', () => {
    const pick = selectGoverningRun([run('time-30d'), run('target-50')], {
      trade,
      mark: 100,
    });
    assert.equal(pick, undefined);
  });

  it('target-* level sits above the mark pre-fire — never a candidate', () => {
    const pick = selectGoverningRun(
      [run('trailing-8'), run('target-50')],
      { trade, mark: 100 }, // entry 80 → target-50 level 120 > 100
    );
    assert.equal(pick?.variantKey, 'trailing-8');
  });

  it('target-* is family-excluded even when its level lands below the mark', () => {
    // entry 60, mark 100 → target-50 level 90 sits below the mark (it fires
    // this day as an independent closer). Candidates are stop families only
    // — 'deepest below' must not name the closer.
    const pick = selectGoverningRun(
      [run('trailing-8'), run('target-50')],
      { trade: makeTrade(TradeSide.LONG, 60), mark: 100 },
    );
    assert.equal(pick?.variantKey, 'trailing-8');
  });
});

describe('selectGoverningRun — short side (#1574)', () => {
  const trade = makeTrade(TradeSide.SHORT, 120);

  it('picks the highest level above the mark', () => {
    // mark 100, low water 100 → trailing-5 105, trailing-8 108; sma20 110.
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
      { trade, mark: 100, indicators: { sma: { 20: 110 } } },
    );
    assert.equal(pick?.variantKey, 'ma-close-20'); // 110 > 108 > 105 → deepest
  });

  it('falls back to trailing-8 when the deepest level sits above entry', () => {
    // entry 105 → deepest (sma 110) is above entry → trailing-8 governs.
    const pick = selectGoverningRun(
      [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
      { trade: makeTrade(TradeSide.SHORT, 105), mark: 100, indicators: { sma: { 20: 110 } } },
    );
    assert.equal(pick?.variantKey, 'trailing-8');
  });
});

describe('smaAt (#1574)', () => {
  const bars: OhlcBar[] = [
    { d: '2026-09-01', o: 0, h: 0, l: 0, c: 10 },
    { d: '2026-09-02', o: 0, h: 0, l: 0, c: 20 },
    { d: '2026-09-03', o: 0, h: 0, l: 0, c: 30 },
    { d: '2026-09-04', o: 0, h: 0, l: 0, c: 40 },
  ];

  it('means the last N closes on or before the date', () => {
    assert.equal(smaAt(bars, '2026-09-04', 2), 35);
    assert.equal(smaAt(bars, '2026-09-03', 2), 25);
    assert.equal(smaAt(bars, '2026-09-04', 4), 25);
  });

  it('ignores bars after the eval date', () => {
    assert.equal(smaAt(bars, '2026-09-02', 2), 15);
  });

  it('returns undefined when the window exceeds loaded history', () => {
    assert.equal(smaAt(bars, '2026-09-01', 2), undefined);
    assert.equal(smaAt([], '2026-09-04', 2), undefined);
  });
});
