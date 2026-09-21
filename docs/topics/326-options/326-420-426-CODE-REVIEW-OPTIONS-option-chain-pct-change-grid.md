# Code Review: Page wiring + empty states + remove swing-extremes stub

**Topic:** Option Chain Pct Change Grid
**Topic Slug:** option-chain-pct-change-grid
**Issue:** #420 (FE Blueprint)
**Task:** #426
**Topic Parent:** #326
**Domain:** OPTIONS
**Area:** FE
**Status:** Final
**Last Updated:** 2026-09-19

## Reviewed change

- `option-chain-pct-change.component.ts` — mounts `<app-swing-compare/>` at the bottom of `.results-panel`; local `linkedKey` computed → `store.highlightedKey()`
- `swing-compare.component.ts` — empty state (no saved analyses → message + `routerLink` to the swing-analysis page); full section under `@else`
- `target-type-selector.component.ts` — `swing-extremes` option, stub block, `.coming-soon` styles removed; union member kept in the shared contract for saved-config back-compat
- `option-chain-pct-change.store.ts` — `SWING_COMPARE_CLEARED` shared patch; `selectConfig` normalizes legacy `swing-extremes` → `user-dates` and now cancels pending snapshot fetches on symbol change
- Specs: `provideRouter([])` added where the link renders; selector spec updated to 2 buttons; new empty-state + selectConfig-clears + legacy-normalization tests

## Standards

- **Fixed — hardcoded route segments** → `swingAnalysisLink` derived from `AppRoutes.SWING_ANALYSIS.split('/')` (routerLink needs per-segment elements; a single multi-segment string encodes the `/` as `%2F` — caught by the href test).
- **Fixed — orphaned `linkedKey` doc comment** dangling over `onConfigSelect` → deleted.
- **Fixed — `makeProviders(analyses)` refactor** in the swing-compare spec for the empty-state variant.
- Noted: `target-type-selector` (~547 lines) and page component (~582) both sit over the 400-line guideline — pre-existing, flagged for a future audit.

## Spec

All four criteria met:

- SwingCompare on the page — ✓ inside `.results-panel`, below the main-flow chain (renders during loading/error too — intentional: it depends on `savedAnalyses`, not grid state)
- Empty state → pointer to swing-analysis — ✓ (href asserted against `AppRoutes`)
- swing-extremes stub removed — ✓
- Manual/config flow unchanged — ✓ (additive only)

**Fixed (spec defect):** `selectConfig` on a different symbol cleared `savedAnalyses` but left `frameSetId`/`frameSwing`/`runs` dangling — stale runs hidden behind the empty state. Extracted `SWING_COMPARE_CLEARED` shared by `setSymbol` and `selectConfig`, plus the same pending-snapshot-fetch cancellation `setSymbol` already had.

**Fixed (spec defect):** legacy saved configs carrying `targetType:'swing-extremes'` produced a modeless selector (no active button, no sub-mode). `selectConfig` now normalizes to `user-dates` — the saved dates stay visible and editable.

## Thermo-nuclear

- Section placement co-scrolls with results — correct; added top margin/divider so it doesn't hug the spinner/placeholder.
- Route derived from `AppRoutes` — canonical source; a rename can't silently break the link.
- `selectConfig` asymmetries both closed (state clearing + in-flight cancellation) via the shared constant.
- `@a` in `<p>` is valid a11y.

## Test results

- pct-change suite: **339/339 green** (13 suites); `tsc -p tsconfig.app.json` clean.
- New coverage: empty-state message + href + no pickers; `selectConfig` clears swing-compare state on symbol change; legacy `swing-extremes` → `user-dates`.

## Verdict

**PASS** — two real `selectConfig` defects plus the route duplication were found and fixed with tests.

## Post-review layout change (user feedback, same uncommitted diff)

Pickers moved from the results side into the left input panel as a
"Swing Compare" `mat-expansion-panel` (frame + extremes pickers + the
no-analyses empty-state link). `SwingCompareComponent` is now
results-only: date list, run builder, run list — gated on `frameSwing`,
with a "pick a frame set + swing" hint otherwise. `frameSet`/`extremesSet`
hoisted to store computeds shared by the panel and section. Suite re-run:
340/340 green, both tsconfigs clean.
