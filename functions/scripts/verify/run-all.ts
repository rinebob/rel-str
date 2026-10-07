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
// needing RH MCP OAuth (564 signal-order, 667 close) fail without a local
// token; that's a real environment gap, not a script defect.
const scripts = [
  'strat-lib-257-compute.ts',
  'strat-lib-258-comparison.ts',
  'indicator-lib-268-engine.ts',
  'paper-trading-ledger-561.ts',
  'paper-trading-engine-migration-562.ts',
  'paper-trading-exit-eval-563.ts',
  'paper-trading-signal-order-564.ts',
  'paper-trading-read-apis-565.ts',
  'paper-trading-cancel-666.ts',
  'paper-trading-close-667.ts',
  'paper-trading-signal-marks-676.ts',
  'paper-trading-signal-settlement-720.ts',
  'paper-trading-engine-settlement-724.ts',
  'paper-trading-trade-exits-669.ts',
  'screenshot-capture-766-render.ts',
  'screenshot-capture-767-assemble.ts',
  'screenshot-capture-768-callable.ts',
  'screenshot-capture-769-rasterize.ts',
  'screenshot-capture-844-contracts.ts',
  'indicator-lib-876-engine.ts',
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
