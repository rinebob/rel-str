/**
 * Verification: savant-ds page/layout mixins (task #1036, SHARED blueprint).
 *
 * The authoritative checks live in the package itself —
 * `C:\aa\projects\savant-ds\scripts\verify.mjs` (npm run verify): the four
 * ds.* mixins (page-host, page-shell, content-column, header-bar) compiled
 * through a `@use 'index' as ds` fixture via loadPaths, asserted against
 * _pd-visual-language.scss source semantics; plus the emission contract
 * (index usage emits no :root/token block) and direct `@use 'page'`
 * resolution.
 *
 * This script is the rel-str-side mirror so `run-all.ts` covers the task:
 * it runs `npm run verify` inside the sibling checkout and relays the
 * result, then runs a verbatim-semantics parity probe — compiling the same
 * four mixins from BOTH `_page.scss` and the source
 * `_pd-visual-language.scss` and diffing emitted declarations after
 * normalizing `var(--ds-*)` back to literal values. Skipped by run-all
 * when ../savant-ds is absent (needsPath).
 *
 * Usage: npx tsx scripts/verify/design-system-page-mixins-1036.ts
 *
 * No credentials, no network. Pass: package verify exits 0 AND parity
 * probe diffs clean. Fail: exit 1.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as sass from 'sass';

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

// ── Parity probe: ds mixins vs _pd-visual-language.scss source ─────────
// AC2 — emitted declarations must match the source verbatim modulo
// tokenization. The normalize map is DERIVED by compiling _tokens.scss —
// `var(--ds-x)` normalizes to whatever :root actually declares, so a
// token-value change surfaces here as a real ds-vs-source diff rather
// than being normalized away by a stale hand-copied table.

const tokenDecls = (block: string): Map<string, string> =>
  new Map(
    [...block.matchAll(/(--ds-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );

let tokenLiterals: Record<string, string> = {};
try {
  const tokensCss = sass.compile(path.join(DS, 'styles', '_tokens.scss')).css;
  const rootBlock = tokensCss.match(/:root\s*\{([^}]*)\}/s)?.[1] ?? '';
  for (const [name, value] of tokenDecls(rootBlock)) {
    tokenLiterals[`var(${name})`] = value;
  }
  console.log(`OK   token map derived from _tokens.scss (${Object.keys(tokenLiterals).length} entries)`);
} catch (err) {
  console.log(`FAIL _tokens.scss compile for normalize map — ${String(err).slice(0, 200)}`);
  process.exit(1);
}

const normalize = (s: string): string => {
  let out = s;
  for (const [k, v] of Object.entries(tokenLiterals)) {
    out = out.split(k).join(v);
  }
  return out;
};

const MIXINS = ['page-host', 'page-shell', 'content-column', 'header-bar'];
const fixture = (ns: 'vl' | 'ds', mod: string): string =>
  `@use '${mod}' as ${ns};\n` +
  MIXINS.map((m) => `.s-${m}{@include ${ns}.${m};}`).join('\n');

const declsOf = (css: string): Record<string, string[]> => {
  const map: Record<string, string[]> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    const ds = m[2]
      .trim()
      .split(';')
      .filter(Boolean)
      .map((d) => d.trim().replace(/\s+/g, ' '));
    map[sel] = (map[sel] ?? []).concat(ds).sort();
  }
  return map;
};

// Mixin-surface check — a mixin added to _page.scss but absent from the
// probe list is a hole; every probed name must exist on both sides.
const mixinNames = (file: string): string[] =>
  [...readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\/\/.*$/gm, '')
    .matchAll(/@mixin\s+([\w-]+)/g)].map((m) => m[1]);

let bad = 0;
const dsMixins = mixinNames(path.join(DS, 'styles', '_page.scss'));
const srcMixins = mixinNames(path.join(PD, '_pd-visual-language.scss'));
for (const m of MIXINS) {
  if (!srcMixins.includes(m)) { console.log(`FAIL source missing mixin ${m}`); bad++; }
  if (!dsMixins.includes(m)) { console.log(`FAIL _page.scss missing mixin ${m}`); bad++; }
}
for (const m of dsMixins) {
  if (!MIXINS.includes(m)) { console.log(`FAIL _page.scss mixin ${m} not covered by probe`); bad++; }
}

console.log('--- parity probe: ds.* vs _pd-visual-language.scss ---');
let srcDecls: Record<string, string[]> = {};
let dsDecls: Record<string, string[]> = {};
try {
  srcDecls = declsOf(
    sass.compileString(fixture('vl', 'pd-visual-language'), { loadPaths: [PD] }).css,
  );
  dsDecls = declsOf(
    sass.compileString(fixture('ds', 'index'), {
      loadPaths: [path.join(DS, 'styles')],
    }).css,
  );
} catch (err) {
  console.log(`FAIL fixture compile — ${String(err).slice(0, 200)}`);
  process.exit(1);
}

for (const [sel, props] of Object.entries(dsDecls)) {
  const src = srcDecls[sel];
  if (!src) {
    console.log(`FAIL no source selector: ${sel}`);
    bad++;
    continue;
  }
  const dsNorm = props.map(normalize).sort();
  const missing = src.filter((d) => !dsNorm.includes(d));
  const extra = dsNorm.filter((d) => !src.includes(d));
  if (missing.length || extra.length) {
    bad++;
    console.log(`FAIL ${sel}`);
    for (const d of missing) console.log(`  source-only: ${d}`);
    for (const d of extra) console.log(`  ds-only:     ${d}`);
  } else {
    console.log(`OK   ${sel} (${src.length} decls verbatim)`);
  }
}
for (const sel of Object.keys(srcDecls)) {
  if (!dsDecls[sel]) {
    console.log(`FAIL uncovered source selector: ${sel}`);
    bad++;
  }
}

if (bad === 0) {
  console.log('\n=== ALL CHECKS PASSED ===');
} else {
  console.log(`\n=== ${bad} PARITY DIFF(S) ===`);
  process.exit(1);
}
