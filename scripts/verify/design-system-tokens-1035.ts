/**
 * Verification: savant-ds token layer (task #1035, SHARED blueprint).
 *
 * The authoritative checks live in the package itself —
 * `C:\aa\projects\savant-ds\scripts\verify.mjs` (npm run verify): real
 * sass compilation, every documented --ds-* token emitted under :root,
 * [data-theme="dark"] overrides, --mat-sys-* aliases, and consumer-style
 * `@use 'tokens'` resolution via includePaths.
 *
 * This script is the rel-str-side mirror so `run-all.ts` covers the task:
 * it runs `npm run verify` inside the sibling checkout and relays the
 * result. Skipped by run-all when ../savant-ds is absent (needsPath).
 *
 * Usage: npx tsx scripts/verify/design-system-tokens-1035.ts
 *
 * No credentials, no network. Pass: package verify exits 0. Fail: exit 1.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'savant-ds',
);

if (!existsSync(DS)) {
  console.log(`SKIPPED — ${DS} not checked out on this machine`);
  process.exit(0);
}

console.log('--- savant-ds: npm run verify ---');
const r = spawnSync('npm', ['run', 'verify'], {
  cwd: DS,
  stdio: 'inherit',
  shell: true,
});

if (r.status === 0) {
  console.log('\n=== ALL CHECKS PASSED ===');
} else {
  console.log('\n=== PACKAGE VERIFY FAILED ===');
  process.exit(1);
}
