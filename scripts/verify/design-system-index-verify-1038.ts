/**
 * Verification: savant-ds index forwards + full-surface verify
 * (task #1038, SHARED blueprint).
 *
 * The authoritative checks live in the package itself —
 * `C:\aa\projects\savant-ds\scripts\verify.mjs` (npm run verify). For
 * #1038 that surface is: styles/ directory manifest set-equality,
 * _index.scss forwards exactly the mixin modules (tokens never
 * forwarded), and every mixin defined in styles/ is exercised by an
 * index fixture — plus all the #1035–#1037 checks underneath.
 *
 * This script is the rel-str-side mirror so `run-all.ts` covers the
 * task: it runs `npm run verify` inside the sibling checkout and relays
 * the result. Skipped by run-all when ../savant-ds is absent
 * (needsPath).
 *
 * Usage: npx tsx scripts/verify/design-system-index-verify-1038.ts
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
