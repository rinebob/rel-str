/**
 * @topic #553 — Paper Trading Infra (task #1574)
 *
 * Static + fixture verification for the curated exit engine: the new
 * `ma-close-{N}`/`target-{pct}` grammar, the evaluators' fire semantics,
 * `variantLevel`, `isIndependentCloser`, `selectGoverningRun` (the
 * 'deepest-stop-else-trailing-8' policy), and `smaAt`.
 *
 * Read-only, no env — pure function checks against fixtures.
 *
 * Run: npx tsx scripts/verify/paper-trading-curated-exit-engine-1574.ts
 */

import { TradeSide } from '../../../shared/common';
import { OptionQuoteSource } from '../../../shared/options-common';
import {
  CURATED_VARIANT_KEYS,
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
  type PaperTrade,
  type VariantRun,
} from '../../../shared/paper-trading-contracts';
import {
  evaluateVariant,
  isIndependentCloser,
  isTerminalVariantKey,
  parseVariantKey,
  variantLevel,
  type VariantEvalCtx,
} from '../../src/paper-trading/exits/registry';
import {
  selectGoverningRun,
  smaAt,
} from '../../src/paper-trading/exits/governing-policy';
import type { OhlcBar } from '../../src/common/market-data-types';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}
function eq(name: string, actual: unknown, expected: unknown): void {
  check(name, actual === expected, `(got ${String(actual)}, want ${String(expected)})`);
}

function trade(side: TradeSide, entry = 80): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 'verify-1574',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.SIGNAL,
    symbol: 'QQQM',
    expression: 'EQ',
    governingVariant: 'trailing-8',
    governingPolicy: 'deepest-stop-else-trailing-8',
    order: { side, type: 'MARKET', quantity: 1 },
    fills: [
      { fillId: 'e', role: 'entry', date: '2026-09-01', price: entry, quantity: 1, quoteSource: OptionQuoteSource.SDS_BARS },
    ],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: [],
    realizedPnl: 0,
    unrealizedPnl: 0,
    createdAt: 't',
    updatedAt: 't',
  };
}
const run = (key: string, state: 'ACTIVE' | 'EXITED' = 'ACTIVE', ws: Record<string, number> = {}): VariantRun =>
  ({ variantKey: key, governing: false, state, workingState: ws });
const LONG = trade(TradeSide.LONG, 80);
const ctx = (over: Partial<VariantEvalCtx>): VariantEvalCtx => ({
  trade: LONG, mark: 100, date: '2026-09-10', daysHeld: 9, run: run('trailing-8'), ...over,
});

console.log('── grammar: all 7 curated keys parse ──');
for (const key of CURATED_VARIANT_KEYS) {
  check(`parseVariantKey('${key}')`, parseVariantKey(key) !== null);
}
eq('ma-close-20 period', JSON.stringify(parseVariantKey('ma-close-20')?.params), JSON.stringify({ period: 20 }));
eq('target-50 pct', JSON.stringify(parseVariantKey('target-50')?.params), JSON.stringify({ pct: 0.5 }));
check('ma-close/target NOT governing-eligible (seed gate)',
  !isTerminalVariantKey('ma-close-20') && !isTerminalVariantKey('target-50'));

console.log('── evaluators ──');
check('ma-close long fires below sma',
  evaluateVariant(ctx({ run: run('ma-close-20'), mark: 94, indicators: { sma: { 20: 95 } } })).trigger);
check('ma-close long quiet at/above sma',
  !evaluateVariant(ctx({ run: run('ma-close-20'), mark: 95, indicators: { sma: { 20: 95 } } })).trigger &&
  !evaluateVariant(ctx({ run: run('ma-close-20'), mark: 96, indicators: { sma: { 20: 95 } } })).trigger);
check('ma-close never fires blind',
  !evaluateVariant(ctx({ run: run('ma-close-20'), mark: 1 })).trigger &&
  !evaluateVariant(ctx({ run: run('ma-close-20'), mark: 1, indicators: { sma: { 50: 95 } } })).trigger);
check('ma-close short fires above sma',
  evaluateVariant(ctx({ trade: trade(TradeSide.SHORT, 120), run: run('ma-close-50'), mark: 96, indicators: { sma: { 50: 95 } } })).trigger);
check('target-50 long fires at entry × 1.5',
  evaluateVariant(ctx({ run: run('target-50'), mark: 120 })).trigger &&
  !evaluateVariant(ctx({ run: run('target-50'), mark: 119.99 })).trigger);
check('target-50 short fires at entry × 0.5',
  evaluateVariant(ctx({ trade: trade(TradeSide.SHORT, 120), run: run('target-50'), mark: 60 })).trigger);

console.log('── variantLevel / isIndependentCloser ──');
eq('trailing level rides watermark+mark',
  variantLevel(run('trailing-10', 'ACTIVE', { highWaterMark: 100 }), { trade: LONG, mark: 110 }),
  110 * 0.9);
eq('ma-close level = sma', variantLevel(run('ma-close-20'), { trade: LONG, mark: 100, indicators: { sma: { 20: 88 } } }), 88);
check('ma-close level undefined without indicators',
  variantLevel(run('ma-close-20'), { trade: LONG, mark: 100 }) === undefined);
eq('target level fixed', variantLevel(run('target-50'), { trade: LONG, mark: 100 }), 120);
check('time/limit/none have no level',
  variantLevel(run('time-30d'), { trade: LONG, mark: 100 }) === undefined &&
  variantLevel(run('limit-sd1'), { trade: LONG, mark: 100 }) === undefined &&
  variantLevel(run('none'), { trade: LONG, mark: 100 }) === undefined);
check('closers: target+time true; stops/unknown false',
  isIndependentCloser('target-50') && isIndependentCloser('time-30d') &&
  !isIndependentCloser('trailing-8') && !isIndependentCloser('ma-close-20') && !isIndependentCloser('none'));

console.log('── selectGoverningRun ──');
eq('breach-day: stop below the watermark still governs (long)',
  selectGoverningRun(
    [
      run('trailing-5', 'ACTIVE', { highWaterMark: 100 }),
      run('trailing-8', 'ACTIVE', { highWaterMark: 100 }),
      run('ma-close-20'),
    ],
    { trade: LONG, mark: 85, indicators: { sma: { 20: 90 } } },
  )?.variantKey, 'ma-close-20');
eq('level above the watermark is consumed — not a candidate',
  selectGoverningRun(
    [run('trailing-8'), run('ma-close-20')],
    { trade: LONG, mark: 100, indicators: { sma: { 20: 110 } } },
  )?.variantKey, 'trailing-8');
eq('deepest below mark governs (long)',
  selectGoverningRun(
    [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
    { trade: LONG, mark: 100, indicators: { sma: { 20: 90 } } },
  )?.variantKey, 'ma-close-20');
eq('below-entry fallback → trailing-8 (long)',
  selectGoverningRun(
    [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
    { trade: trade(TradeSide.LONG, 95), mark: 100, indicators: { sma: { 20: 90 } } },
  )?.variantKey, 'trailing-8');
eq('dead fallback → deepest ACTIVE (long)',
  selectGoverningRun(
    [run('trailing-5'), run('trailing-8', 'EXITED'), run('ma-close-20')],
    { trade: trade(TradeSide.LONG, 95), mark: 100, indicators: { sma: { 20: 90 } } },
  )?.variantKey, 'ma-close-20');
eq('highest above mark governs (short)',
  selectGoverningRun(
    [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
    { trade: trade(TradeSide.SHORT, 120), mark: 100, indicators: { sma: { 20: 110 } } },
  )?.variantKey, 'ma-close-20');
eq('above-entry fallback → trailing-8 (short)',
  selectGoverningRun(
    [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
    { trade: trade(TradeSide.SHORT, 105), mark: 100, indicators: { sma: { 20: 110 } } },
  )?.variantKey, 'trailing-8');
eq('target family-excluded even below the mark',
  selectGoverningRun(
    [run('trailing-8'), run('target-50')],
    { trade: trade(TradeSide.LONG, 60), mark: 100 },
  )?.variantKey, 'trailing-8');
eq('wrong-side level excluded',
  selectGoverningRun(
    [run('trailing-5'), run('trailing-8'), run('ma-close-20')],
    { trade: LONG, mark: 100, indicators: { sma: { 20: 110 } } },
  )?.variantKey, 'trailing-8');
eq('no candidates → undefined',
  selectGoverningRun([run('time-30d'), run('target-50')], { trade: LONG, mark: 100 }), undefined);

console.log('── smaAt ──');
const bars: OhlcBar[] = [
  { d: '2026-09-01', o: 0, h: 0, l: 0, c: 10 },
  { d: '2026-09-02', o: 0, h: 0, l: 0, c: 20 },
  { d: '2026-09-03', o: 0, h: 0, l: 0, c: 30 },
];
eq('smaAt last-2 mean', smaAt(bars, '2026-09-03', 2), 25);
eq('smaAt respects eval date', smaAt(bars, '2026-09-02', 2), 15);
check('smaAt undefined on short history', smaAt(bars, '2026-09-01', 2) === undefined);

console.log(failed === 0 ? `\nAll ${passed} checks passed.` : `\n${failed} check(s) FAILED (${passed} passed).`);
process.exit(failed === 0 ? 0 : 1);
