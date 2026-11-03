/**
 * Verification: backtest-analytics shared layer (task #1367).
 *
 * Exercises `shared/options-analysis-registry.ts` +
 * `shared/options-analysis-contracts.ts` through the real
 * `@options-analysis/*` tsconfig aliases — a passing run proves alias
 * resolution under tsx, that `{listDocId}_{exitId}` result-doc keys compose
 * valid Firestore paths, and that the outcome-variant record conventions
 * hold on constructed fixtures.
 *
 * Registry hygiene (duplicate ids, charset, unique orders, per-kind param
 * literals, every kind seeded, getExitStrategy hit/miss, version) is owned
 * by `shared/options-analysis-registry.spec.ts` — do not re-assert it here.
 * The getExitStrategy/version lines below exist only as alias-resolution
 * smoke (proving the import reached the real module), per the 1276 script's
 * precedent.
 *
 * Usage: npx tsx scripts/verify/options-backtest-analytics-1367-registry-contracts.ts
 *
 * No credentials, no Firestore — pure registry + structural checks only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with expected value; exit 1.
 */

import {
  EXIT_STRATEGIES,
  EXIT_REGISTRY_VERSION,
  getExitStrategy,
} from '@options-analysis/registry';
import type {
  AnalysisResultDoc,
  AnalysisTradeRecord,
  OptionsAnalysisTaskPayload,
} from '@options-analysis/contracts';
import type { OptionsReplayRetryRequest } from '@options-replay/contracts';
import {
  ST_OPTIONS_ANALYSIS_RESULTS_ROOT,
  stOptionsAnalysisResultDocId,
} from '@st/collections';

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

// --- Alias smoke — if an import resolved to the wrong module or a stale
// build, these representative values fail. ---

check('registry non-empty via alias', EXIT_STRATEGIES.length >= 6, true);
check(
  'provisional seeds resolve via getExitStrategy',
  ['target-90', 'price-100', 'price-50', 'stop-200', 'dte-21', 'expiry'].every(
    (id) => getExitStrategy(id) !== undefined,
  ),
  true,
);
check(
  'registry version positive int',
  Number.isInteger(EXIT_REGISTRY_VERSION) && EXIT_REGISTRY_VERSION > 0,
  true,
);

// --- Doc-key composition → valid Firestore path ---
// st-options-analysis-results/{listDocId}_{exitId} — doc id must be a single
// path segment (no '/'). Composed via the canonical builder (#1368).

const listDocId = 'run-abc_QQQ';
for (const e of EXIT_STRATEGIES) {
  const docId = stOptionsAnalysisResultDocId(listDocId, e.exitId);
  const path = `${ST_OPTIONS_ANALYSIS_RESULTS_ROOT}/${docId}`;
  check(
    `doc path valid: ${docId}`,
    path.split('/').length === 2 && docId.length > 0 && !docId.includes('/'),
    true,
  );
}

// --- Trade-record structural shape per outcome (discriminated union) ---

const base = {
  runId: 'run-abc',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  contractListDocId: listDocId,
  exitId: 'target-90',
  pickDate: '2026-01-05',
  contractId: 'QQQ260220P00500000',
  entryMark: 4.2,
  daysHeld: 10,
  mae: { value: 6.0, date: '2026-01-12' },
  mfe: { value: 0.4, date: '2026-01-14' },
};

const exitRec: AnalysisTradeRecord = { ...base, outcome: 'exit', exitDate: '2026-01-15', exitPrice: 0.42 };
const expiredRec: AnalysisTradeRecord = {
  ...base,
  outcome: 'expired',
  expiredItm: true,
  intrinsicAtExpiry: 2.9,
  assignmentDistancePct: 3.1, // PERCENT (×100) — 3.1% of underlying.
};
const errorRec: AnalysisTradeRecord = {
  ...base,
  outcome: 'error',
  daysHeld: 0,
  mae: { value: base.entryMark, date: base.pickDate },
  mfe: { value: base.entryMark, date: base.pickDate },
  error: 'series 404',
};

check(
  'exit variant: exit fields present',
  exitRec.outcome === 'exit' && exitRec.exitDate !== undefined && exitRec.exitPrice !== undefined,
  true,
);
check(
  'expired variant: expiry fields present (assignmentDistancePct is a percent)',
  expiredRec.outcome === 'expired' && expiredRec.expiredItm === true &&
    expiredRec.intrinsicAtExpiry !== undefined && expiredRec.assignmentDistancePct !== undefined &&
    expiredRec.assignmentDistancePct < 100,
  true,
);
check(
  'error variant: entry-day placeholder convention (daysHeld 0, mae/mfe = entry day)',
  errorRec.outcome === 'error' && errorRec.daysHeld === 0 &&
    errorRec.mae.value === errorRec.entryMark && errorRec.mae.date === errorRec.pickDate,
  true,
);
check(
  'records self-describe exitId + contractListDocId',
  [exitRec, expiredRec, errorRec].every(
    (r) => r.exitId === 'target-90' && r.contractListDocId === listDocId,
  ),
  true,
);

// --- Result doc + payload shapes ---

const resultDoc: AnalysisResultDoc = {
  contractListDocId: listDocId,
  runId: 'run-abc',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  exitId: 'expiry',
  registryVersion: EXIT_REGISTRY_VERSION,
  status: 'success',
  trades: [{ ...expiredRec, exitId: 'expiry' }],
  aggregate: {
    exitId: 'expiry',
    contractCount: 1,
    exitedCount: 0,
    expiredCount: 1,
    errorCount: 0,
    hitRatePct: 0,
    worstMae: 6.0,
  },
  generatedAt: new Date().toISOString(),
};
check('result doc: doc key = {list}_{exitId}', `${listDocId}_${resultDoc.exitId}`, `${listDocId}_expiry`);
check(
  'result doc: trades carry the doc exitId',
  resultDoc.trades.every((t) => t.exitId === resultDoc.exitId),
  true,
);
check('result doc: registryVersion stamped', resultDoc.registryVersion, EXIT_REGISTRY_VERSION);

const payload: OptionsAnalysisTaskPayload = {
  contractListDocId: listDocId,
  runId: 'run-abc',
  symbol: 'QQQ',
  templateId: 'csp-45-20',
  registryVersion: EXIT_REGISTRY_VERSION,
};
const retryReq: OptionsReplayRetryRequest = { runId: 'run-abc' };
check(
  'task payload carries all fanout keys',
  payload.contractListDocId === `${payload.runId}_${payload.symbol}` &&
    payload.registryVersion === EXIT_REGISTRY_VERSION,
  true,
);
check('retry request shape (from @options-replay/contracts)', retryReq, { runId: 'run-abc' });

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
