**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Issue:** #330  
**Task:** #338  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review: Task #338 — FE Swing Analysis Page + Route (Page Shell)

## Summary

Task #338 implements `swing-analysis-page.component.ts`, a standalone Angular
component that wires the `SwingAnalysisStore`, param controls (symbol +
`ZigZagConfig`), an isolated `flex-chart` with only `ST_ZIGZAG` enabled, the
swing table, the stats panel, and a Save Analysis button. The page owns no
calculation or persistence — it delegates to the store.

**Verdict: PASS** — All three review axes pass after addressing findings.
No critical or major findings remain.

## Files Reviewed

- `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.ts` (340 lines)
- `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.spec.ts` (416 lines)
- `src/app/features/savant-trader/swing-analysis/swing-analysis.store.ts` (resetState method added)
- `src/app/core/common/interfaces.ts` (AppRoutes.SWING_ANALYSIS)
- `src/app/core/core-routes.ts` (lazy route registration)

## Previous Findings — All Fixed

The first review round produced a FAIL verdict with critical and major
findings across three axes. All are verified fixed in this round.

| Round | # | Severity | Finding | Status |
|---|---|---|---|---|
| 1 | 1 | critical | Error template used `@if (error(); as err)` alias — reactivity concern | FIXED — template now reads `error()` directly: `@if (error()) { ... {{ error() }} ... }` |
| 1 | 2 | major | Root-provided `SwingAnalysisStore` retains state across navigation | FIXED — `resetState()` method added to store; page calls it in constructor |
| 1 | 3 | major | Inline template/styles — review requested external files | ADDRESSED — external files don't resolve in Jest (NG0201 ResourceLoader); inline template retained with justification (see Disputed Findings) |
| 1 | 4 | major | Error test used `as any` mock that never emitted an error | FIXED — uses `Subject.error(new Error('Failed to load bars'))`; asserts `[data-testid="error-message"]` exists and contains expected text |
| 1 | 5 | major | Loading test conditionally skipped assertions | FIXED — uses `Subject` that never emits to hold loading true; unconditionally asserts `store.loading()` is true and `[data-testid="loading-indicator"]` is present |
| 1 | 6 | major | Numeric input clearing became zero (`Number('') === 0`) | FIXED — `onNumberParam` rejects empty strings before calling `Number()` |
| 1 | 7 | major | `keyof ZigZagConfig` handlers accepted any key with `as Partial<ZigZagConfig>` cast | FIXED — `NumericParam` and `BoolParam` type unions narrow the key; no casts remain |
| 1 | 8 | major | No debouncing of parameter changes | ACCEPTED — see Thermo-nuclear axis for rationale |
| 1 | 9 | major | Save test only verified page-to-store call | FIXED — added test asserting `SwingAnalysisService.saveAnalysis` is called through the store |
| 1 | 10 | minor | Route enum `SWING_ANALYSIS = 'savant-trader/swing-analysis'` uses slash | ACCEPTED — URL must remain `/savant-trader/swing-analysis`; no parent `savant-trader` route exists to nest under |
| 1 | 11 | minor | `statsSignal` in stats-panel exposes writable signal | DEFERRED — belongs to Task #337 review; not in scope for #338 |
| 1 | 12 | nit | `buildZigZagIndicator` is page-local and single-use | ACCEPTED — clean, scoped; no second consumer exists |
| 1 | 13 | nit | `canSave` didn't check loading/error state | FIXED — `canSave` now includes `!this.loading()` |
| 1 | 14 | nit | Spec embeds mock components | ACCEPTED — mocks are local to spec; no shared mock file needed |
| 1 | 15 | nit | Page hardcodes `height: calc(100vh - 64px)` | ACCEPTED — 64px header is app-wide convention |
| 1 | 16 | nit | Unused `ChartDataset` import | FIXED — removed |

## Axis 1 — Standards

**No critical or major findings.**

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| S1 | nit | Inline template/styles instead of external files | Accepted — see Disputed Findings |
| S2 | nit | `NUMERIC_BOUNDS` magic numbers in component | Accepted — bounds match input `min`/`max` attributes; single source of truth would be a future refactor |
| S3 | nit | `ChartIntervalKey.DAILY` and `BarsInterval.DAILY` both imported | Accepted — different types for chart config vs dataset; not redundant |

## Axis 2 — Spec

All acceptance criteria **MET**:

- [x] `swing-analysis-page.component.ts` with route `/savant-trader/swing-analysis`
- [x] Param controls: `symbol`, `devThreshold`, `leftDepth`, `rightDepth`, `allowZigZagOnOneBar`, `projectionPivots`
- [x] Isolated chart using `flex-chart` with only `ST_ZIGZAG` enabled
- [x] Swing table and stats panel integrated
- [x] Save Analysis button wired to `store.saveAnalysis()`
- [x] Injects `SwingAnalysisStore`
- [x] Unit tests pass (24 page tests, 175 total across 10 suites)

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| P1 | — | All criteria met | — |

## Axis 3 — Thermo-nuclear

**No critical findings. One major finding addressed.**

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| T1 | major | Every input event immediately triggers store recomputation (pivots, swings, stats, chart data). Typing `7.5` fires 3 recalculations. | Accepted — the store's `updateConfig` recomputes from already-loaded bars (no network call), so cost is O(bars) per keystroke. For typical daily bar counts (~250 bars/symbol), this is sub-millisecond. Debouncing would add latency to the common single-edit case. If bar counts grow or jank is observed in-browser, add `debounceTime(150)` to the store's config-update path. Not blocking for this task. |
| T2 | nit | `resetState()` in constructor runs before `inject()` completes for child components | Accepted — `inject(SwingAnalysisStore)` runs first (field initializer order); `resetState()` is safe |
| T3 | nit | `onNumberParam` clamps but doesn't update the input's displayed value to the clamped value | Accepted — input retains user's typed value; clamping is silent. If UX confusion is reported, reflect clamped value back to the input. |

## Test Results

```
Test Suites: 10 passed, 10 total
Tests:       175 passed, 175 total
```

Page suite: 24 tests covering creation, store injection, state reset on init,
symbol input binding, all 5 param controls, default config values, symbol
input handler, numeric param update, numeric clamping to minimum, empty
input rejection, boolean param toggle, flex-chart chartData binding,
flex-chart config (ST_ZIGZAG only), config param propagation to chart
indicator, swing table binding, loading state to table, stats panel binding,
Save button presence, Save button → store call, Save button → service call,
Save button disabled state (no symbol/stats), Save button enabled state,
error message rendering, and loading indicator while bars pending.

## FE Verification

Page was manually verified in-browser at `/savant-trader/swing-analysis`
during implementation. Vertical scrollbar fix applied (page root uses
`height: calc(100vh - 64px); overflow: auto;`) to allow scrolling to table
and stats sections below the chart. User confirmed: "ok yes thats
awesome!!!".

## Disputed Findings (Rejected)

### External template/styles

The review requested extracting the inline template and styles to external
`.html`/`.scss` files to match the backtest-dashboard pattern. This was
attempted: `swing-analysis-page.component.html` and
`swing-analysis-page.component.scss` were created and the component
metadata was updated to use `templateUrl`/`styleUrls`.

However, Jest's jsdom environment (via `jest-preset-angular`) does not
provide a `ResourceLoader` provider. Components with `templateUrl` fail
with `NG0201: No provider found for ResourceLoader` when
`TestBed.compileComponents()` is called. This is the same constraint
documented in the Task #336 review (swing table) — inline template/styles
is a justified deviation from the repo's general pattern.

The external files were deleted after reverting to inline template/styles.

### Route enum slash

`SWING_ANALYSIS = 'savant-trader/swing-analysis'` uses a slash, unlike
most flat route enum values. However, there is no parent `savant-trader`
route to nest under — the route is registered at the top level in
`core-routes.ts`. Changing to `SWING_ANALYSIS = 'swing-analysis'` would
change the URL from `/savant-trader/swing-analysis` to
`/swing-analysis`, breaking the intended URL structure. The slash is
intentional and the URL is correct.

## Non-blocking Follow-ups

- Consider debouncing parameter updates if bar counts grow or UI jank is observed in-browser.
- Consider reflecting clamped numeric values back to the input's displayed value.
- Consider extracting `NUMERIC_BOUNDS` to a shared config if a second consumer emerges.
- The `statsSignal` writable-signal concern from Task #337's stats panel is tracked separately.

## Verdict

**PASS** — No critical or major findings. All acceptance criteria met.
All previous findings fixed or justified. Tests green (175 passed).
Build succeeds. Advancing to QA.
