/**
 * Verification relay — #1040: _pd-visual-language delegation shim.
 *
 * Proves the shim contract without duplicating the package's own verify:
 *  1. The shim forwards the savant-ds index (delegation, not copy).
 *  2. Zero mixin bodies for the 7 graduated names remain in the file —
 *     sole-source local mixins (dense-table, state-block,
 *     bounded-tab-group, tab-scroll-pane, stat-strip) may keep bodies
 *     until #1052 graduates them.
 *  3. $up/$down are --ds-* reads, not literals.
 *  4. The header points readers at savant-ds.
 *  5. A sass compile through the real includePaths + shim resolves all
 *     12 mixin names + 2 vars (14 `vl.*` members), emits no `:root`
 *     token leakage, and emits declarations for the delegated ones
 *     (verbatim semantics were proven by the #1036/#1037 parity probes —
 *     this asserts the delegation is live, not the decl text).
 *
 * Usage: npx tsx scripts/verify/design-system-vl-shim-1040.ts
 * Needs the sibling ../savant-ds checkout (npm-installed as a junction).
 * Pass: every check prints OK; exit 0. Fail: FAIL lines + exit 1.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = join(ROOT, '..', 'savant-ds');
const SHIM = join(
  ROOT,
  'src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss',
);

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

if (!existsSync(DS)) {
  console.log('SKIPPED — ../savant-ds checkout not found');
  process.exit(0);
}
check('shim file exists', existsSync(SHIM));

let src = '';
try { src = readFileSync(SHIM, 'utf8'); } catch { /* existence checked */ }

// Comments stripped so a commented-out @forward/@mixin can't fake a pass.
const body = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n');

// ── 1. Delegates via the package index — exactly once ──────────────────────
const forwards = [...body.matchAll(/@forward\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
check("shim @forward 'index'", forwards.includes('index'));
check('index is the only forward', forwards.length === 1, forwards.join(','));

// A same-directory `index`/`_index` partial (or index/ dir) resolves
// importer-relative BEFORE the package includePaths — silently rerouting
// the delegation while every other check stays green.
const shimStylesDir = dirname(SHIM);
let shadowEntries: string[] = [];
try {
  shadowEntries = readdirSync(shimStylesDir)
    .filter((e) => /^_?index\.(scss|sass|css)$/.test(e) || e === 'index');
} catch { /* dir read raced — compile check below still runs */ }
check(
  'no index* shadow beside the shim',
  shadowEntries.length === 0,
  shadowEntries.join(','),
);

// ── 2. Zero duplicated bodies for the delegated names ──────────────────────
const DELEGATED = [
  'page-host', 'page-shell', 'content-column', 'header-bar',
  'dialog-chrome', 'dialog-status', 'error-banner',
];
const LOCAL = [
  'dense-table', 'state-block', 'bounded-tab-group',
  'tab-scroll-pane', 'stat-strip',
];
const defined = [...body.matchAll(/@mixin\s+([\w-]+)/g)].map((m) => m[1]);
for (const name of DELEGATED) {
  check(`no local @mixin ${name} body (delegated)`, !defined.includes(name));
}
for (const name of LOCAL) {
  check(`local @mixin ${name} kept (sole-source pending #1052)`, defined.includes(name));
}
check(
  'no unexpected extra mixins',
  defined.every((n) => DELEGATED.includes(n) || LOCAL.includes(n)),
  defined.join(','),
);

// ── 3. $up/$down are token reads ───────────────────────────────────────────
check('$up reads var(--ds-up)', /\$up:\s*var\(--ds-up\)/.test(body));
check('$down reads var(--ds-down)', /\$down:\s*var\(--ds-down\)/.test(body));
check('no hex accent literals remain', !/#4caf50|#f44336/i.test(body));

// ── 4. Header points at savant-ds ──────────────────────────────────────────
check('header names savant-ds as source of truth', /savant-ds/.test(src));
check('header describes delegation-shim role', /delegation shim/i.test(src));

// ── 5. Live resolution through the real includePaths ───────────────────────
let sass: {
  compileString(
    source: string,
    opts: { loadPaths: string[]; url?: URL },
  ): { css: string };
};
try {
  const req = createRequire(join(DS, 'package.json'));
  sass = req('sass');
  check('sass resolvable from the savant-ds checkout', true);
} catch (err) {
  sass = { compileString: () => { throw err; } };
  check('sass resolvable from the savant-ds checkout', false,
    `npm install in ../savant-ds required — ${String(err).slice(0, 120)}`);
}

const shimDir = dirname(SHIM);
// `@use 'styles/pd-visual-language'` — the specifier the feature-root
// call sites use; `components/` sites use relative paths to the same
// file. Fixture covers all 12 mixin names + both vars (14 vl.* members).
const fixture = `
@use 'styles/pd-visual-language' as vl;
.a { @include vl.page-shell; }
.b { @include vl.header-bar; }
.c { @include vl.dialog-chrome; }
.d { @include vl.dialog-status; }
.e { @include vl.error-banner; }
.f { @include vl.dense-table; }
.g { @include vl.state-block; }
.h { @include vl.bounded-tab-group; }
.i { @include vl.tab-scroll-pane; }
.j { @include vl.stat-strip; }
.k { color: vl.$up; }
.l { color: vl.$down; }
.m { @include vl.page-host; }
.n { @include vl.content-column; }
`;

let css = '';
try {
  css = sass.compileString(fixture, {
    // [feature dir (for 'styles/…'), savant-ds styles (for 'index')]
    loadPaths: [dirname(shimDir), join(DS, 'styles')],
  }).css;
  check('all 14 vl.* call-site members resolve + compile through the shim', true);
} catch (err) {
  check('all 14 vl.* call-site members resolve + compile through the shim', false,
    String(err).slice(0, 400));
}

// A forwarded token layer (against the package's own contract) would
// re-emit `:root` into every component chunk — assert it can't.
check('shim emits no :root/token leakage', !css.includes(':root'));

// Delegated mixins emit through the shim (the mixin names resolve — the
// verbatim decl semantics were proven by the ds-parity probe).
for (const sel of ['.a', '.b', '.c', '.d', '.e', '.f', '.g', '.h', '.i', '.j', '.m', '.n']) {
  check(`${sel} emitted via the shim`, css.includes(sel));
}
check('vl.$up emits var(--ds-up)', /\.k\s*\{[^}]*var\(--ds-up\)/s.test(css));
check('vl.$down emits var(--ds-down)', /\.l\s*\{[^}]*var\(--ds-down\)/s.test(css));

console.log(failed === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failed} CHECK(S) FAILED ===`);
process.exit(failed === 0 ? 0 : 1);
