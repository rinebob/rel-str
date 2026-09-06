/**
 * Run all verification scripts for the broker-order adapter.
 * Runs each script in order and reports pass/fail.
 *
 * Usage:
 *   npx tsx scripts/verify/run-all.ts [accountNumber]
 *
 * If accountNumber is omitted, uses the ACCOUNT_NUMBER env var.
 */

import { spawn } from 'node:child_process';

const accountNumber = process.argv[2] ?? process.env.ACCOUNT_NUMBER;
if (!accountNumber) {
  console.error('Usage: npx tsx scripts/verify/run-all.ts <accountNumber>');
  console.error('   or: ACCOUNT_NUMBER=... npx tsx scripts/verify/run-all.ts');
  process.exit(1);
}

const scripts = [
  { name: 'list orders', file: 'savant-trader-broker-orders-list.ts', args: [accountNumber] },
  { name: 'list positions', file: 'savant-trader-broker-positions-list.ts', args: [accountNumber] },
];

let passed = 0;
let failed = 0;

for (const script of scripts) {
  console.log(`\n--- ${script.name} ---`);
  const result = await runScript(script.file, script.args);
  if (result) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

function runScript(file: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['tsx', `scripts/verify/${file}`, ...args], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}
