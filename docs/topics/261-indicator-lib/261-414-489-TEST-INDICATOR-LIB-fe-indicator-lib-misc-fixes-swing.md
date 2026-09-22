**Topic:** Trading Indicator Library
**Topic Slug:** indicator-lib
**Thread:** Misc fixes & polish — swing analysis
**Thread Slug:** misc-fixes-swing
**Issue:** #489
**Thread Parent:** #414
**Topic Parent:** #261
**Domain:** INDICATOR-LIB
**Type:** Test Plan
**Status:** Draft
**Created:** 2026-09-22
**Last Updated:** 2026-09-22

# Test Plan — FE: Symbol picker + company info header

## E2E journeys

- J1: Open swing-analysis → type "tesla" in the nav input → pick
  `TSLA — Tesla Inc.` → chart/swings/stats/header all update.
- J2: Type an untracked ticker → Enter → input reverts, symbol
  unchanged, no navigation.
- J3: Prev/next through symbols → header strip shows each company's
  full profile instantly (profiles preloaded once).
- J4: Newly-tracked symbol with no profile → header shows ticker +
  `—` fields, autocomplete shows ticker-only option, no error.

## Integration boundaries

- `loadProfiles()` → `signalService.getAllSymbols()` seam — mock
  profiles in specs; verify single-call guard.
- Nav commit → `setSymbol` — verify the existing recompute path runs
  (bars/pivots/swings/stats recompute once per commit).
- `trackedSymbols` empty → input disabled (universe still loading).

## Unit test targets

- `symbol-profiles.feature.ts`: load once / no-op when warm,
  `profilesBySymbol` indexing, `profilesLoading` flag.
- `CompanyInfoStripComponent`: all-fields render, missing fields → `—`,
  undefined profile → ticker + `—`.
- `SymbolNavComponent` autocomplete: option text `TICKER — Name`,
  filter matches ticker AND name substring, pick commits setSymbol,
  invalid/untracked input reverts, Esc reverts, blur reverts.
- Settings dialog: symbol input gone (assert absent).

## Test seams / edge cases

- setupPage gains a `profiles` mock param (StSymbolProfile[]).
- Company-name drift: profile.name missing → option shows bare ticker.
- Autocomplete value vs store.symbol() staying in sync after nav and
  saved-set loads.
- Existing nav tests (wrap, filter, chips) stay green.
