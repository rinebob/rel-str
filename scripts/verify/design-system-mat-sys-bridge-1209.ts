/**
 * Verification: --mat-sys dark+light bridge (task #1209, FE blueprint).
 *
 * Proves `src/styles.scss` emits a complete `--mat-sys-*` bridge in
 * both modes so un-migrated Material components stay legible:
 *  1. styles.scss compiles through the real includePaths (vendored
 *     savant-ds tokens + local partials) via dart-sass `compile`.
 *  2. The dark `--mat-sys-*` set lives under `:root` — dark is the app
 *     default (#1207 bootstrap), so the un-attributed fallback must be
 *     dark, not light. (The task ACs override the older IMPL/TEST
 *     docs' `:root`-light wording.)
 *  3. `[data-theme="light"]` re-declares the exact pre-#1209 light
 *     literals — pinned verbatim below so a dark-mode slip can't
 *     silently corrupt the light theme.
 *  4. Emission order: the light block follows `:root` (equal
 *     specificity → source order decides) and `color-scheme` flips
 *     with the mode so UA chrome (scrollbars, form controls) matches.
 *  5. `--app-header-height` stays mode-agnostic under `:root`.
 *
 * Usage: npx tsx scripts/verify/design-system-mat-sys-bridge-1209.ts
 *
 * No credentials. Pass: every check prints OK; exit 0.
 * Fail: FAIL lines + exit 1.
 */

import { existsSync } from 'node:fs';
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
const STYLES = path.join(ROOT, 'src', 'styles.scss');
const DS_STYLES = path.join(ROOT, 'node_modules', 'savant-ds', 'styles');

// ── 1. Compile the real global stylesheet ────────────────────────────────

if (!existsSync(DS_STYLES)) {
  // node_modules/savant-ds is a file:vendor dep — missing means npm
  // install hasn't run; nothing meaningful can compile. Report, don't
  // hard-fail the run-all sweep.
  console.log('SKIP — node_modules/savant-ds missing (run npm install)');
  process.exit(0);
}

const require2 = createRequire(path.join(ROOT, 'package.json'));
let cssRaw = '';
try {
  const sass = require2('sass') as {
    compile(file: string, opts: { loadPaths: string[] }): { css: string };
  };
  ({ css: cssRaw } = sass.compile(STYLES, { loadPaths: [DS_STYLES] }));
  check('styles.scss compiles through vendored includePaths', cssRaw.length > 0);
} catch (err) {
  check('styles.scss compiles through vendored includePaths', false, String(err).slice(0, 200));
  console.log(`\n${failures} FAIL`);
  process.exit(1);
}

// Strip loud comments — a comment can fake a declaration.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

// Selector → declaration-block map (mirrors the theme-tokens relay):
// dart-sass strips attribute-selector quotes — [data-theme="light"]
// emits as [data-theme=light].
function blocksFor(selector: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push(m[1]);
  return out;
}

const rootBlocks = blocksFor(':root').filter((b) => b.includes('--mat-sys'));
const lightBlocks = blocksFor('[data-theme=light]').filter((b) => b.includes('--mat-sys'));

// ── 2. Dark set under :root — complete + dark-default semantics ──────────

check('a :root block carries the --mat-sys bridge', rootBlocks.length > 0);
const darkBlock = rootBlocks.join('\n');

// Exact dark literals — pinning the shipped values subsumes a "not the
// old light set" check (a `\s*` + lookahead guard can't pin this
// safely: backtracking lets the lookahead evaluate at the space before
// the value). Source of truth: the bridge values in styles.scss, keyed
// to the ds-gallery demo dark ramp they replace (#1209).
const DARK: Record<string, string> = {
  '--mat-sys-primary': '#a3b8ff',
  '--mat-sys-on-primary': '#1a237e',
  '--mat-sys-primary-container': '#39448b',
  '--mat-sys-on-primary-container': '#dae1ff',
  '--mat-sys-secondary': '#4db6ac',
  '--mat-sys-on-secondary': '#00382f',
  '--mat-sys-secondary-container': '#00524a',
  '--mat-sys-on-secondary-container': '#a7e8dc',
  '--mat-sys-tertiary': '#f48fb1',
  '--mat-sys-on-tertiary': '#6b0f3d',
  '--mat-sys-tertiary-container': '#9c1d5a',
  '--mat-sys-on-tertiary-container': '#ffd1e1',
  '--mat-sys-error': '#ef9a9a',
  '--mat-sys-on-error': '#5c1210',
  '--mat-sys-error-container': '#7e2222',
  '--mat-sys-on-error-container': '#ffd7d7',
  '--mat-sys-surface': '#131518',
  '--mat-sys-on-surface': '#e2e4e8',
  '--mat-sys-on-surface-variant': '#a8adb5',
  '--mat-sys-surface-container': '#1c1f24',
  '--mat-sys-surface-container-high': '#262a31',
  '--mat-sys-surface-container-highest': '#31363e',
  '--mat-sys-surface-container-low': '#17191d',
  '--mat-sys-outline': '#84898f',
  '--mat-sys-outline-variant': '#3c4149',
  '--mat-sys-success': '#81c784',
  '--mat-sys-on-success': '#0e3012',
  '--mat-sys-success-container': '#2c4a2e',
  '--mat-sys-on-success-container': '#c8e6c9',
  '--mat-sys-warning-container': '#7a4a15',
  '--mat-sys-on-warning-container': '#ffe0b2',
};

const missingIn = (map: Record<string, string>, block: string): string[] =>
  Object.entries(map)
    .filter(([k, v]) => !new RegExp(`${k}\\s*:\\s*${v};`).test(block))
    .map(([k, v]) => `${k}: ${v}`);

check(':root dark set = exact bridge literals (all 31)',
  missingIn(DARK, darkBlock).length === 0, missingIn(DARK, darkBlock).slice(0, 3).join(', '));

check('no [data-theme="dark"] --mat-sys block (dark lives in :root)',
  blocksFor('[data-theme=dark]').every((b) => !b.includes('--mat-sys')));

// ── 3. Light block — exact pre-#1209 literals ────────────────────────────

check('a [data-theme=light] block carries the light bridge', lightBlocks.length > 0);
const lightBlock = lightBlocks.join('\n');

const LIGHT: Record<string, string> = {
  '--mat-sys-primary': '#3f51b5',
  '--mat-sys-on-primary': '#ffffff',
  '--mat-sys-primary-container': '#e8eaf6',
  '--mat-sys-on-primary-container': '#1a237e',
  '--mat-sys-secondary': '#018786',
  '--mat-sys-on-secondary': '#ffffff',
  '--mat-sys-secondary-container': '#e0f2f1',
  '--mat-sys-on-secondary-container': '#004d40',
  '--mat-sys-tertiary': '#e91e63',
  '--mat-sys-on-tertiary': '#ffffff',
  '--mat-sys-tertiary-container': '#f8bbd0',
  '--mat-sys-on-tertiary-container': '#880e4f',
  '--mat-sys-error': '#f44336',
  '--mat-sys-on-error': '#ffffff',
  '--mat-sys-error-container': '#ffebee',
  '--mat-sys-on-error-container': '#b71c1c',
  '--mat-sys-surface': '#ffffff',
  '--mat-sys-on-surface': '#000000',
  '--mat-sys-on-surface-variant': '#444746',
  '--mat-sys-surface-container': '#f3f6fc',
  '--mat-sys-surface-container-high': '#e8eaf6',
  '--mat-sys-surface-container-highest': '#dbe1ee',
  '--mat-sys-outline': '#747775',
  '--mat-sys-outline-variant': '#c7cbda',
  '--mat-sys-surface-container-low': '#f8f9fd',
  '--mat-sys-success': '#4caf50',
  '--mat-sys-on-success': '#ffffff',
  '--mat-sys-success-container': '#c8e6c9',
  '--mat-sys-on-success-container': '#1b5e20',
  '--mat-sys-warning-container': '#fff3e0',
  '--mat-sys-on-warning-container': '#e65100',
};

check('light block = exact pre-#1209 literals (all 31)',
  missingIn(LIGHT, lightBlock).length === 0, missingIn(LIGHT, lightBlock).slice(0, 3).join(', '));

// ── 4. Emission order + color-scheme ─────────────────────────────────────

const rootIdx = css.search(/:root\s*\{[^}]*--mat-sys/);
const lightIdx = css.search(/\[data-theme=light\]\s*\{[^}]*--mat-sys/);
check('light block follows :root (equal specificity → order decides)',
  rootIdx >= 0 && lightIdx > rootIdx);
check('color-scheme: dark on the default root bridge',
  /:root\s*\{[^}]*color-scheme\s*:\s*dark/.test(css));
check('color-scheme: light on the light override',
  /\[data-theme=light\]\s*\{[^}]*color-scheme\s*:\s*light/.test(css));

// Anti-smuggle: literal pins only prove the pinned value EXISTS — a later
// re-declaration (a second :root, or a block sneaked into the Syncfusion
// @import's output) would silently win the cascade while every pin stays
// green. Each key must appear exactly twice in the emitted sheet: once
// in the :root bridge, once in the light override. (1204 relay parity.)
const doubleDeclared = Object.keys(DARK).filter(
  (k) => (css.match(new RegExp(`${k}\\s*:`, 'g')) ?? []).length !== 2);
check('each --mat-sys-* key declared exactly twice (dark+light, no overrides)',
  doubleDeclared.length === 0, doubleDeclared.slice(0, 3).join(', '));

// ── 5. Mode-agnostic custom props survive ────────────────────────────────

check('--app-header-height still declared once under :root',
  blocksFor(':root').some((b) => /--app-header-height\s*:/.test(b))
    && (css.match(/--app-header-height\s*:/g) ?? []).length === 1);

console.log('');
if (failures === 0) {
  console.log(`=== ALL ${checks} CHECKS PASSED ===`);
} else {
  console.log(`=== ${failures}/${checks} CHECKS FAILED ===`);
  process.exit(1);
}
