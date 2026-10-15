/**
 * Verification: st- collection path constants (task #997).
 *
 * Exercises every canonical `st-` root and path helper through the real
 * `@st/collections` tsconfig alias — a passing run proves alias resolution
 * under tsx as well as the approved path shapes and segment parity.
 *
 * Usage: npx tsx scripts/verify/data-pipeline-st-collections-997.ts
 *
 * No credentials, no Firestore — constants and pure helpers only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import {
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_CONFIG_ROOT,
  ST_CONFIG_STATUS_DOC,
  ST_JOBS_SUBCOLLECTION_NAME,
  ST_ORDER_TICKETS_ROOT,
  ST_PAPER_TRADING_ROOT,
  ST_PORTFOLIO_ROOT,
  ST_POSITION_GROUPS_ROOT,
  ST_RUNS_ROOT,
  ST_SIGNALS_ROOT,
  ST_STRATEGY_INSTANCES_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  ST_SYMBOLS_ROOT,
  StPaperTradingKind,
  StPortfolioKind,
  stRunJobsPath,
  stRunJobDocPath,
  stPaperTradingDocPath,
  stPaperTradingItemsPath,
  stPortfolioDocPath,
  stPortfolioItemsPath,
} from '@st/collections';
import {
  PaperTradingKind,
  paperTradingItemsPath,
} from '@paper-trading/ids';
import { ST_JOBS_SUBCOLLECTION } from '../../functions/src/common/st-collections';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// ── Flat roots ─────────────────────────────────────────────────────────────

check('st-symbols', ST_SYMBOLS_ROOT, 'st-symbols');
check('st-signals', ST_SIGNALS_ROOT, 'st-signals');
check('st-runs', ST_RUNS_ROOT, 'st-runs');
check('st-order-tickets', ST_ORDER_TICKETS_ROOT, 'st-order-tickets');
check('st-position-groups', ST_POSITION_GROUPS_ROOT, 'st-position-groups');
check('st-strategy-instances', ST_STRATEGY_INSTANCES_ROOT, 'st-strategy-instances');
check('st-config', ST_CONFIG_ROOT, 'st-config');
check('st-symbol-lists', ST_SYMBOL_LISTS_ROOT, 'st-symbol-lists');
check('st-backtest-runs', ST_BACKTEST_RUNS_ROOT, 'st-backtest-runs');
check('st-backtest-permutations', ST_BACKTEST_PERMUTATIONS_ROOT, 'st-backtest-permutations');

const flatRoots = [
  ST_SYMBOLS_ROOT,
  ST_SIGNALS_ROOT,
  ST_RUNS_ROOT,
  ST_ORDER_TICKETS_ROOT,
  ST_POSITION_GROUPS_ROOT,
  ST_STRATEGY_INSTANCES_ROOT,
  ST_CONFIG_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_BACKTEST_PERMUTATIONS_ROOT,
];
for (const root of flatRoots) {
  check(`${root} single-segment`, root.split('/').length, 1);
  check(`${root} st- prefix`, root.startsWith('st-'), true);
}

check('st-config status doc id (renamed from current)', ST_CONFIG_STATUS_DOC, 'status');
check('jobs subcollection name', ST_JOBS_SUBCOLLECTION_NAME, 'jobs');
check('functions barrel delegation ST_JOBS_SUBCOLLECTION', ST_JOBS_SUBCOLLECTION, 'jobs');

// ── st-runs jobs subcollection ─────────────────────────────────────────────

check('jobs path', stRunJobsPath('run-abc'), 'st-runs/run-abc/jobs');
check('jobs path odd segments', stRunJobsPath('run-abc').split('/').length % 2, 1);
check('job doc path', stRunJobDocPath('run-abc', 'ADPT'), 'st-runs/run-abc/jobs/ADPT');
check('job doc path even segments', stRunJobDocPath('run-abc', 'ADPT').split('/').length % 2, 0);
check('job doc path uppercases symbol', stRunJobDocPath('run-abc', 'adpt'), 'st-runs/run-abc/jobs/ADPT');

// ── st-paper-trading anchored kinds ────────────────────────────────────────

check('paper accounts items', stPaperTradingItemsPath(StPaperTradingKind.ACCOUNT), 'st-paper-trading/accounts/items');
check('paper trades items', stPaperTradingItemsPath(StPaperTradingKind.TRADE), 'st-paper-trading/trades/items');
check('paper stats items', stPaperTradingItemsPath(StPaperTradingKind.STATS), 'st-paper-trading/stats/items');
check('paper raw-quotes items', stPaperTradingItemsPath(StPaperTradingKind.RAW_QUOTE), 'st-paper-trading/raw-quotes/items');
check(
  'paper trade doc path',
  stPaperTradingDocPath(StPaperTradingKind.TRADE, 'ADPT-260927-sig-EQ-01'),
  'st-paper-trading/trades/items/ADPT-260927-sig-EQ-01',
);
for (const kind of Object.values(StPaperTradingKind)) {
  check(`paper ${kind} items odd segments`, stPaperTradingItemsPath(kind).split('/').length % 2, 1);
  check(`paper ${kind} doc even segments`, stPaperTradingDocPath(kind, 'x').split('/').length % 2, 0);
}
check('paper kinds exclude instances/cohorts', Object.values(StPaperTradingKind).sort(), ['account', 'raw-quote', 'stats', 'trade']);
check('legacy PaperTradingKind accepted', stPaperTradingItemsPath(PaperTradingKind.TRADE), 'st-paper-trading/trades/items');
for (const moved of [PaperTradingKind.INSTANCE, PaperTradingKind.COHORT]) {
  check(
    `${moved} kind throws (moved out of st-paper-trading)`,
    (() => { try { stPaperTradingItemsPath(moved); return 'no-throw'; } catch { return 'threw'; } })(),
    'threw',
  );
}
check(
  "paper 'toString' kind throws (prototype member)",
  (() => { try { stPaperTradingItemsPath('toString' as StPaperTradingKind); return 'no-throw'; } catch { return 'threw'; } })(),
  'threw',
);
const stKindSet = new Set<string>(Object.values(StPaperTradingKind));
for (const kind of Object.values(PaperTradingKind).filter((k) => stKindSet.has(k))) {
  check(
    `paper ${kind} st- mirrors legacy anchor`,
    stPaperTradingItemsPath(kind),
    `st-${paperTradingItemsPath(kind)}`,
  );
}

// ── st-portfolio anchored kinds ────────────────────────────────────────────

check('portfolio buckets items', stPortfolioItemsPath(StPortfolioKind.BUCKET), 'st-portfolio/buckets/items');
check('portfolio attributions items', stPortfolioItemsPath(StPortfolioKind.ATTRIBUTION), 'st-portfolio/attributions/items');
check(
  'portfolio bucket doc path',
  stPortfolioDocPath(StPortfolioKind.BUCKET, 'bucket-1'),
  'st-portfolio/buckets/items/bucket-1',
);
for (const kind of Object.values(StPortfolioKind)) {
  check(`portfolio ${kind} items odd segments`, stPortfolioItemsPath(kind).split('/').length % 2, 1);
  check(`portfolio ${kind} doc even segments`, stPortfolioDocPath(kind, 'x').split('/').length % 2, 0);
}
check(
  "portfolio 'buckets' throws (plural anchor is not a kind)",
  (() => { try { stPortfolioItemsPath('buckets' as StPortfolioKind); return 'no-throw'; } catch { return 'threw'; } })(),
  'threw',
);

if (failures === 0) {
  console.log('=== ALL CHECKS PASSED ===');
} else {
  console.log(`=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
