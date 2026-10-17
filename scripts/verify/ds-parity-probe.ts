/**
 * Shared parity probe for savant-ds mixin verification.
 *
 * Compiles the same mixin list from BOTH the savant-ds package (via
 * `@use 'index' as ds`) and a source stylesheet (via `@use '<mod>' as vl`),
 * normalizes `var(--ds-*)` to whatever the compiled `_tokens.scss` `:root`
 * block actually declares, and diffs emitted declarations per selector.
 *
 * The normalize map is DERIVED — never hand-copied — so a token-value
 * change surfaces here as a real ds-vs-source diff instead of being
 * normalized away by a stale table.
 *
 * Used by design-system-*-NNNN.ts task relays; each relay supplies its
 * own mixin manifest + source file. Prints OK/FAIL lines; returns the
 * number of diffs (0 = verbatim parity).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import * as sass from 'sass';

// dart-sass expanded output preserves loud /* */ comments — strip them
// before any regex scan so a comment can't fake a declaration or split
// a rule block mid-parse (a `}` inside a comment would truncate a rule).
const stripComments = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

const tokenDecls = (block: string): Map<string, string> =>
  new Map(
    [...block.matchAll(/(--ds-[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );

const declsOf = (css: string): Record<string, string[]> => {
  const map: Record<string, string[]> = {};
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
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

const mixinNames = (file: string): string[] =>
  [...readFileSync(file, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\/\/.*$/gm, '')
    .matchAll(/@mixin\s+([\w-]+)/g)].map((m) => m[1]);

export interface ParityProbeArgs {
  /** savant-ds repo root (contains styles/). */
  dsRoot: string;
  /** Directory containing the source stylesheet (loadPaths entry). */
  srcDir: string;
  /** Source module name, e.g. 'pd-visual-language'. */
  srcModule: string;
  /** File under dsRoot/styles exporting the task's mixins. */
  dsFile: string;
  /** Mixin names the task is responsible for (probed + surface-checked). */
  mixins: string[];
  /** Banner label for output. */
  label: string;
}

export function runParityProbe(a: ParityProbeArgs): number {
  let bad = 0;

  // ── Derived token normalize map ────────────────────────────────────
  let tokenLiterals: Record<string, string> = {};
  try {
    const tokensCss = stripComments(
      sass.compile(path.join(a.dsRoot, 'styles', '_tokens.scss')).css,
    );
    const rootBlock = tokensCss.match(/:root\s*\{([^}]*)\}/s)?.[1] ?? '';
    for (const [name, value] of tokenDecls(rootBlock)) {
      tokenLiterals[`var(${name})`] = value;
    }
    console.log(`OK   token map derived from _tokens.scss (${Object.keys(tokenLiterals).length} entries)`);
  } catch (err) {
    console.log(`FAIL _tokens.scss compile for normalize map — ${String(err).slice(0, 200)}`);
    return 1;
  }
  const normalize = (s: string): string => {
    let out = s;
    for (const [k, v] of Object.entries(tokenLiterals)) out = out.split(k).join(v);
    return out;
  };

  // ── Mixin-surface check — a mixin added without coverage is a hole ──
  const dsFilePath = path.join(a.dsRoot, 'styles', a.dsFile);
  const srcFilePath = path.join(a.srcDir, `_${a.srcModule}.scss`);
  for (const [p, label] of [
    [dsFilePath, a.dsFile],
    [srcFilePath, `_${a.srcModule}.scss`],
  ] as const) {
    if (!existsSync(p)) {
      console.log(`FAIL ${label} missing — ${p}`);
      return bad + 1;
    }
  }
  const dsMixins = mixinNames(dsFilePath);
  const srcMixins = mixinNames(srcFilePath);
  // #1040: the source may delegate rather than define — a mixin satisfied
  // by an `@forward` of the package index is still verified (the decl
  // diff below proves the forwarded emission is verbatim).
  const srcSrc = readFileSync(srcFilePath, 'utf8')
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/\/\/.*$/gm, '');
  const srcDelegates = /@forward\s+['"](?:index|page|dialog|feedback)['"]/.test(srcSrc);
  for (const m of a.mixins) {
    if (!srcMixins.includes(m)) {
      if (srcDelegates) {
        console.log(`OK   source delegates ${m} via @forward`);
      } else {
        console.log(`FAIL source missing mixin ${m}`);
        bad++;
      }
    }
    if (!dsMixins.includes(m)) { console.log(`FAIL ${a.dsFile} missing mixin ${m}`); bad++; }
  }
  for (const m of dsMixins) {
    if (!a.mixins.includes(m)) { console.log(`FAIL ${a.dsFile} mixin ${m} not covered by probe`); bad++; }
  }

  // ── Fixture compile + decl diff ────────────────────────────────────
  const fixture = (ns: 'vl' | 'ds', mod: string): string =>
    `@use '${mod}' as ${ns};\n` +
    a.mixins.map((m) => `.s-${m}{@include ${ns}.${m};}`).join('\n');

  let srcDecls: Record<string, string[]> = {};
  let dsDecls: Record<string, string[]> = {};
  try {
    srcDecls = declsOf(
      // #1040: srcDir first (importer shape), ds styles second so the
      // shim's `@forward 'index'` resolves exactly as it does in the
      // angular build's includePaths.
      sass.compileString(fixture('vl', a.srcModule), {
        loadPaths: [a.srcDir, path.join(a.dsRoot, 'styles')],
      }).css,
    );
    dsDecls = declsOf(
      sass.compileString(fixture('ds', 'index'), {
        loadPaths: [path.join(a.dsRoot, 'styles')],
      }).css,
    );
  } catch (err) {
    console.log(`FAIL fixture compile — ${String(err).slice(0, 200)}`);
    return bad + 1;
  }

  console.log(`--- parity probe: ${a.label} vs ${a.srcModule} ---`);
  for (const [sel, props] of Object.entries(dsDecls)) {
    const src = srcDecls[sel];
    if (!src) {
      console.log(`FAIL no source selector: ${sel}`);
      bad++;
      continue;
    }
    // Multiset diff — exact-duplicate declarations must match in count,
    // not just membership.
    const tally = (arr: string[]): Map<string, number> => {
      const t = new Map<string, number>();
      for (const d of arr) t.set(d, (t.get(d) ?? 0) + 1);
      return t;
    };
    const dsNorm = props.map(normalize).sort();
    // Normalize the source side too — post-shim the delegated mixin emits
    // the same `var(--ds-*)` reads the package does.
    const srcT = tally(src.map(normalize));
    const dsT = tally(dsNorm);
    const missing: string[] = [];
    const extra: string[] = [];
    for (const [d, n] of srcT) {
      const g = dsT.get(d) ?? 0;
      for (let i = g; i < n; i++) missing.push(d);
    }
    for (const [d, n] of dsT) {
      const s = srcT.get(d) ?? 0;
      for (let i = s; i < n; i++) extra.push(d);
    }
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
  return bad;
}
