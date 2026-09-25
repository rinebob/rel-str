/**
 * Run all verification scripts for the broker-order adapter.
 * Runs each script in order and reports pass/fail.
 *
 * Usage:
 *   npx tsx scripts/verify/run-all.ts [accountNumber]
 *
 * If accountNumber is omitted, uses the ACCOUNT_NUMBER env var. Scripts that
 * require it are skipped (reported as SKIPPED) when no account is supplied;
 * scripts that need no credentials always run.
 */

import { spawnSync } from 'node:child_process';

const accountNumber = process.argv[2] ?? process.env.ACCOUNT_NUMBER;

const scripts = [
  { name: 'list orders', file: 'savant-trader-broker-orders-list.ts', needsAccount: true },
  { name: 'list positions', file: 'savant-trader-broker-positions-list.ts', needsAccount: true },
  { name: 'paper-trading contracts', file: 'paper-trading-contracts-560-ids.ts', needsAccount: false },
];

let passed = 0;
let failed = 0;
let skipped = 0;

for (const script of scripts) {
  if (script.needsAccount && !accountNumber) {
    console.log(`\n--- ${script.name} --- SKIPPED (needs <accountNumber> arg or ACCOUNT_NUMBER env)`);
    skipped++;
    continue;
  }
  console.log(`\n--- ${script.name} ---`);
  const args = script.needsAccount ? [accountNumber as string] : [];
  const result = runScript(script.file, args);
  if (result) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
process.exit(failed > 0 ? 1 : 0);

function runScript(file: string, args: string[]): boolean {
  const result = spawnSync('npx', ['tsx', `scripts/verify/${file}`, ...args], {
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}
