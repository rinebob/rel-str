/**
 * #1207 — theme plumbing relay: bootstrap + ThemeService + header toggle.
 *
 * Static checks (no credentials, no dev server):
 *   1. index.html carries the synchronous pre-paint bootstrap reading
 *      localStorage['savant-theme'] and writing data-theme on
 *      documentElement — inline, in <head>, before <app-root>.
 *   2. ThemeService exists and is the authority: root-provided,
 *      signal-backed, writes data-theme + persists, has set/toggle,
 *      no prefers-color-scheme probing.
 *   3. The header wires the toggle: injects ThemeService and calls
 *      theme.toggle() from the template.
 *   4. Single-writer invariant: ThemeService is the only src/ file
 *      writing data-theme on the document root (the /dev/ds explorer's
 *      [attr.data-theme] host binding is preview-scoped and legal).
 *   5. ThemeService spec exists and covers the AC surface.
 *
 * Run from repo root:
 *   npx tsx scripts/verify/design-system-theme-plumbing-1207.ts
 *
 * Pass: every check prints OK; exit 0. Fail: FAIL lines + exit 1.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
const SRC = path.join(ROOT, 'src');
const INDEX_HTML = path.join(SRC, 'index.html');
const THEME_SVC = path.join(SRC, 'app', 'core', 'services', 'theme.service.ts');
const THEME_SPEC = path.join(SRC, 'app', 'core', 'services', 'theme.service.spec.ts');
const HEADER_TS = path.join(SRC, 'app', 'core', 'comps', 'header', 'header.component.ts');
const HEADER_HTML = path.join(SRC, 'app', 'core', 'comps', 'header', 'header.component.html');

// ── 1. index.html bootstrap ───────────────────────────────────────────────

const html = readFileSync(INDEX_HTML, 'utf8');
const headEnd = html.indexOf('</head>');
const head = headEnd >= 0 ? html.slice(0, headEnd) : html;
const bodyIdx = html.indexOf('<app-root>');

check('index.html bootstrap reads localStorage savant-theme',
  head.includes("localStorage.getItem('savant-theme')") ||
  head.includes('localStorage.getItem("savant-theme")'));
check('index.html bootstrap writes documentElement.dataset.theme',
  head.includes('document.documentElement.dataset.theme'));
check('bootstrap defaults to dark', /theme\s*=\s*'dark'/.test(head) || /theme\s*=\s*"dark"/.test(head));
check('bootstrap is inline in <head> before <app-root>',
  head.includes('<script>') && bodyIdx > headEnd);
check('bootstrap guards storage access (try/catch)', head.includes('try {') && head.includes('catch'));

// ── 2. ThemeService is the authority ──────────────────────────────────────

check('theme.service.ts exists', existsSync(THEME_SVC));
const svc = existsSync(THEME_SVC) ? readFileSync(THEME_SVC, 'utf8') : '';
check('root-provided injectable', svc.includes("providedIn: 'root'"));
check('signal-backed theme()', svc.includes('signal<AppTheme>') || svc.includes('signal'));
check('writes data-theme on documentElement',
  svc.includes('document.documentElement.dataset.theme'));
check('persists to localStorage savant-theme', svc.includes('savant-theme'));
check('toggle() + set() API', svc.includes('toggle(') && svc.includes('set('));
// Strip comments before probing — the docstring names the mechanism
// it avoids.
const svcCode = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
check('no prefers-color-scheme probing', !svcCode.includes('prefers-color-scheme'));

// ── 3. Header wires the toggle ────────────────────────────────────────────

const hts = existsSync(HEADER_TS) ? readFileSync(HEADER_TS, 'utf8') : '';
const hhtml = existsSync(HEADER_HTML) ? readFileSync(HEADER_HTML, 'utf8') : '';
check('header injects ThemeService', hts.includes('ThemeService'));
check('header template calls theme.toggle()', hhtml.includes('theme.toggle()'));

// ── 4. Single-writer invariant ────────────────────────────────────────────

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|html)$/.test(e)) yield p;
  }
}

const writers: string[] = [];
for (const f of walk(SRC)) {
  const rel = path.relative(ROOT, f);
  // Sanctioned writers: index.html's pre-paint bootstrap, the service
  // itself, and specs that exercise the attribute.
  if (f === INDEX_HTML || f === THEME_SVC || rel.endsWith('.spec.ts')) continue;
  const c = readFileSync(f, 'utf8');
  if (
    c.includes('document.documentElement.dataset.theme') ||
    /documentElement\.setAttribute\(\s*['"]data-theme['"]/.test(c)
  ) {
    writers.push(rel);
  }
}
check('ThemeService is the only documentElement data-theme writer in src/',
  writers.length === 0, writers.join(', '));

// ── 5. Spec covers the AC surface ─────────────────────────────────────────

check('theme.service.spec.ts exists', existsSync(THEME_SPEC));
const spec = existsSync(THEME_SPEC) ? readFileSync(THEME_SPEC, 'utf8') : '';
for (const [name, needle] of [
  ['spec: default dark', 'defaults to dark'],
  ['spec: stored light', 'stored light'],
  ['spec: corrupt fallback', 'corrupt'],
  ['spec: toggle', 'toggle flips'],
  ['spec: set + persist', 'set(light)'],
] as const) {
  check(name, spec.includes(needle));
}

console.log('');
if (failures === 0) {
  console.log(`=== ALL ${checks} CHECKS PASSED ===`);
} else {
  console.log(`=== ${failures}/${checks} CHECKS FAILED ===`);
  process.exit(1);
}
