**Topic:** Swing Analysis Page  
**Topic Slug:** swing-analysis-page  
**Issue:** #506  
**Task:** #509  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Code Review — Task #509: Tracked-only symbol picker + dialog input removal

## Summary

Three axes over `symbol-nav.component.ts` (permanent mat-autocomplete
picker), `swing-settings-dialog.component.ts` (free-text input removal),
and the page-spec picker suite. No critical/major findings; all
consensus fixes applied before the verdict.

## Standards

No hard violations. `panelClass` + `::ng-deep` overlay styling matches
repo precedent (~30 sites incl. trading-config-dialog). Fixes applied:

- Duplicate tracked-guard in `onPick`/`commitPicker` → shared
  `commitTracked()`.
- Dead `.control input[type="text"]` selector removed from the dialog
  (no text inputs remain).
- Nameless symbols rendered a dangling `TICKER —` — name span now
  conditional.

## Spec

All US-1/US-3 criteria verified: permanent picker between prev/next
showing the current symbol, focus-open, tracked-only options rendered
`TICKER — Name`, substring match on ticker AND `profile.name`,
option-select + exact-ticker Enter commits, untracked input reverts on
Enter/blur/Escape, disabled while the universe is empty, dialog input
removed, prev/next and watchlist filtering untouched.

Documented deviation: Enter on a unique substring match (e.g. 'tesla' →
TSLA) commits — beyond the PRD's "exact ticker" wording; kept as a UX
nicety, now noted in the handler's doc comment.

Test gaps closed: Escape revert test added; Enter-with-highlighted-
option test added.

## Thermo-nuclear

- **Minor (fixed):** Enter vs highlighted-option double-handling —
  `keydown.enter` fires alongside mat-autocomplete's own Enter→
  `optionSelected`. `onPickerEnter` now yields when the panel has an
  active item, so a deliberate arrow-key highlight beats raw query text.
- **Minor (fixed):** focus-open rendered all ~900 mat-options —
  `visibleOptions` caps rendering at 100; filtering narrows further.
- **Nit (verified sound):** imperative `input.value` write in
  `revertPicker` — `[value]` cannot push an unchanged bound value;
  documented in code. External `setSymbol` mid-query resolves correctly
  on blur.
- **Nit (accepted):** `::ng-deep` for the overlay panel — deprecated
  but consistent with repo norms; alternative is a global stylesheet.

## Test results

`npx jest --testPathPatterns="swing-analysis"` — 8 suites, 290 tests,
all green.

## Verdict

**PASS.**
