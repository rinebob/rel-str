**Topic:** Option chain percent change grid
**Topic Slug:** option-chain-pct-change-grid
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl
**Issue:** #342
**Thread Parent:** #327
**Topic Parent:** #326
**Task:** #347
**Domain:** OPTIONS
**Type:** Code Review
**Status:** Complete
**Created:** 2026-09-16
**Last Updated:** 2026-09-16

---

# Code Review: Task #347 — Grid Component + Page + Routing

## Summary

Task #347 adds the `PctChangeGridComponent` (grid heatmap), the
`OptionChainPctChangeComponent` (page with input form + results panel), and the
`OPTION_CHAIN_PCT_CHANGE` route + navigation menu entry. Three review axes ran
in parallel (Standards, Spec, Thermo-nuclear). All major findings were
resolved during review. The key design improvement was precomputing the grid
row matrix in a `computed()` signal, eliminating per-CD-cycle `getCell()` calls
and the redundant `cellMap` re-wrapping.

## Findings by Severity — with Fixes

### Major

#### 1. Missing navigation menu item
**Finding:** `NAV_MENU_ITEMS` in `constants.ts` had no entry for
`option-chain-pct-change`. The route existed but was not discoverable from the
sidenav.
**Fix:** Added a `NavItem` entry alongside `history`.
`src/app/core/common/constants.ts:158-165`

#### 2. `cellMap` was an unnecessary re-wrapping of an already-keyed Map
**Finding:** `grid().cells` is already a `Map<string, PctChangeCell>` keyed by
`strike-expiration`. The `cellMap` computed copied every entry into a second
Map of the same shape.
**Fix:** Deleted `cellMap` and `getCell`. Added a `rows` computed that
precomputes the full row/cell matrix once per grid change. The template now
iterates `rows()` directly with no per-cell function calls.
`pct-change-grid.component.ts:146-156`

#### 3. Symbol input upper-cased on every keystroke, resetting caret
**Finding:** `store.setSymbol()` does `toUpperCase()`, which rewrites the
input's `value` on every `input` event, moving the cursor to the end.
**Fix:** Changed all input bindings from `(input)` to `(change)`, which fires
on blur/Enter. The symbol is normalized only when the user leaves the field.
`option-chain-pct-change.component.ts:39-44`

#### 4. CSS grid layout would not scale for many expirations
**Finding:** `1fr` columns with no `minmax()` and `overflow: hidden` on the
host would clip wide grids.
**Fix:** Changed to `minmax(80px, 1fr)` and added a `.grid-scroll` wrapper
with `overflow-x: auto` and `min-width: max-content` on the grid body.
`pct-change-grid.component.ts:30, 69-74`

### Minor

#### 5. `matButton`/`matIconButton` camelCase selectors
**Finding:** The rest of the codebase uses kebab-case (`mat-button`,
`mat-icon-button`).
**Fix:** Changed all Material button selectors to kebab-case
(`mat-stroked-button`, `mat-icon-button`).
`option-chain-pct-change.component.ts` (multiple lines)

#### 6. `toNum` duplicated; canonical version in `pct-change.utils.ts`
**Finding:** The page defined its own `toNum` while the utils file already had
a stricter version (uses `Number.isFinite`).
**Fix:** Exported `toNum` from `pct-change.utils.ts` and reused it in the page
component. Removed the duplicate.
`pct-change.utils.ts:49`, `option-chain-pct-change.component.ts:14`

#### 7. `formatPct`/`formatPrice` could produce `-0.0%` / `$-0.00`
**Finding:** `pct > 0 ? '+' : ''` does not catch negative zero.
**Fix:** Added near-zero normalization: `Math.abs(pct) < 0.05 ? 0 : pct` and
`Math.abs(price) < 0.005 ? 0 : price`.
`pct-change-grid.component.ts:184-194`

#### 8. Grid guard checked `strikes.length` instead of `cells.size`
**Finding:** If `cells` is empty but `strikes` is non-empty, the grid would
render empty cells instead of the no-data message.
**Fix:** Changed the guard to `grid().cells.size === 0`.
`pct-change-grid.component.ts:28`

#### 9. `cellTooltip` duplicated formatting logic
**Finding:** Tooltip used `toFixed()` directly instead of reusing
`formatPct`/`formatPrice`.
**Fix:** Tooltip now calls `this.formatPct()` and `this.formatPrice()`.
`pct-change-grid.component.ts:174-183`

### Nit

#### 10. Unused imports in grid spec
**Finding:** `ComponentRef` and `OptionType` were imported but never used.
**Fix:** Removed both.
`pct-change-grid.component.spec.ts`

#### 11. Unused `CommonModule` import in grid component
**Finding:** The template only uses built-in `@if`/`@for` control flow and no
common pipes.
**Fix:** Removed `CommonModule` from imports.
`pct-change-grid.component.ts`

### Deferred

#### 12. Page template is inline (354 lines)
**Finding:** The page component inlines the full template and styles. The
existing `options-strategy-dashboard.component.ts` uses
`templateUrl`/`styleUrl`.
**Status:** Deferred — the inline template is self-contained and works. A
future refactor could extract the input form into a separate child
component.

#### 13. `$any($event.target).value` casts
**Finding:** Repeated `$any()` casts to read input values.
**Status:** Replaced with a typed `inputValue(ev: Event)` helper that casts
`ev.target` to `HTMLInputElement`. The template now uses
`inputValue($event)` instead of `$any($event.target).value`.

#### 14. `setTimeout`-based async tests
**Finding:** Page tests use `setTimeout` to wait for `runAnalysis()`.
**Status:** Accepted — the pattern matches existing store specs in the repo
(`swing-analysis.store.spec.ts`, `option-chain-pct-change.store.spec.ts`).
The mocked `forkJoin` of `of(...)` is effectively synchronous, so `setTimeout`
is a safe flush mechanism.

## Test Results

- **Unit tests:** 78/78 PASS
  - 36 from Task #345 (pct-change utils)
  - 20 from Task #346 (store)
  - 22 from Task #347 (14 grid + 8 page)
- **Angular build:** PASS

## File Sizes

| File | Lines | Status |
|------|-------|--------|
| `pct-change-grid.component.ts` | 200 | Under 300 target |
| `pct-change-grid.component.spec.ts` | 186 | Under 400 |
| `option-chain-pct-change.component.ts` | 352 | Inline template; deferred |
| `option-chain-pct-change.component.spec.ts` | 185 | Under 400 |

## Verdict: PASS

All major findings resolved during review. The key design improvement
(precomputed `rows()` matrix) eliminates per-CD-cycle function calls and
simplifies the template. Deferred findings are intentional design decisions
or future refactoring items. All 78 unit tests pass. Angular build passes.
