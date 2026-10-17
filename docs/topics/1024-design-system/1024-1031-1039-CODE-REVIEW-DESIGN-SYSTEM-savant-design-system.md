**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1031  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1039  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

# Code Review — #1039 ST consumption wiring (file: dep + includePaths + token emit)

**Verdict: PASS** (after in-flight remediation — see below)

## Scope

- `package.json` + `package-lock.json` — `"savant-ds": "file:../savant-ds"`
  declared (alphabetical); lockfile carries the standard
  `{resolved: "../savant-ds", link: true}` pair
- `angular.json` — `stylePreprocessorOptions.includePaths:
  ["node_modules/savant-ds/styles"]` on both SCSS-compiling targets
  (`build`, `test`); serve/extract-i18n inherit via `buildTarget`
- `src/styles.scss` — `@use 'tokens'` in the top `@use` block; comment
  documents why it's not literally "after the Material theme" (Sass
  requires `@use` first; `var()` aliases bind at computed time)
- `scripts/verify/design-system-consumption-1039.{ts,md}` — relay +
  guide
- `run-all.ts` + `scripts/verify/README.md` — registration + index row
- `savant-ds/styles/_tokens.scss` — header comment corrected (below)

## Spec

All four ACs verified:

- **AC1** — junction at `node_modules/savant-ds`, realpath →
  `C:\aa\projects\savant-ds`; lockfile `link: true` shape is standard npm
- **AC2** — `npm run build` green (20.6s); emitted
  `styles-*.css` carries 27 `--ds-*` declarations + dark block
- **AC3** — bundle-level emission verified; live `:root` inspection
  deferred to UAT (no mechanism exists that could drop a `:root` rule
  between bundle and `documentElement`)
- **AC4** — relay registered in run-all (`needsPath: '../savant-ds'`,
  same spawn shape as siblings); standalone run = 37 checks / 0 failures

Interpretive note: the IMPL doc asked for the token emit "after the
Material theme" — impossible with `@use` (Sass requires it first);
the emitted CSS is functionally identical because custom-property
`var()` resolves at computed time. Spec axis confirmed sound.

## Standards

No majors. Relay matches sibling conventions (existsSync guards,
FAIL-not-crash, SKIPPED-when-sibling-absent); the `createRequire`-against-
savant-ds sass resolution is deliberate (the package's pinned compiler,
not rel-str's transitive Angular copy).

## Findings — remediated

Convergent across the standards + adversarial axes:

- **A1 (adversarial major) — relay couldn't see a `src/` shadow.**
  `@use 'tokens'` resolves importer-relative before loadPaths: a future
  `src/_tokens.scss` would silently reroute the layer while the relay's
  synthetic compile stayed green. → New check: no `src/`-root file/dir
  matching the package's partial names (`tokens`, `index`, `page`,
  `dialog`, `feedback`, `.scss`/`.sass`, underscore or not).
  Negative-tested: planted `src/_tokens.scss` fails.
- **A2 (both axes) — token assertions were substring/scope-blind.**
  `includes('--ds-surface')` matches inside `--ds-surface-variant`; a
  dark-block remnant could mask a missing `:root` decl. → Emitted
  checks now parse `:root { … }` blocks into a decl-name set
  (boundary-exact, scoped). The package's own verify remains the deeper
  layer (selector-scoped maps, literal values, set-equality).
- **A3 — unguarded `readFileSync`/`JSON.parse`** on `_tokens.scss`,
  `package.json`, `angular.json` — crashes instead of FAILs, vs the
  siblings' discipline. → existsSync gate + try/catch with FAIL lines.
- **A4 — `_tokens.scss` header overstated the contract** ("MUST emit a
  Material theme *before* this file") — source order is irrelevant for
  `var()`; the real requirement is `--mat-sys-*` emitted *somewhere* on
  `:root`. Corrected in `savant-ds`.

## Minors remediated

- Compile check's failure detail was hardcoded `'compiled'` — now
  conditional (`no :root block`)
- SKIPPED wording aligned to sibling text
- Token list deduped via `Set` (dark-block redeclarations)

## Accepted / documented (not fixed)

- Regex-on-source token extraction could false-FAIL if `_tokens.scss`
  ever declared tokens inside a never-called `@mixin` — impossible today
  (package verify asserts `_tokens.scss` is member-free, #1038); fails
  loud regardless
- Relay depends on `npm install` having run in `../savant-ds` (sass
  devDep) — documented prereq
- `npm ci` without the sibling checkout fails — inherent `file:` trade;
  SKIPPED contract covers run-all
- Pre-existing `_variables-global.scss` emits `:root` per-component when
  consumed via `@use` (~25 component files) — unrelated leak, noted
- Syncfusion `@import` sits after emitted rules — pre-existing; CSS
  spec order is violated in source but the emitted bundle verified to
  contain the Syncfusion styles (Angular inlines the pass-through)

## Verification evidence

- Relay: **37 checks / 0 failures**
- Negative test: planted `src/_tokens.scss` → FAIL (shadow guard)
- `npm run build`: green; `dist` styles bundle carries all 27 `--ds-*`
  decls + `[data-theme="dark"]`
- savant-ds `npm run verify`: still green post-header-edit (340 checks)
- jest: not run — styles.scss isn't compiled by jest (component specs
  strip styleUrls); no runtime TS changed
