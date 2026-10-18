/**
 * Verification: savant-ds data-display mixins (task #1052, SHARED
 * blueprint — graduates the remaining generic mixins out of
 * `_pd-visual-language.scss`).
 *
 * The authoritative checks live in the package itself —
 * `C:\aa\projects\savant-ds\scripts\verify.mjs` (npm run verify). This
 * script relays that result, then runs the shared verbatim-semantics
 * parity probe (scripts/verify/ds-parity-probe.ts) — compiling
 * dense-table, state-block, and stat-strip from BOTH the savant-ds
 * `_data-display.scss` partial and the source `_pd-visual-language.scss`
 * shim (delegated via `@forward 'index'` post-#1052) and diffing emitted
 * declarations after normalizing `var(--ds-*)` to compiled token values.
 *
 * bounded-tab-group + tab-scroll-pane are intentionally absent — #1052
 * judged them PD-domain (Material-coupled ::ng-deep tab internals, two
 * call sites) and they stay local to the shim.
 *
 * Skipped by run-all when ../savant-ds is absent (needsPath).
 *
 * Usage: npx tsx scripts/verify/design-system-data-display-1052.ts
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
  dsFile: '_data-display.scss',
  mixins: ['dense-table', 'state-block', 'stat-strip'],
  label: 'data-display mixins',
});

if (bad === 0) {
  console.log('\n=== ALL CHECKS PASSED ===');
} else {
  console.log(`\n=== ${bad} PARITY DIFF(S) ===`);
  process.exit(1);
}
