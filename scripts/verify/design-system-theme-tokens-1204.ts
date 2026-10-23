/**
 * Verification: savant-ds theme token layer (task #1204, SHARED blueprint).
 *
 * Proves `_tokens.scss` emits the complete semantic color vocabulary for
 * the Theme & Palette thread (#1161):
 *  1. The package file compiles via `sass` (compileString through the
 *     vendored includePaths — the same path the app build uses). The
 *     compiler is resolved through the package's own package.json — the
 *     version its verify pins, not an ambient hoisted copy.
 *  2. The :root block emits EXACTLY the 47-token contract (set-equality
 *     both directions, boundary-exact name matching — a longer sibling
 *     like --ds-surface-raised can't satisfy --ds-surface).
 *  3. Emission model: light set under `:root`, dark overrides under
 *     `[data-theme=dark]` — the staging-safe order (no flip until the
 *     F1 bootstrap sets the attribute). The dark block covers every
 *     color token + shadows and NO geometry token.
 *  4. Shipped values are baked literals — no color-mix( anywhere.
 *  5. Direction defaults preserved in both modes:
 *     --ds-up #4caf50 / --ds-down #f44336.
 *  6. The vendored copy consumed by the app is content-identical to the
 *     sibling package checkout (npm run sync:ds to fix drift).
 *
 * Usage: npx tsx scripts/verify/design-system-theme-tokens-1204.ts
 *
 * No credentials. When the sibling savant-ds checkout is absent the
 * script prints SKIPPED and exits 0 (matches the other savant-ds relays).
 * Pass: every check prints OK; exit 0. Fail: FAIL lines + exit 1.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let failures = 0;
let checks = 0;

function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  checks++;
  if (!ok) failures++;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = path.resolve(ROOT, '..', 'savant-ds');
const VENDOR_TOKENS = path.join(ROOT, 'vendor', 'savant-ds', 'styles', '_tokens.scss');
const INSTALLED_STYLES = path.join(ROOT, 'node_modules', 'savant-ds', 'styles');

if (!existsSync(path.join(DS, 'styles', '_tokens.scss'))) {
  console.log(`SKIPPED — ${DS} not checked out on this machine`);
  process.exit(0);
}
if (!existsSync(INSTALLED_STYLES)) {
  console.log('SKIPPED — node_modules/savant-ds missing; run npm install');
  process.exit(0);
}

// ── 1. Compile through the real includePaths ──────────────────────────────

const require2 = createRequire(path.join(DS, 'package.json'));
let cssRaw = '';
try {
  const sass = require2('sass') as {
    compileString(src: string, opts: { loadPaths: string[] }): { css: string };
  };
  ({ css: cssRaw } = sass.compileString("@use 'tokens';\n", { loadPaths: [INSTALLED_STYLES] }));
  check('tokens compile through installed includePaths', cssRaw.length > 0);
} catch (err) {
  check('tokens compile through installed includePaths', false, String(err).slice(0, 200));
  console.log(`\n${failures} FAIL`); process.exit(1);
}

// Strip loud /* */ comments before regex scanning — a comment can fake
// a declaration (same guard as the package's verify.mjs).
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

// ── 2. The :root block emits exactly the 47-token contract ────────────────
//
// REQUIRED is the hand-pinned name contract (mirrors TOKENS in the
// package's scripts/verify.mjs). Boundary-exact declaration matching —
// css.includes('--ds-surface') would let '--ds-surface-raised' satisfy a
// missing '--ds-surface' (documented hazard in consumption-1039).
const REQUIRED = [
  // neutral surfaces + text + borders
  '--ds-surface', '--ds-surface-raised', '--ds-surface-overlay',
  '--ds-surface-variant', '--ds-on-surface', '--ds-on-surface-variant',
  '--ds-border-subtle', '--ds-border-strong',
  // brand accent family
  '--ds-accent', '--ds-on-accent', '--ds-accent-container',
  '--ds-on-accent-container', '--ds-accent-border', '--ds-accent-glow',
  // direction colors
  '--ds-up', '--ds-on-up-container', '--ds-up-container',
  '--ds-down', '--ds-on-down-container', '--ds-down-container',
  // feedback family
  '--ds-success', '--ds-on-success-container', '--ds-success-container',
  '--ds-error', '--ds-on-error-container', '--ds-error-container',
  '--ds-warning', '--ds-on-warning-container', '--ds-warning-container',
  // geometry (theme-invariant)
  '--ds-space-1', '--ds-space-2', '--ds-space-3',
  '--ds-space-4', '--ds-space-5', '--ds-space-6',
  '--ds-font-size-sm', '--ds-font-size-md', '--ds-font-size-lg',
  '--ds-font-weight-regular', '--ds-font-weight-medium', '--ds-font-weight-bold',
  '--ds-row-height', '--ds-field-height',
  '--ds-radius-sm', '--ds-radius-md', '--ds-shadow-1', '--ds-shadow-2',
];

// Selector → declaration map over the WHOLE sheet (mirrors verify.mjs's
// declsOf): repeated selectors concatenate so a second :root can't
// smuggle decls past a first-match, and ALL declarations are mapped so
// a non---ds-* or stray-rule emission can't hide inside the blocks.
const declsOf = (sheet: string): Map<string, string[]> => {
  const map = new Map<string, string[]>();
  for (const m of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const decls = m[2].trim().split(';').filter(Boolean)
      .map((d) => d.trim().replace(/\s+/g, ' '));
    map.set(sel, (map.get(sel) ?? []).concat(decls));
  }
  return map;
};
const declMapOf = (sel: string | undefined, blocks: Map<string, string[]>) => {
  const m = new Map<string, string>();
  for (const d of blocks.get(sel ?? '') ?? []) {
    const i = d.indexOf(':');
    m.set(d.slice(0, i).trim(), d.slice(i + 1).trim());
  }
  return m;
};

const blocks = declsOf(css);
const darkSel = [...blocks.keys()].find((s) =>
  /^\[data-theme=(?:"dark"|'dark'|dark)\]$/.test(s));
const stray = [...blocks.keys()].filter((s) => s !== ':root' && s !== darkSel);
check('tokens emit only :root + [data-theme=dark] blocks (no stray rules/at-rules)',
  stray.length === 0 && !/@(media|supports|keyframes|font-face|layer|container|scope|property)\b/.test(css),
  stray.join(', '));

const rootDecls = declMapOf(':root', blocks);
check(':root block present', rootDecls.size > 0);

const emitted = [...rootDecls.keys()].sort();
const contracted = [...REQUIRED].sort();
check(`:root emits exactly the ${REQUIRED.length}-token contract`,
  emitted.join(',') === contracted.join(','),
  emitted.join(',') === contracted.join(',')
    ? ''
    : `extra: ${emitted.filter((n) => !contracted.includes(n))}; `
      + `missing: ${contracted.filter((n) => !emitted.includes(n))}`);

// ── 3. Emission model — :root light, [data-theme=dark] overrides ──────────

// dart-sass strips attribute-selector quotes on identifier values; the
// accepted quoted/unquoted forms were collected into darkSel above.
const darkDecls = declMapOf(darkSel, blocks);
check('[data-theme=dark] block present', darkDecls.size > 0);
if (darkDecls.size > 0) {
  // Geometry tokens are theme-invariant and never re-emit in dark;
  // shadows DO (deeper alpha), so they're part of the expected set.
  const GEOMETRY = [
    '--ds-space-1', '--ds-space-2', '--ds-space-3',
    '--ds-space-4', '--ds-space-5', '--ds-space-6',
    '--ds-font-size-sm', '--ds-font-size-md', '--ds-font-size-lg',
    '--ds-font-weight-regular', '--ds-font-weight-medium',
    '--ds-font-weight-bold', '--ds-row-height', '--ds-field-height',
    '--ds-radius-sm', '--ds-radius-md',
  ];
  const expectedDark = REQUIRED.filter((n) => !GEOMETRY.includes(n)).sort();
  const darkNames = [...darkDecls.keys()].sort();
  check('dark block overrides every color token + shadows, nothing else',
    darkNames.join(',') === expectedDark.join(','),
    darkNames.join(',') === expectedDark.join(',')
      ? ''
      : `extra: ${darkNames.filter((n) => !expectedDark.includes(n))}; `
        + `missing: ${expectedDark.filter((n) => !darkNames.includes(n))}`);
  for (const name of darkDecls.keys()) {
    check(`dark override ${name} exists in :root`, rootDecls.has(name));
  }
}

// ── 4. No color-mix in shipped tokens ─────────────────────────────────────

check('no color-mix( in emitted declarations', !/color-mix\(/.test(css));

// ── 5. Direction defaults preserved in both modes ─────────────────────────

for (const [label, decls] of [[':root', rootDecls], ['dark', darkDecls]] as const) {
  check(`${label} --ds-up default is #4caf50`, decls.get('--ds-up') === '#4caf50',
    `got ${decls.get('--ds-up')}`);
  check(`${label} --ds-down default is #f44336`, decls.get('--ds-down') === '#f44336',
    `got ${decls.get('--ds-down')}`);
}

// ── 6. Vendored copy is content-identical to the sibling checkout ─────────

const normalize = (p: string) => readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
const srcTokens = path.join(DS, 'styles', '_tokens.scss');
check('vendor/savant-ds/_tokens.scss exists', existsSync(VENDOR_TOKENS));
if (existsSync(VENDOR_TOKENS)) {
  check('vendored _tokens.scss identical to ../savant-ds (npm run sync:ds to fix)',
    normalize(srcTokens) === normalize(VENDOR_TOKENS));
}

// ── Result ────────────────────────────────────────────────────────────────

if (failures === 0) {
  console.log(`\n=== ALL ${checks} CHECKS PASSED ===`);
} else {
  console.log(`\n${failures}/${checks} checks FAILED`);
}
process.exit(failures === 0 ? 0 : 1);
