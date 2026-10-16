**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** design-system-foundation  
**Issue:** #1030  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Task:** #1036  
**Domain:** SHARED  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# Code Review — #1036 Page/layout mixins `_page.scss`

**Verdict: PASS** (after in-flight remediation — see below)

## Scope

- `savant-ds/styles/_page.scss` — new: `page-host`, `page-shell`,
  `content-column`, `header-bar` graduated from `_pd-visual-language.scss`,
  tokenized to `--ds-*`
- `savant-ds/styles/_index.scss` — `@forward 'page'` (first mixin export;
  emission contract holds)
- `savant-ds/scripts/verify.mjs` — mixin fixture through
  `@use 'index' as ds` + declaration-anchored assertions
- `savant-ds/README.md` — mixin layer documented as shipped
- `rel-str/scripts/verify/design-system-page-mixins-1036.{ts,md}` — relay +
  verbatim-semantics parity probe; `run-all.ts`/README registration

## Standards

Clean core — no criticals/majors. Verified verbatim parity
declaration-by-declaration; correct tokenization choices; `--mat-sys-surface-
container-high` correctly left literal (no ds token, documented); `///` doc
comments preserved; no `any`/casts; `needsPath` gate consistent.

Minors remediated:
- Package-verify assertions were substring-presence, missing two documented
  semantics (bar `background: var(--mat-sys-surface-container-high)`, button
  `font-size`) — subsumed by the declaration-anchored rewrite below.
- Unguarded `sass.compileString` calls in the relay — now try/catch with the
  file's FAIL/exit-1 convention.
- verify.mjs header wording updated to reflect #1035+#1036 coverage.

Noted, not this task: `run-all.ts` at 327 lines (pre-existing growth;
scripts-manifest extraction is the candidate if more entries land);
third copy of the token map (addressed — see Thermo-Nuclear major 3).

## Spec

All three acceptance criteria verified:

1. All four mixins exist and compile — **met**; fixture compiles all four
   through `@use 'index' as ds` via `loadPaths`.
2. Output matches `_pd-visual-language.scss` verbatim — **met**; the relay
   parity probe diffs every emitted declaration per selector after
   normalizing `var(--ds-*)` to compiled token values: 30 decls, 0 diffs.
3. `@use 'index' as ds` or direct partial exposes them — **met**;
   `@forward 'page'` + direct `@use 'page'` both verified.

No drift, no beyond-spec surface. `--mat-sys-surface-container-high`
flagged as a future manifest candidate.

## Thermo-Nuclear

Three majors found, all remediated:

1. **Emission check only detected one leak shape** (`:root{--ds-}`) —
   stray class rules, `[data-theme="dark"]` blocks, or top-level at-rules
   would pass. Now asserts every emitted selector is `.probe-*`-rooted and
   no `@media/@supports/@keyframes/@font-face/@layer` exists.
2. **Substring assertions not declaration-anchored** — `'height: 100%'`
   was satisfied by `min-height: 100%`; `'flex: 1'` by `flex: 1.5`.
   Rewritten as a `declsOf` parser + exact `prop: value` assertions for the
   complete 30-declaration verbatim list (both nested rules included).
3. **`TOKEN_LITERALS` second source of truth could mask drift** — a token
   value change updated in `LITERAL_VALUES` but not the hand-copied relay
   table would normalize back to the stale literal and pass. Now the
   normalize map is derived by compiling `_tokens.scss` and reading the
   emitted `:root` decls — token-value changes surface as real diffs.

Minors remediated: alias assertions scoped to the `:root` declaration map
(not loose in the stylesheet); `@use 'page'` check asserts a real
declaration; `_page.scss` mixin-surface set-equality vs a manifest in both
verifiers (a 5th mixin without coverage fails); relay `declsOf` accumulates
duplicate selectors instead of last-write-wins; source-side coverage check
dropped its `.s-` filter blind spot.

Documented, accepted: `declsOf` can't parse nested `@media` blocks
(relevant to #1038 if graduated mixins gain them — symmetric mangling still
diffs loudly); `needsPath` is run-all-cwd-relative (pre-existing, fail-safe
direction); relay `sass` import resolves via hoisted transitive dep (loud
fail if it vanishes); `loadPaths` shadowing risk when `includePaths` is
added in #1039 — worth a consumer-side smoke check then.

## Tests

- `npm run verify` (savant-ds): **128 checks, all pass** — tokens (set
  equality + values + dark subset + per-alias), mixin manifest set-equality,
  declaration-anchored fixture assertions, emission contract, both
  resolution paths.
- `npx tsx scripts/verify/design-system-page-mixins-1036.ts`: pass —
  package relay + derived-map parity probe (6 selectors verbatim).
- Full jest: 3,764 pass / 43 fail — identical baseline (same two unrelated
  suites); zero app code touched.

## Re-review (round 2)

Re-audit of the remediated surface found one minor and two doc-drifts:

- **Minor** — the relay guarded `../savant-ds` with `existsSync` but not the
  `_pd-visual-language.scss` source; a missing source crashed instead of
  FAILing. Added the guard.
- **Doc-drift** — verify.mjs header item 5 and the 1036 guide still
  described the pre-remediation checks; updated to the declaration-anchored
  assertions, derived normalize map, and mixin-surface check.

Re-verified clean: emission contract selectors are all `.probe-*`-rooted;
declaration lists cover the full 30-decl verbatim surface; derived token
map normalizes to compiled `:root` values; mixin-name sets equal on both
sides; `tsc` clean on changed files (unrelated baseline only).

No further findings. 128 package checks + 6-selector parity probe, green.

## Disposition

All findings addressed. Task is ship-shaped pending QA.
