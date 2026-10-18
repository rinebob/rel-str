/**
 * Verification relay — #1041: /dev/ds element gallery.
 *
 * Proves the gallery contract without a browser:
 *  1. Route wiring — AppRoutes.DS_GALLERY = 'dev/ds', PAGE_INFO entry,
 *     core-routes entry (loadComponent + authGuard, same shape as
 *     dev/gallery), nav child entry.
 *  2. Component files exist (ts/html/scss/spec).
 *  3. The SCSS consumes the package — `@use 'index' as ds`, every
 *     `@include ds.<name>` resolves to a real package mixin (parsed live
 *     from vendor styles), and there are ZERO local @mixin bodies —
 *     the gallery demos via the package, never copied declarations.
 *  4. The component's own SCSS compiles through the real includePaths —
 *     the same resolution the Angular build performs.
 *  5. Template contract — cards iterate `entries` (track entry.kind),
 *     every card carries a `.seen-in` footnote, the dark toggle binds
 *     [attr.data-theme] on the host.
 *
 * Usage: npx tsx scripts/verify/design-system-ds-gallery-1041.ts
 * Needs the sibling ../savant-ds checkout (sass resolved via
 * createRequire on its package, same as the other DS relays).
 * Pass: every check prints OK; exit 0. Fail: FAIL lines + exit 1.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DS = join(ROOT, '..', 'savant-ds');
const DS_STYLES = join(DS, 'styles');
const FEATURE = join(ROOT, 'src', 'app', 'features', 'ds-gallery');
const TS = join(FEATURE, 'ds-gallery.component.ts');
const HTML = join(FEATURE, 'ds-gallery.component.html');
const SCSS = join(FEATURE, 'ds-gallery.component.scss');
const SPEC = join(FEATURE, 'ds-gallery.component.spec.ts');
const ROUTES = join(ROOT, 'src', 'app', 'core', 'core-routes.ts');
const INTERFACES = join(ROOT, 'src', 'app', 'core', 'common', 'interfaces.ts');
const CONSTANTS = join(ROOT, 'src', 'app', 'core', 'common', 'constants.ts');

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

if (!existsSync(DS)) {
  console.log('SKIPPED — ../savant-ds checkout not found');
  process.exit(0);
}

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '')
   .split('\n').map((l) => l.replace(/\/\/.*/, '')).join('\n');

// ── 1. Route wiring ───────────────────────────────────────────────────────
const ifaces = strip(readFileSync(INTERFACES, 'utf8'));
check("AppRoutes.DS_GALLERY = 'dev/ds'",
  /DS_GALLERY\s*=\s*'dev\/ds'/.test(ifaces));

const consts = readFileSync(CONSTANTS, 'utf8');
check('PAGE_INFO[DS_GALLERY] entry', /AppRoutes\.DS_GALLERY\]:\s*\{[^}]*title/.test(consts));
check("nav child href 'dev/ds'", /href:\s*'dev\/ds'/.test(consts));

const routes = readFileSync(ROUTES, 'utf8');
const routeBlock = /AppRoutes\.DS_GALLERY[\s\S]*?authGuard[\s\S]*?\}/.exec(routes)?.[0] ?? '';
check('route block exists with authGuard', routeBlock.length > 0);
check('route lazily loads DsGalleryComponent',
  /DsGalleryComponent/.test(routes));

// ── 2. Component files ────────────────────────────────────────────────────
for (const [label, p] of [['ts', TS], ['html', HTML], ['scss', SCSS], ['spec.ts', SPEC]]) {
  check(`ds-gallery.component.${label} exists`, existsSync(p));
}

// ── 3. SCSS consumes the package (no copied bodies) ───────────────────────
const scssSrc = readFileSync(SCSS, 'utf8');
const scss = strip(scssSrc);
check("@use 'index' as ds", /@use\s+['"]index['"]\s+as\s+ds/.test(scss));

// A same-directory `index`/`_index` partial resolves importer-relative
// BEFORE the package includePaths — silently rerouting every ds.* include
// while the mixin-source checks below stay green (the imported names
// wouldn't even exist in the shadow). Same guard class as #1040.
const galleryShadows = readdirSync(FEATURE)
  .filter((e) => /^_?index\.(scss|sass|css)$/.test(e) || e === 'index');
check('no index* shadow in ds-gallery/',
  galleryShadows.length === 0, galleryShadows.join(','));

// Package mixin surface — parsed live from the vendored partials.
const packageMixins = new Set<string>();
for (const f of readdirSync(DS_STYLES).filter((e) => /^_.*\.scss$/.test(e))) {
  for (const m of readFileSync(join(DS_STYLES, f), 'utf8')
      .matchAll(/@mixin\s+([\w-]+)/g)) {
    packageMixins.add(m[1]);
  }
}
check('package mixin surface non-empty', packageMixins.size >= 10,
  `${packageMixins.size} mixins`);

const included = [...scss.matchAll(/@include\s+ds\.([\w-]+)/g)].map((m) => m[1]);
check('gallery includes at least 8 ds.* mixins', included.length >= 8,
  included.join(', '));
for (const name of included) {
  check(`ds.${name} is a real package mixin`, packageMixins.has(name));
}
check('no local @mixin bodies (demos come from the package)',
  !/@mixin\s+/.test(scss));

// ── 4. Component SCSS compiles through the real includePaths ───────────────
let sass: { compile(p: string, opts: { loadPaths: string[] }): { css: string } };
try {
  const req = createRequire(join(DS, 'package.json'));
  sass = req('sass');
  check('sass resolvable from the savant-ds checkout', true);
} catch (err) {
  sass = { compile: () => { throw err; } };
  check('sass resolvable from the savant-ds checkout', false,
    `npm install in ../savant-ds required — ${String(err).slice(0, 120)}`);
}
try {
  const { css } = sass.compile(SCSS, { loadPaths: [DS_STYLES] });
  check('component SCSS compiles through includePaths', true);
  // The demos' emitted output proves the mixin bodies executed.
  check('emitted CSS non-trivial', css.length > 2000, `${css.length} chars`);
  check('no :root leakage from the mixin forwards', !css.includes(':root'));
} catch (err) {
  check('component SCSS compiles through includePaths', false,
    String(err).slice(0, 300));
}

// ── 5. Template contract ──────────────────────────────────────────────────
const html = strip(readFileSync(HTML, 'utf8'));
const ts = strip(readFileSync(TS, 'utf8'));
check('template iterates entries', /@for\s*\(entry of entries/.test(html));
check('entries track entry.kind', /track entry\.kind/.test(html));
check('seen-in provenance footnote present', /class="seen-in"/.test(html)
  && /entry\.seenIn\.join/.test(html));
check('dark toggle flips host data-theme',
  /\[attr\.data-theme\][\s\S]*dark\(\) \? "dark"/.test(ts)
  || /\[attr\.data-theme\][\s\S]*"dark"/.test(ts));
check('dark toggle wired in template', /toggleDark\(\)/.test(html));
check('spec asserts the data-theme flip', /data-theme/.test(
  readFileSync(SPEC, 'utf8')));

console.log(failed === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failed} CHECK(S) FAILED ===`);
process.exit(failed === 0 ? 0 : 1);
