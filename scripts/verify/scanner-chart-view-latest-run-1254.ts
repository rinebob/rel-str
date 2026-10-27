/**
 * Verification: ScanLatestRun contract + latest-runs paths + rules (task #1254).
 *
 * Exercises `shared/scanner-contracts.ts` (ScanLatestRun serialize/parse)
 * through the real `@st/scanner` alias and the new path helpers through
 * `@st/collections` — a passing run proves alias resolution under tsx for
 * the modules FE will import in #1257/#1258. Also asserts the
 * `st-scanner` rules block grants authed CRUD to the `latest-runs` anchor.
 *
 * Usage: npx tsx scripts/verify/scanner-chart-view-latest-run-1254.ts
 *
 * No credentials, no Firestore — contracts + constants + static file
 * checks only.
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ST_SCANNER_LATEST_RUNS_ANCHOR,
  stScannerLatestRunDocPath,
  stScannerLatestRunsPath,
} from '@st/collections';
import {
  parseScanLatestRun,
  serializeScanLatestRun,
  type ScanLatestRun,
} from '@st/scanner';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let failures = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

function checkThrows(name: string, fn: () => unknown): void {
  try {
    fn();
    console.log(`FAIL ${name}: did not throw`);
    failures++;
  } catch {
    console.log(`OK   ${name}: threw as expected`);
  }
}

// ── Path helpers ─────────────────────────────────────────────────────────────

check('latest-runs anchor', ST_SCANNER_LATEST_RUNS_ANCHOR, 'latest-runs');
check('collection path', stScannerLatestRunsPath(), 'st-scanner/latest-runs/items');
check(
  'collection path odd segments (collection() accepts)',
  stScannerLatestRunsPath().split('/').length % 2,
  1,
);
check(
  'doc path uses recipeId',
  stScannerLatestRunDocPath('quality-large'),
  'st-scanner/latest-runs/items/quality-large',
);
check(
  'doc path even segments (doc() accepts)',
  stScannerLatestRunDocPath('quality-large').split('/').length % 2,
  0,
);

// ── Contract round-trip ───────────────────────────────────────────────────────

const run: ScanLatestRun = {
  recipeId: 'quality-large',
  ranAt: '2026-10-26T14:00:00.000Z',
  totalItems: 182,
  truncated: true,
  rows: [
    {
      ticker: 'XYZ',
      instrument_id: 'abc-123',
      instrument_type: 'EQUITY',
      columns: { 'Return on equity': '0.02', Last: '42.10' },
    },
    { ticker: 'ABC', instrument_id: 'def-456', instrument_type: 'ETF', columns: {} },
  ],
};

const wire = serializeScanLatestRun(run);
check('serialize → parse round-trip', parseScanLatestRun(wire), run);

const emptyRun: ScanLatestRun = { ...run, totalItems: 0, truncated: false, rows: [] };
check('zero-match run round-trips', parseScanLatestRun(serializeScanLatestRun(emptyRun)), emptyRun);

checkThrows('rejects missing scalars', () => parseScanLatestRun({}));
checkThrows('rejects non-array rows', () =>
  parseScanLatestRun({ ...wire, rows: 'XYZ' }),
);
checkThrows('rejects row without ticker', () =>
  parseScanLatestRun({ ...wire, rows: [{ columns: {} }] }),
);
checkThrows('rejects non-string column value', () =>
  parseScanLatestRun({ ...wire, rows: [{ ticker: 'X', columns: { Last: 42 } }] }),
);

// ── Rules allowlist (static — emulator-free convention) ──────────────────────

const rules = readFileSync(path.join(REPO_ROOT, 'firestore.rules'), 'utf-8');
const block = rules.match(/match \/st-scanner\/\{anchor\}\/items\/\{docId\} \{[\s\S]*?\n    \}/);
check('st-scanner rules block exists', Boolean(block), true);
check(
  'latest-runs in write allowlist',
  block?.[0].includes("anchor in ['proposals', 'latest-runs']") ?? false,
  true,
);

if (failures > 0) {
  console.error(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
