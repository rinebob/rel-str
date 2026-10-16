**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1030  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1034  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# Code Review — #1034: savant-ds repo + package skeleton

## Verdict: PASS (after in-review remediation)

No critical or major findings at gate time. One doc-drift major was
remediated in-flight (README described the token/mixin surface as
shipped) along with a cluster of minors; all remaining findings are
nit/accepted.

## Axis summaries

### Standards

Contract baseline verified: `file:../../../../savant-ds` from
`.devin/tmp/ds-consumer-1034` resolves correctly (npm resolves `file:`
relative to the consumer's package.json); `lstatSync().isSymbolicLink()`
detects npm's Windows junctions; `@use 'index' as ds` of a comments-only
partial is legal. Scratch dir under `.devin/tmp/` complies with the
temp-file rule.

- **major (remediated):** savant-ds `README.md` documented
  `_tokens.scss`, `ds.*` mixins, and a full sass-compile verify that do
  not exist — a consumer following it today fails at Sass. Added
  "skeleton only (#1034); lands in #1035–#1038" markers to the layer
  descriptions and the Verify section.
- **nit (fixed):** `design-system-package-1034.ts` — `lstatSync` computed
  twice, unguarded `JSON.parse`, banner diverged from sibling
  `=== ALL CHECKS PASSED ===` convention.
- **judgment (accepted):** `files` field + `sass` devDep are inert for
  `file:`-linked consumption — harmless scaffolding.

### Spec

All three acceptance criteria met: sibling git repo with
package.json/.gitignore/README; `styles/` + `scripts/` exist; README
documents `file:../savant-ds` + `includePaths` for both apps (junction
warning included). Two harmless pull-forwards noted (sass devDep
installed before #1038 uses it; `files` field inert). Zero commits —
per the commit-approval rule, not a spec gap.

### Thermo-nuclear

Right-sized, not over-built: the dry-run vs. real-install checks exercise
two genuinely different path resolutions; the junction probe is the only
real proof of the named Windows risk. At ~112 lines it's smaller than
sibling verify scripts.

- **minor (fixed):** `run-all.ts` entry had no precondition — a checkout
  without `../savant-ds` would FAIL instead of SKIP. Added `needsPath`
  field to `VerifyScript` + SKIP branch; ds entry gated on
  `../savant-ds`.
- **minor (fixed):** verify script anchored to `process.cwd()` — now
  anchored via `import.meta.url`.
- **minor (fixed):** README/IMPL drift (see Standards major).
- **nit (fixed):** IMPL layout said "no deps" but package ships a sass
  devDep; PRD mermaid said `patterns/*.scss` vs actual `styles/_*.scss`;
  `verify.mjs` check name now honest and strips `//` comments before the
  `@import` scan.
- **nit (accepted):** `files: ["scripts"]` ships verify tooling to
  consumers — harmless for `file:` deps.

## Test results

- `scripts/verify/design-system-package-1034.ts`: **14/14 checks pass**
  (real `file:` install + junction probe).
- savant-ds `npm run verify`: stub passes (entry point + @use-only
  contract).
- Full jest suite: **3735 pass / 43 fail, 2 suites** — identical to the
  documented pre-existing baseline (same unrelated suites red at HEAD:
  screenshot-capture-contracts, order.component). Zero app code touched.
- `tsc --noEmit` on the two edited verify files: clean.

## Files under review

- `savant-ds/`: package.json, package-lock.json, .gitignore, README.md,
  styles/_index.scss, scripts/verify.mjs (new repo, uncommitted)
- `rel-str/`: scripts/verify/design-system-package-1034.{ts,md},
  scripts/verify/{README.md,run-all.ts}, CONTEXT.md,
  docs/topics/1024-design-system/ (PRD + IMPL×2 + TEST×2)
