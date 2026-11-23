/**
 * Run all verification scripts in documented order and report pass/fail.
 *
 * Run from the functions/ directory:
 *   npx tsx scripts/verify/run-all.ts
 */

import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Documented order — ingest/ledger first, exits/actions last. Scripts
// needing RH MCP OAuth (564 signal-order, 667 close, 1098 scanner
// recipes) fail without a local token; that's a real environment gap,
// not a script defect.
const scripts = [
  'strat-lib-257-compute.ts',
  'strat-lib-258-comparison.ts',
  'indicator-lib-268-engine.ts',
  'paper-trading-ledger-561.ts',
  'paper-trading-engine-migration-562.ts',
  'paper-trading-exit-eval-563.ts',
  'paper-trading-signal-order-564.ts',
  'paper-trading-read-apis-565.ts',
  'paper-trading-stats-src-scopes-1562.ts',
  'paper-trading-stats-increments-1563.ts',
  'paper-trading-cancel-666.ts',
  'paper-trading-close-667.ts',
  'paper-trading-signal-marks-676.ts',
  'paper-trading-signal-settlement-720.ts',
  'paper-trading-engine-settlement-724.ts',
  'paper-trading-engine-open-1247.ts',
  'paper-trading-trade-exits-669.ts',
  'screenshot-capture-766-render.ts',
  'screenshot-capture-767-assemble.ts',
  'screenshot-capture-768-callable.ts',
  'screenshot-capture-769-rasterize.ts',
  'screenshot-capture-844-contracts.ts',
  'screenshot-capture-826-lifecycle.ts',
  'indicator-lib-876-engine.ts',
  'indicator-lib-877-callable.ts',
  // Retired post-delete (#1019 ship): 1000 dual-write, 1001 backfill,
  // 1019 reader-equivalence, 1159 runs/symbols parity — all read the
  // deleted savant-trader/data/symbols evidence and would pass vacuously
  // or fail by design. (#1158 ship): analysis-anchors parity — read the
  // deleted paper-trading analysis anchors evidence and would fail by
  // design.
  'data-pipeline-st-order-tickets-1002.ts',
  'data-pipeline-run-jobs-ttl-1010.ts',
  'data-pipeline-legacy-roots-1013.ts',
  'paper-trading-analysis-1073-contracts.ts',
  'paper-trading-analysis-1074-csv-codec.ts',
  'paper-trading-analysis-1076-dataset-writer.ts',
  'paper-trading-analysis-1077-live-snapshot.ts',
  'paper-trading-analysis-dataset.ts',
  'rh-scanner-recipes-1098.ts',
  'options-replay-single-symbol-1430.ts',
  'options-auth-guard-1437.ts',
  'st-auth-guard-1444.ts',
  'pick-doc-404-semantics-1401.ts',
  'indicator-lib-878-pine-parity.ts',
  'indicator-lib-873-pine-parity.ts',
  'options-analysis-all-otm-1431.ts',
  'options-replay-leg-contracts-1491.ts',
  'options-replay-template-registries-1492.ts',
  'options-replay-position-rows-1493.ts',
  'paper-trading-curated-contracts-1573.ts',
  'paper-trading-curated-exit-engine-1574.ts',
  'paper-trading-backfill-signal-trade-1575.ts',
  'paper-trading-ledger-ops-1576.ts',
  'paper-trading-signal-review-contracts-1649.ts',
  'paper-trading-signal-review-callables-1650.ts',
  'paper-trading-groom-legacy-trades-1651.ts',
  'options-replay-start-forms-1498.ts',
  'options-replay-worker-1499.ts',
  'options-analysis-position-1500.ts',
  'options-engine-eod-selection-1501.ts',
  'options-engine-expression-fill-1502.ts',
  'options-simulator-deprecation-1503.ts',
  // Needs ADC + Firestore (real lease doc ops) — an environment gap where
  // ADC is absent, same class as the ADC-needing replay/engine scripts.
  'rh-mcp-refresh-lease-1658.ts',
  'indicator-lib-ibs-1675.ts',
  'ibs-trend-rider-filter-1678.ts',
];

let passed = 0;
let failed = 0;

for (const script of scripts) {
  const path = resolve(__dirname, script);
  process.stdout.write(`\n▶ ${script}\n`);
  try {
    execFileSync('npx', ['tsx', path], { stdio: 'inherit', shell: true });
    passed++;
    process.stdout.write(`✔ ${script} — PASS\n`);
  } catch {
    failed++;
    process.stdout.write(`✖ ${script} — FAIL\n`);
  }
}

process.stdout.write(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
