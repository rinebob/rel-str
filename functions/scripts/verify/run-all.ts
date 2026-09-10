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

const scripts = [
  'strat-lib-257-compute.ts',
  'strat-lib-258-comparison.ts',
  'indicator-lib-268-engine.ts',
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
