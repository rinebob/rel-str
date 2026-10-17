/**
 * Verification: savant-ds page/layout mixins (task #1036, SHARED blueprint).
 *
 * The authoritative checks live in the package itself —
 * `C:\aa\projects\savant-ds\scripts\verify.mjs` (npm run verify). This
 * script relays that result, then runs the shared verbatim-semantics
 * parity probe (scripts/verify/ds-parity-probe.ts) — compiling the four
 * page mixins from BOTH `savant-ds/styles/_page.scss` and the source
 * `_pd-visual-language.scss` and diffing emitted declarations after
 * normalizing `var(--ds-*)` to compiled token values.
 *
 * Skipped by run-all when ../savant-ds is absent (needsPath).
 *
 * Usage: npx tsx scripts/verify/design-system-page-mixins-1036.ts
 *
 * No credentials, no network. Pass: package verify exits 0 AND parity
 * probe diffs clean. Fail: exit 1.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runParityProbe } from './ds-parity-probe';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DS = path.resolve(HERE, '..', '..', '..', 'savant-ds');
const PD = path.resolve(
  HERE, '..', '..', 'src', 'app', 'features', 'portfolio-dashboard', 'styles',
);

if (!existsSync(DS)) {
  console.log(`SKIPPED — ${DS} not checked out on this machine`);
  process.exit(0);
}
if (!existsSync(path.join(PD, '_pd-visual-language.scss'))) {
  console.log(`FAIL parity source missing — ${PD}\\_pd-visual-language.scss`);
  process.exit(1);
}

console.log('--- savant-ds: npm run verify ---');
const r = spawnSync('npm', ['run', 'verify'], {
  cwd: DS,
  stdio: 'inherit',
  shell: true,
});
if (r.status !== 0) {
  console.log('\n=== PACKAGE VERIFY FAILED ===');
  process.exit(1);
}

const bad = runParityProbe({
  dsRoot: DS,
  srcDir: PD,
  srcModule: 'pd-visual-language',
  dsFile: '_page.scss',
  mixins: ['page-host', 'page-shell', 'content-column', 'header-bar'],
  label: 'page mixins',
});

if (bad === 0) {
  console.log('\n=== ALL CHECKS PASSED ===');
} else {
  console.log(`\n=== ${bad} PARITY DIFF(S) ===`);
  process.exit(1);
}
