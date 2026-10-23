/**
 * #1042 — SA smoke test: av-proxy-api consumes savant-ds.
 *
 * Cross-repo relay — reads the sibling ../av-proxy-api checkout and checks:
 *   1. package.json declares a file: dep on savant-ds (vendored per #1071).
 *   2. angular.json includePaths carries node_modules/savant-ds/styles.
 *   3. styles.scss emits the token layer (@use 'tokens') and bridges
 *      --mat-sys-* (SA's prebuilt theme emits no usable values — the
 *      vendored DS mixins still read them; post-#1204 the tokens do not).
 *   4. vendor/savant-ds/styles exists and matches ../savant-ds contents
 *      (line-ending normalized — IDE CRLF re-saves are not drift).
 *   5. At least one real element consumes the package via @use 'index' as ds.
 *   6. sass resolves SA's component scss through SA's real includePaths.
 *
 * Run from repo root:
 *   npx tsx scripts/verify/design-system-sa-consumption-1042.ts
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const SA = path.resolve('..', 'av-proxy-api');
const DS = path.resolve('..', 'savant-ds');

let checks = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  checks++;
  if (ok) console.log(`OK   ${name}`);
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── 1. dep declared ─────────────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(path.join(SA, 'package.json'), 'utf8'));
const depSpec: string = pkg.dependencies?.['savant-ds'] ?? '';
check('package.json declares savant-ds file: dep', depSpec.startsWith('file:'), depSpec);

// ── 2. includePaths ─────────────────────────────────────────────────────────
const ngJson = readFileSync(path.join(SA, 'angular.json'), 'utf8');
check('angular.json includePaths carries savant-ds styles',
  ngJson.includes('node_modules/savant-ds/styles'));

// ── 3. global token emit + mat-sys bridge ────────────────────────────────────
const globalScss = readFileSync(path.join(SA, 'src', 'styles.scss'), 'utf8');
check('styles.scss emits the token layer', /@use\s+['"]tokens['"]/.test(globalScss));
check('styles.scss bridges --mat-sys-* (prebuilt theme emits none)',
  /--mat-sys-on-surface\b/.test(globalScss) && /--mat-sys-error\b/.test(globalScss));

// ── 4. vendored copy present + in sync ──────────────────────────────────────
const vendorStyles = path.join(SA, 'vendor', 'savant-ds', 'styles');
check('vendor/savant-ds/styles exists', existsSync(vendorStyles));
if (existsSync(vendorStyles) && existsSync(path.join(DS, 'styles'))) {
  const srcNames = readdirSync(path.join(DS, 'styles')).filter((f) => f.endsWith('.scss')).sort();
  const dstNames = readdirSync(vendorStyles).filter((f) => f.endsWith('.scss')).sort();
  check('vendor filenames match package', srcNames.join(',') === dstNames.join(','),
    `pkg:${srcNames} vendor:${dstNames}`);
  const normalize = (p: string) => readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
  const drifted = srcNames.filter(
    (f) => normalize(path.join(DS, 'styles', f)) !== normalize(path.join(vendorStyles, f)),
  );
  check('vendor content-identical to ../savant-ds (npm run sync:ds to fix)',
    drifted.length === 0, drifted.join(', '));
}

// ── 4b. no package-name shadow — src/styles precedes the package in
// includePaths, and importer-relative resolution precedes both; a stray
// partial named like a package partial (_index, _tokens, _page, …) in
// src/, src/styles/, or beside a consumer silently reroutes the @use
// (#1040 lesson — applies to 'index' AND the global 'tokens' import).
const partialNames = existsSync(path.join(DS, 'styles'))
  ? readdirSync(path.join(DS, 'styles'))
      .filter((f) => f.startsWith('_') && f.endsWith('.scss'))
      .map((f) => f.slice(1, -'.scss'.length))
  : [];
const shadowDirs = [
  path.join(SA, 'src'),
  path.join(SA, 'src', 'styles'),
];
const globalShadows = shadowDirs.flatMap((d) =>
  existsSync(d)
    ? readdirSync(d)
        .filter((f) => partialNames.includes(f.replace(/^_/, '').replace(/\.s[ac]ss$/, '')))
        .map((f) => `${path.relative(SA, d)}/${f}`)
    : [],
);
check('no package-name shadow in src/ or src/styles/', globalShadows.length === 0,
  globalShadows.join(', '));

// ── 5. a real element consumes @use 'index' as ds ────────────────────────────
function* scssFiles(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* scssFiles(p);
    else if (e.name.endsWith('.scss')) yield p;
  }
}
const consumers = [...scssFiles(path.join(SA, 'src'))].filter((f) =>
  /@use\s+['"]index['"]\s+as\s+ds/.test(readFileSync(f, 'utf8')),
);
check('at least one element consumes @use index as ds', consumers.length > 0,
  consumers.map((f) => path.relative(SA, f)).join(', '));
const localShadows = consumers.flatMap((f) =>
  readdirSync(path.dirname(f))
    .filter((n) => partialNames.includes(n.replace(/^_/, '').replace(/\.s[ac]ss$/, '')))
    .map((n) => path.relative(SA, path.join(path.dirname(f), n))),
);
check('no package-name shadow beside consuming components', localShadows.length === 0,
  localShadows.join(', '));

// ── 6. component scss compiles through SA's real includePaths ────────────────
const saRequire = createRequire(path.join(SA, 'package.json'));
let sassApi: typeof import('sass') | null = null;
try { sassApi = saRequire('sass'); } catch { /* resolved below via rel-str */ }
if (!sassApi) {
  try { sassApi = createRequire(path.resolve('package.json'))('sass'); } catch { /* none */ }
}
check('sass resolvable', !!sassApi);
if (sassApi && consumers.length > 0) {
  const compiled = sassApi.compile(consumers[0], {
    loadPaths: [path.join(SA, 'src', 'styles'), path.join(SA, 'node_modules', 'savant-ds', 'styles')],
  });
  check('component scss compiles through real includePaths', compiled.css.length > 100,
    `${compiled.css.length}b`);
  check('emitted CSS carries ds mixin output',
    compiled.css.includes('var(--ds-') || compiled.css.includes('var(--mat-sys-'));
}

console.log(`\n${failed === 0 ? '=== ALL CHECKS PASSED ===' : `=== ${failed}/${checks} CHECKS FAILED ===`}`);
process.exit(failed === 0 ? 0 : 1);
