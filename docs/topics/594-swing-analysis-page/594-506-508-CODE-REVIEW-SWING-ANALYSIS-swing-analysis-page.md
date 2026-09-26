**Topic:** Swing Analysis Page  
**Topic Slug:** swing-analysis-page  
**Issue:** #506  
**Task:** #508  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Code Review — Task #508: Company info strip in page header

## Summary

Three axes ran in parallel over `company-info.component.ts` + spec,
the page-header mount, and the `loadProfiles()` page-init call. One
major finding (formatter placement) was fixed before the verdict; all
US-2 acceptance criteria verified met.

## Standards

No hard violations. Notes:

- Duplicate `loadProfiles()` call sites (page ctor + nav ctor) —
  acceptable; store dedupes via `profilesLoaded`/`inFlight`.
- Mock `profilesBySymbol` in the page spec duplicates the real key
  normalization — accepted page-spec trade-off.
- `input<StSymbolProfile | undefined>` → equivalent to the plain
  `input<StSymbolProfile>` (undefined is the default) — left as
  explicit intent.

## Spec

All US-2 criteria met: all 11 fields inline, reactive on every
`setSymbol` path via the `profilesBySymbol().get(symbol())` binding,
missing/absent profile → `—` + ticker, one session fetch
(`profilesLoaded` + in-flight dedupe), fire-and-forget so the chart
never blocks. Two test gaps found and closed:

- Page-level spec now asserts the strip updates on `setSymbol` and
  renders ticker + dashes for a profile-less tracked symbol.
- Feature spec covers the load-once guard + retry-after-failure
  (#507 diff).

## Thermo-nuclear

- **Major (fixed):** `fmtCap`/`fmtNum`/`fmtMoney`/`fmtPct` moved from
  the component to `utils/utils.ts` beside `tierLabel` — they are
  domain formatters for `StSymbolProfile`, reusable by future surfaces.
  `fmtNum` hardened: `parseFloat(v.toFixed(digits))` replaces the
  trailing-zero regex (which corrupted `fmtNum(100, 0)` → `'1'`).
- **Minor (fixed):** 52w with both bounds absent rendered `— – —`;
  now a single `—`. Single-bound case renders the bound + `—`.
- **Nit (fixed):** `title` attributes on each field (screen-reader +
  tooltip support for cryptic labels like `β`, `P/E`, `52w`).
- **Nit:** `fmtPct` fraction contract (0.0301 → 3.0%) documented on the
  util.

## Test results

`npx jest --testPathPatterns="swing-analysis"` — 8 suites, 288 tests,
all green.

## Verdict

**PASS.**
