/**
 * Verification: savant-ds consumption wiring (task #1039, FE blueprint).
 *
 * Proves THIS app consumes the package — the #1034 scratch-consumer
 * relay proved file: installability in isolation; this checks the real
 * wiring the app builds with.
 *
 * Checks:
 *  1. package.json declares `"savant-ds": "file:vendor/savant-ds"` and
 *     node_modules/savant-ds resolves to the committed vendor/ copy —
 *     #1071: the sibling file: dep can't resolve in cloud builds, so the
 *     vendored copy is what ships; the sibling checkout stays the source
 *     of truth and drift is checked byte-for-byte below.
 *  2. angular.json carries the includePaths entry on BOTH targets that
 *     compile SCSS (build + test).
 *  3. src/styles.scss loads the token layer via the package specifier.
 *  4. A sass compile through the REAL includePaths emits every --ds-*
 *     token on :root + the dark overrides — the same tokens the
 *     package's own verify pins (read live, not hard-coded).
 *
 * Usage: npx tsx scripts/verify/design-system-consumption-1039.ts
 *
 * No credentials. When the sibling checkout is absent the script prints
 * SKIPPED and exits 0 (matches the other savant-ds relays).
 * Pass: every check prints OK; exit 0. Fail: FAIL lines + exit 1.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let failures = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = path.resolve(ROOT, '..', 'savant-ds');
const VENDOR = path.join(ROOT, 'vendor', 'savant-ds');
const INSTALLED = path.join(ROOT, 'node_modules', 'savant-ds');
const STYLES_DIR = path.join(INSTALLED, 'styles');

if (!existsSync(DS)) {
  console.log(`SKIPPED — ${DS} not checked out on this machine`);
  process.exit(0);
}

// ── 1. file: dependency declared + linked ─────────────────────────────────

let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
try {
  pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
} catch (err) {
  check('package.json parses', false, String(err).slice(0, 120));
}
const spec: string = pkg?.dependencies?.['savant-ds'] ?? pkg?.devDependencies?.['savant-ds'] ?? '';
check("package.json declares savant-ds 'file:vendor/savant-ds'",
  spec === 'file:vendor/savant-ds', spec || 'not declared');

check('node_modules/savant-ds exists', existsSync(INSTALLED));
if (existsSync(INSTALLED)) {
  // A plain directory means npm copied — vendor edits wouldn't propagate
  // and a stale copy could ship unnoticed.
  const isLink = lstatSync(INSTALLED).isSymbolicLink();
  check('installed entry is a link/junction', isLink, isLink ? 'junction' : 'not-a-link');
  try {
    const target = realpathSync(INSTALLED);
    check('link resolves to the committed vendor/ copy',
      path.resolve(target) === path.resolve(VENDOR), target);
  } catch (err) {
    check('link target resolvable', false, String(err));
  }
  check('styles/ readable through the link', existsSync(STYLES_DIR));
}

// Vendor drift — the committed copy is what cloud builds see. Compare
// every file (names + bytes) against the sibling checkout's styles/ so
// an unsynced package edit fails loudly with the remedy printed.
const srcStyles = path.join(DS, 'styles');
check('vendor/savant-ds/styles exists', existsSync(path.join(VENDOR, 'styles')));
if (existsSync(srcStyles) && existsSync(path.join(VENDOR, 'styles'))) {
  const namesOf = (d: string) => readdirSync(d, { withFileTypes: true })
    .filter((e) => e.isFile()).map((e) => e.name).sort();
  const srcNames = namesOf(srcStyles);
  const dstNames = namesOf(path.join(VENDOR, 'styles'));
  check('vendor styles match package filenames',
    srcNames.join(',') === dstNames.join(','),
    `src:${srcNames.join(',')} vendor:${dstNames.join(',')}`);
  const drifted = srcNames.filter((f) =>
    !readFileSync(path.join(srcStyles, f))
      .equals(readFileSync(path.join(VENDOR, 'styles', f))));
  check('vendor styles byte-identical to ../savant-ds (npm run sync:ds to fix)',
    drifted.length === 0, drifted.join(', '));
}

// ── 2. angular.json includePaths on both SCSS-compiling targets ───────────

let targets: Record<string, { options?: { stylePreprocessorOptions?: { includePaths?: string[] } } }> = {};
try {
  const angular = JSON.parse(readFileSync(path.join(ROOT, 'angular.json'), 'utf8'));
  targets = angular?.projects?.['rel-str']?.architect ?? {};
} catch (err) {
  check('angular.json parses', false, String(err).slice(0, 120));
}
for (const t of ['build', 'test']) {
  const paths: string[] = targets?.[t]?.options?.stylePreprocessorOptions?.includePaths ?? [];
  check(`angular.json ${t} target has savant-ds includePaths`,
    paths.includes('node_modules/savant-ds/styles'), paths.join(', ') || 'none');
}

// ── 3. styles.scss emits the token layer ──────────────────────────────────

const stylesScss = readFileSync(path.join(ROOT, 'src', 'styles.scss'), 'utf8')
  .replaceAll(/\/\*[\s\S]*?\*\//g, '')
  .replaceAll(/\/\/.*$/gm, '');
check("styles.scss loads 'tokens' via the package",
  /@use\s+['"]tokens['"]/.test(stylesScss));

// A same-dir partial shadows the includePaths — `@use 'tokens'` in
// src/styles.scss resolves `src/_tokens.scss`/`src/tokens.scss` BEFORE the
// package path, so a future file named that way silently reroutes the
// token layer while every check above stays green. Guard the src/ root
// for the package's partial names.
const srcEntries = existsSync(path.join(ROOT, 'src'))
  ? readdirSync(path.join(ROOT, 'src'))
  : [];
// Derived from the installed package's styles/ dir — a new partial name
// (data-display shipped in #1052) enters the guard automatically.
const SHADOWABLE = (existsSync(STYLES_DIR) ? readdirSync(STYLES_DIR) : [])
  .map((f) => f.replace(/^_/, '').replace(/\.(scss|sass|css)$/, ''));
const shadows = srcEntries.filter((e) =>
  SHADOWABLE.includes(e)
  || SHADOWABLE.some((n) => e === `_${n}.scss` || e === `${n}.scss` || e === `_${n}.sass` || e === `${n}.sass`),
);
check('no src/-level partial shadows the package names',
  shadows.length === 0, shadows.join(', '));

// ── 4. Tokens emit through the REAL includePaths ──────────────────────────
// Compile the app's own entry line through includePaths exactly as the
// Angular build does — proves `--ds-*` lands on :root at runtime.
// Token names come from the package's own _tokens.scss (single source
// of truth) so a token added there is demanded here too.
const tokensPath = path.join(STYLES_DIR, '_tokens.scss');
check('installed styles/_tokens.scss exists', existsSync(tokensPath));
if (existsSync(tokensPath)) {
  const tokensSrc = readFileSync(tokensPath, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\/\/.*$/gm, '');
  const declared = [...new Set(
    [...tokensSrc.matchAll(/(--ds-[\w-]+)\s*:/g)].map((m) => m[1]),
  )];

  // Use the package's own `sass` devDependency — the compiler its verify
  // pins — resolved through the sibling checkout's node_modules (rel-str
  // doesn't declare sass; Angular bundles it internally).
  try {
    const require = createRequire(path.join(DS, 'package.json'));
    const sass = require('sass') as {
      compileString(src: string, opts: { loadPaths: string[] }): { css: string };
    };
    const { css } = sass.compileString("@use 'tokens';\n", { loadPaths: [STYLES_DIR] });
    const emitted = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    // Scope to the :root block with boundary-exact names — a plain
    // includes() would let '--ds-surface' match inside
    // '--ds-surface-variant', and a dark-block remnant could mask a
    // missing :root declaration.
    const rootDecls = new Set(
      [...emitted.matchAll(/:root\s*\{([^}]*)\}/g)]
        .flatMap((m) => [...m[1].matchAll(/(--ds-[\w-]+)\s*:/g)].map((d) => d[1])),
    );
    check('tokens compile through installed includePaths',
      rootDecls.size > 0, rootDecls.size ? 'compiled' : 'no :root block');
    for (const token of declared) {
      check(`token ${token} emitted on :root`, rootDecls.has(token));
    }
    check('dark-theme overrides emit through app wiring',
      /\[data-theme=("dark"|dark)\]/.test(emitted));
  } catch (err) {
    check('tokens compile through installed includePaths', false,
      String(err).slice(0, 200));
  }
}

if (failures > 0) {
  console.log(`\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(1);
}
console.log('\n=== ALL CHECKS PASSED ===');
