/**
 * Verification: backtest-analytics results collection (task #1368).
 *
 * Exercises the `st-options-analysis-results` root constant +
 * `stOptionsAnalysisResultDocId` builder through the real `@st/collections`
 * tsconfig alias — a passing run proves alias resolution under tsx and that
 * `{contractListDocId}_{exitId}` doc keys compose valid 2-segment Firestore
 * paths for every registry exitId.
 *
 * Rules + index declarations are covered by
 * `cd functions && npm run test:st-rules-indexes` (content assertions on
 * firestore.rules / firestore.indexes.json) — not re-asserted here. Both
 * only go live on `firebase deploy` — deliberately out of scope.
 *
 * Usage: npx tsx scripts/verify/options-backtest-analytics-1368-results-collection.ts
 *
 * No credentials, no Firestore — constant + builder smoke only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with expected value; exit 1.
 */

import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  stOptionsAnalysisResultDocId,
  stOptionsContractListDocId,
} from '@st/collections';
import { EXIT_STRATEGIES } from '@options-analysis/registry';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// --- Alias smoke — a wrong-module or stale-build import fails here. ---

check('analysis-results root via alias', ST_OPTIONS_ANALYSIS_RESULTS_ROOT, 'st-options-analysis-results');
check('contract-lists root still resolves', ST_OPTIONS_CONTRACT_LISTS_ROOT, 'st-options-contract-lists');
check('builder reachable via alias', typeof stOptionsAnalysisResultDocId, 'function');

// --- Doc-key composition → valid Firestore doc path ---
// st-options-analysis-results/{contractListDocId}_{exitId} — the composed
// doc id must stay a single path segment for every registered exitId
// (registry guards exitId to /^[a-z0-9][a-z0-9-]*$/; the charset spec in
// options-analysis-registry.spec.ts owns that invariant — this proves the
// composition end-to-end through the builder).

const listDocId = stOptionsContractListDocId('or-2026-11-02_tue_1200_manual_x9', 'qqq');
check('list doc id uppercases symbol', listDocId, 'or-2026-11-02_tue_1200_manual_x9_QQQ');

for (const e of EXIT_STRATEGIES) {
  const docId = stOptionsAnalysisResultDocId(listDocId, e.exitId);
  const path = `${ST_OPTIONS_ANALYSIS_RESULTS_ROOT}/${docId}`;
  check(
    `doc path valid: ${docId}`,
    path.split('/').length === 2 && docId.length > 0 && !docId.includes('/'),
    true,
  );
}

check(
  'doc key ends with the exitId suffix',
  stOptionsAnalysisResultDocId(listDocId, 'expiry').endsWith('_expiry'),
  true,
);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
