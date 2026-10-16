**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1029  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# Test Plan: savant-ds package (SHARED)

The package is declarative SCSS — the meaningful seam is **compilation +
token surface**, not runtime behavior.

## E2E User Journeys
- n/a (no user-facing surface; the gallery is FE-scope)

## Integration Tests
- `scripts/verify.mjs` — sass-compiles a fixture entry that `@use`s
  `styles/_index.scss` and exercises every public mixin; asserts the
  compiled CSS contains each expected `--ds-*` token and exits clean.
  Run inside savant-ds: `npm run verify` (script → `node scripts/verify.mjs`).

## Unit Tests
- Token surface: every documented token name (`--ds-up`, `--ds-down`,
  `--ds-surface`, `--ds-on-surface`, `--ds-space-*`, `--ds-row-height`,
  `--ds-field-height`, `--ds-error`, `--ds-border-subtle`, font-size/weight,
  shadow, radius) appears in compiled output — both `:root` and
  `[data-theme="dark"]` where overridden.
- Mixin surface: fixture referencing each `ds.*` mixin compiles without
  "undefined mixin" errors.
- No `@import` anywhere in `styles/` (grep check) — guards the dual-sass-
  version consumption contract.

## Test Seams
- Highest seam: the `verify.mjs` compile check (real `sass`, real package
  layout — what consumers actually resolve).
- Lower seam: none — there is no pure-logic layer in this package.

## Existing Test Coverage
- None — new package.
- Mirrored into rel-str as a `scripts/verify/design-system-*` entry during
  the FE blueprint so `run-all` picks it up.

## Edge Cases
- Token emitted under `data-theme="dark"` only when overridden (no
  duplication of unchanged values).
- `--mat-sys-*` alias tokens resolve — verified implicitly at app build
  (compile-time check can't evaluate var() chains; the FE gallery render
  is the visual proof).
- Consuming from a nested includePaths entry — the fixture mimics the
  consumer's `@use 'index' as ds` form, not a relative path.
