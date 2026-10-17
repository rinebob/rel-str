/**
 * Verification: savant-ds package skeleton (task #1034, SHARED blueprint).
 *
 * Proves the standalone package exists, is a git repo, and is consumable
 * via the npm `file:` dependency both apps will use — the whole point of
 * the skeleton is that `file:../savant-ds` resolves and links.
 *
 * Checks:
 *  1. C:\aa\projects\savant-ds exists with package.json (name savant-ds),
 *     styles/ + scripts/ dirs, and a .git repo.
 *  2. `npm install --dry-run` resolves `savant-ds@file:../savant-ds` from
 *     THIS repo root — the exact specifier consumers will declare.
 *  3. A scratch consumer under .devin/tmp performs a REAL install —
 *     node_modules/savant-ds lands as a link/junction with package.json
 *     readable through it.
 *
 * Usage: npx tsx scripts/verify/design-system-package-1034.ts
 *
 * No credentials, no network beyond the local filesystem (npm hits no
 * registry for a file: dep; --no-audit/--no-fund keep it that way).
 * Pass: every check prints OK; exit 0. Fail: FAIL lines + exit 1.
 */

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

// Anchor to this script's location, not the caller's cwd — running it from
// anywhere else must still resolve the repo root and the sibling package.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = path.resolve(ROOT, '..', 'savant-ds');
const SCRATCH = path.resolve(ROOT, '.devin', 'tmp', 'ds-consumer-1034');

// ── 1. Package skeleton exists ────────────────────────────────────────────

check('savant-ds dir exists', existsSync(DS), DS);
check('savant-ds is a git repo', existsSync(path.join(DS, '.git')));

const pkgPath = path.join(DS, 'package.json');
check('package.json exists', existsSync(pkgPath));
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    check('name is savant-ds', pkg.name === 'savant-ds', pkg.name);
    check('version set', typeof pkg.version === 'string' && pkg.version.length > 0, pkg.version);
  } catch (err) {
    check('package.json parses', false, String(err));
  }
}
check('styles/ dir exists', existsSync(path.join(DS, 'styles')));
check('styles/_index.scss exists', existsSync(path.join(DS, 'styles', '_index.scss')));
check('scripts/ dir exists', existsSync(path.join(DS, 'scripts')));
check('README.md exists', existsSync(path.join(DS, 'README.md')));

// ── 2. Dry-run resolve via the real consumer specifier ────────────────────

const dry = spawnSync('npm', ['install', '--dry-run', 'savant-ds@file:../savant-ds'], {
  cwd: ROOT,
  shell: true,
  encoding: 'utf8',
});
const dryOut = `${dry.stdout ?? ''}${dry.stderr ?? ''}`;
// Exit 0 proves npm resolved the spec — dry-run fails on unresolvable
// file: paths. The literal name only appears in output when npm plans a
// change; once #1039 declared+installed the dep at this spec, dry-run
// reports up-to-date work and legitimately omits it.
check('npm --dry-run resolves file:../savant-ds', dry.status === 0,
  dry.status !== 0 ? dryOut.slice(0, 300) : 'resolved');

// ── 3. Real install into a scratch consumer ───────────────────────────────

rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
writeFileSync(
  path.join(SCRATCH, 'package.json'),
  JSON.stringify({
    name: 'ds-consumer-1034',
    private: true,
    dependencies: { 'savant-ds': 'file:../../../../savant-ds' },
  }),
);
const inst = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock'], {
  cwd: SCRATCH,
  shell: true,
  encoding: 'utf8',
});
check('scratch consumer npm install', inst.status === 0,
  inst.status !== 0 ? `${inst.stderr ?? ''}`.slice(0, 300) : 'installed');

const installed = path.join(SCRATCH, 'node_modules', 'savant-ds');
check('node_modules/savant-ds exists', existsSync(installed));
if (existsSync(installed)) {
  // npm links file: deps as junctions on Windows — lstat reports them as
  // symbolic links. A plain directory here means npm copied instead of
  // linked, which silently breaks the edit-in-place consumption story.
  const isLink = lstatSync(installed).isSymbolicLink();
  check('installed entry is a link/junction', isLink, isLink ? 'junction' : 'not-a-link');
  try {
    const inner = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
    check('installed package.json readable', inner.name === 'savant-ds', inner.name);
  } catch (err) {
    check('installed package.json parses', false, String(err));
  }
}

rmSync(SCRATCH, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
