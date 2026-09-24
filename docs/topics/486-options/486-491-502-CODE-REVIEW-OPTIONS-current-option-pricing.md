# CODE-REVIEW: Current Option Pricing — Contract Hover Popup

**Topic:** #486 Current option pricing
**Issue:** #491 (Blueprint)
**Task:** #502 Contract hover popup
**Topic Parent:** #486
**Domain:** OPTIONS
**Type:** CODE-REVIEW
**Status:** Complete (PASS, 2nd pass; 1st pass FAIL)
**Created:** 2026-09-24
**Last Updated:** 2026-09-24

## Summary

Three review axes run over the working-tree diff. First pass found three
majors (missing overlay scroll strategy, duplicated+drifting hover layer,
dead `cellEnter`/`cellLeave` API) plus minors/nits. All findings were
fixed; second pass verifies each fix and hunts regressions introduced by
the refactor. Full test suite: **131 suites / 1776 tests — all green**.

## Second-pass verification

All first-pass findings verified fixed:

| Finding | Fix |
|---|---|
| M1 overlay scroll strategy | `[cdkConnectedOverlayScrollStrategy]="scrollStrategy"` = `reposition()` (`chain-grid.component.html`, `chain-grid.component.ts`) + top fallback position added |
| M2 duplicated hover layer | New `DelegatedCellHover<TCell>` in `savant-trader/utils/delegated-cell-hover.ts` — owns delegated mouseover/mouseout/click/focusin/focusout, intra-cell suppression, single-icon invariant, `reset()` on rebuild, `revealIcon()` for click/touch. Both grids delegate; pct-change keeps pin/grace-timer/`sameSelectedCell`/`CHART_PANE_CLASS` in config callbacks. Semantics verified equivalent (icon check precedes intra-cell guard; icon-leave ordering preserved) |
| M3 dead API | `cellEnter`/`cellLeave`/`ChainCellHover` deleted; specs replaced with icon-behavior assertions |
| m1 `parseNum('')`→0 | New `parseNumOrNull` (empty/whitespace → null) in `contract-observation.utils.ts`; popup, `chain.utils`, `pct-change.utils#toNum`, and `parseObservations` all converged on it |
| m2 icon survives rebuild | `hover.reset()` in the model effect; specs added in both grids |
| m3 resync timing heuristic | Position-matched suppression (`expectedScrolls` map) — only a scroll event at exactly the resynced position is skipped, and only once; stale entries expire via a tracked timer cleared in `ngOnDestroy` |
| m4 global localStorage | Key is per-symbol (`option-chain.hidden-expirations.{symbol}`); reload-before-persist effect ordering verified load-bearing; empty sets remove the key (no orphan keys while typing) |
| m5 NaN delta bound | `Number.isFinite` guard in `onDeltaBound` |
| m6 silent strike trim | `ChainGridModel.totalStrikes` → stats render "3 of 44 strikes" |
| m7 template-called band methods | New `column-picker.component.ts` child — `bandRows` computed view-model, render-only template, two-way `[(hidden)]` binding |
| m8 file size | chain-grid template/styles extracted to `.html`/`.scss` (TS ~290 lines); picker extracted off the page |
| m9/n6 duplicated formatting | `expirationMeta` (DOW+DTE), `sessionPctChange`, `formatSignedPct` in `option-grid.utils.ts`; consumed by chain-grid, pct-change, page, picker |
| n1-n8 | Docstrings updated; `scrollIntoView` mock restored via try/finally; zoneless provider removed from popup spec; `hoverOrigin` typed `HTMLElement`; scroller cache invalidated on layout effect; prev=0 n/a spec added |

## Second-pass improvements (beyond the original findings)

- **Keyboard/touch access:** `DelegatedCellHover` gained delegated `click`
  (cell click reveals icon; icon click opens popup) and `focusin`/`focusout`
  (the icon is a real `<button>` — Tab reaches it once revealed, focus
  opens/closes the popup). Spec covers the keyboard path.
- **Overlay origin null-safety:** the overlay is now deferred behind
  `@if (hoverOrigin(); as origin)` — same pattern pct-change uses; the
  non-null contract is structural, not asserted.
- **`gridStats` → `callsStats`/`putsStats` computed signals** — template
  is render-only.
- **`fmtCount` `1000k` edge** fixed (`>= 999_500 → "1.0M"`).
- **`<6d` band** no longer matches negative DTE.

## Findings (2nd pass)

### Critical / Major

None. All three axes verified every fix against the working tree; the
pct-change refactor is behavior-preserving (pinning, grace timer,
pane-hover keep-open, click-to-pin all intact per specs).

### Minor / nits carried forward or new

- `parseNum` (non-null version) still exists for `countNaNIV`/
  `countZeroVolume` — correct there (they test for null/0 explicitly).
- `scrollIntoView` scrolls all ancestors, not just `.grid-scroll` —
  harmless while the page is fullscreen; scope to `scroller.scrollTo`
  if the page ever gains outer scroll.
- The 50ms expected-scroll expiry is a documented backstop; a
  programmatic scroll event dispatched after long jank could mirror its
  ATM fraction — extremely unlikely and self-corrects on next scroll.
- Pure keyboard users must click a cell once to arm the icon before it
  becomes a tab stop — full keyboard nav (arrow-key cell traversal) is
  out of scope; the click/focus path covers the review's a11y ask.

## Spec axis — acceptance criteria (issue #502)

| Criterion | Verdict |
|---|---|
| Popup shows all listed fields | **MET** — all 15 rows rendered; spec asserts each |
| Re-anchors between cells without flicker | **MET** — single overlay anchored to cell element; spec covers move sequence |
| Missing fields → 'n/a' | **MET** — `parseNumOrNull` covers null/undefined/empty/whitespace/non-finite; new spec asserts empty strings → 'n/a' |
| Hover-driven, no click | **MET** — icon-hover opens (plus click/focus for touch+keyboard); no popup on raw cell hover |

## Test results

`npx jest --coverage=false` — **131 suites, 1776 tests, all pass**
(1773 baseline + 3 new specs: empty-string n/a, click/focus popup path,
pct-change rebuild icon clear; the four dead-API specs were replaced
with four icon-behavior specs).

## Verdict

**PASS** — all majors and minors resolved, refactor verified
behavior-preserving on both grids, a11y gap addressed. #502 advances to
`7_QA`. Next: `/proj qa 486 502`.
