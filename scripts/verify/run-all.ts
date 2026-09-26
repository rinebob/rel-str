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
import { existsSync } from 'node:fs';

const accountNumber = process.argv[2] ?? process.env.ACCOUNT_NUMBER;

const scripts = [
  { name: 'list orders', file: 'savant-trader-broker-orders-list.ts', needsAccount: true },
  { name: 'list positions', file: 'savant-trader-broker-positions-list.ts', needsAccount: true },
  { name: 'paper-trading contracts', file: 'paper-trading-contracts-560-ids.ts', needsAccount: false },
  {
    name: 'paper-trading ledger',
    file: 'verify/paper-trading-ledger-561.ts',
    cwd: 'functions',
    needsAccount: false,
    needsAdc: true,
  },
  {
    name: 'paper-trading engine migration',
    file: 'verify/paper-trading-engine-migration-562.ts',
    cwd: 'functions',
    needsAccount: false,
    needsAdc: true,
  },
  {
    name: 'paper-trading exit eval pass',
    file: 'verify/paper-trading-exit-eval-563.ts',
    cwd: 'functions',
    needsAccount: false,
    needsAdc: true,
  },
];

function hasAdc(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  const adcPath = `${process.env.APPDATA ?? ''}/gcloud/application_default_credentials.json`;
  try {
    return existsSync(adcPath);
  } catch {
    return false;
  }
}

let passed = 0;
let failed = 0;
let skipped = 0;

for (const script of scripts) {
  if (script.needsAccount && !accountNumber) {
    console.log(`\n--- ${script.name} --- SKIPPED (needs <accountNumber> arg or ACCOUNT_NUMBER env)`);
    skipped++;
    continue;
  }
  if (script.needsAdc && !hasAdc()) {
    console.log(`\n--- ${script.name} --- SKIPPED (needs Google Application Default Credentials)`);
    skipped++;
    continue;
  }
  console.log(`\n--- ${script.name} ---`);
  const args = script.needsAccount ? [accountNumber as string] : [];
  const result = runScript(script.file, args, script.cwd);
  if (result) {
    passed++;
  } else {
    failed++;
  }
}

console.log(`\n=== Summary: ${passed} passed, ${failed} failed, ${skipped} skipped ===`);
process.exit(failed > 0 ? 1 : 0);

function runScript(file: string, args: string[], cwd?: string): boolean {
  const scriptPath = cwd ? `scripts/${file}` : `scripts/verify/${file}`;
  const result = spawnSync('npx', ['tsx', scriptPath, ...args], {
    stdio: 'inherit',
    shell: true,
    ...(cwd ? { cwd } : {}),
  });
  return result.status === 0;
}
