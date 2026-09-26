# Code Review — Task #395: FE: Stats panel with large/small/all toggle

**Task:** #395 — FE: Stats panel with large/small/all toggle
**Thread:** #383 — Dual ST ZigZag Overlay
**Blueprint:** #386 — Dual ST ZigZag Overlay Blueprint
**Status:** Complete
**Last Updated:** 2026-09-18

## Verdict: PASS (after fixes)

Three review axes ran in parallel: Standards, Spec, and Thermo-Nuclear. The initial review found no critical/major code defects; the strongest items were a stale page-header comment, an unenforced positional `statsSets` contract, missing `aria-pressed`, hardcoded toggle colors vs. theme tokens, a length-only page-spec assertion, and one deferred verification item (Jest/Syncfusion crash workaround). All actionable findings were fixed and verified.

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| When dual mode on, stats panel shows large/small/all toggle | Met | `isDualMode` = `statsSetsSignal() != null`; page binds `statsSets` only when `dualMode()`; segmented toggle rendered — tested |
| "Large" shows stats for config 0 swings | Met | `STATS_MODE_INDEX.large → statsSets[0]`; page sets `[0] = store.stats()[0]` — tested ("Up (3)") |
| "Small" shows stats for config 1 swings | Met | `statsSets[1] = store.stats()[1]` — tested ("Up (10)") |
| "All" shows combined stats (merge + recompute) | Met | `statsSets[2] = store.allStats()`; store merges `swings[0] + swings[1]` → `computeSwingStats` — count-sum tested |
| Toggle is segmented control (three buttons) | Met | Three `<button>`s in `.stats-toggle` group with `.active` + `aria-pressed` — tested |
| Dual mode off → single-config stats as today | Met | `statsSets = null` → `activeStats` falls back to `stats` — tested |
| Toggle state persists in component state (not Firestore) | Met | `statsMode` private signal; survives dual off→on — tested |
| Blocked by #393 | Satisfied | #393 shipped at `8_LIVE` |

---

## Findings fixed

### 1. Stale page-header comment (Standards + Spec)

`swing-analysis-page.component.ts` still said the stats panel "shows config 0's results only — the large/small/all stats toggle (B5) is a later task."

**Fix:** Header now documents the Large/Small/All toggle driven by `statsSets`.

### 2. Positional `statsSets` contract unenforced (Standards M2/M3)

`statsSets: (SwingStats | null)[]` — nothing enforced the `[large, small, all]` shape; the index mapping was duplicated in producer (page) and consumer (panel ternary).

**Fix:** Exported tuple type `StatsSets = [SwingStats | null, SwingStats | null, SwingStats | null]` + `STATS_MODE_INDEX: Record<StatsMode, 0|1|2>` lookup. Panel input, signal, and page computed all use the tuple type — a wrong-length producer now fails at compile time.

### 3. `allStats` guard + unnecessary sort (TN F5/F6)

`allStats` used `configs().length !== 2` (duplicating `dualMode` logic) and sorted merged swings even though `computeSwingStats` is order-insensitive (filters `confirmed`, aggregates by direction).

**Fix:** Dropped the sort (comment documents why none is needed). `!store.dualMode()` was attempted but sibling computeds aren't visible inside the same `withComputed` block (TS2339) — kept `configs().length !== 2` with a comment explaining why.

### 4. Accessibility + theme tokens (Spec nit + Standards M5)

Toggle buttons had no `aria-pressed`; new styles used hardcoded `#ccc`/`#1976d2`/`#666` vs. the feature's `var(--mat-sys-*)` convention.

**Fix:** `[attr.aria-pressed]` on all three buttons; toggle styles converted to `--mat-sys-outline-variant`, `--mat-sys-on-surface-variant`, `--mat-sys-surface-container`, `--mat-sys-primary`, `--mat-sys-on-primary`. (The panel's pre-existing styles remain hardcoded — noted as deferred cleanup.)

### 5. Test gaps (Standards M7 + TN F3/F4)

Page spec asserted only `statsSets.length === 3`, not ordering/content. Panel spec had a stale comment claiming `setInput` is unsupported (it works on decorator inputs). No test covered the stats+statsSets precedence rule or `statsMode` persistence.

**Fix:**
- Page spec now asserts `statsSets[0] === stats()[0]`, `[1] === stats()[1]`, `[2] === allStats()` via `By.directive(MockStatsPanelComponent)`.
- Panel spec: added "prefers statsSets over stats when both are bound" and "remembers statsMode across dual off→on" tests; comment corrected.

---

## Deferred / documented decisions

### Jest/Syncfusion `ngAfterContentChecked` crash workaround (TN F1 — manual verification recommended)

Syncfusion's `ejs-chart` crashes in Jest (`Cannot read properties of undefined (reading 'length')` inside `ngAfterContentChecked`) when `[dataSource]` changes after init — reproduced by mode-switch tests. Dual-mode fixtures therefore use empty histogram bins so `ejs-chart` is skipped (`@if (bins.length > 0)` gate); toggle behavior is asserted via titles/fields. A track-key recreation approach was tried and did **not** fix the crash (recreation hits the same code path in Jest).

The real-browser update path is standard Syncfusion dynamic-dataSource usage and is expected to work, but **mode switching should be smoke-tested in the running app** before/after deploy since the test path deliberately bypasses it. The fixture comment documents this gap.

### `statsMode` defaults to 'large' even when config 0 has no swings (TN F2)

If config 0 yields zero confirmed swings while config 1 has some, the default 'large' view shows the empty state until the user clicks Small/All. Accepted — 'large' is the primary config; auto-selecting a different default would be surprising. `statsMode` also persists across dual off→on, matching the "component state" criterion (now tested).

### File-size drift (Standards M4)

`stats-panel.component.ts` is now ~320 lines (300 target); `swing-analysis.store.ts` (~540) and `swing-analysis-page.component.ts` (~460) remain over the 400 line. Cumulative debt, not introduced by this task — the store's recompute helpers and the panel's chart config are extraction candidates for a future refactor.

---

## Test results

`npx jest --testPathPatterns="swing-analysis"`: **6 suites, 195 tests — all pass** (was 179 before this task).

`ng build` passed after all review fixes (2026-09-18).

## New tests added by this task

- `stats-panel.component.spec.ts`: 10 dual-mode tests — toggle hidden in single mode, segmented render, Large default, Small/All switching, null-set resilience, revert to flat, statsSets-over-stats precedence, mode persistence.
- `swing-analysis.store.spec.ts`: 4 `allStats` tests — null single/empty, merged count, reset on toggle-off.
- `swing-analysis-page.component.spec.ts`: 2 tests — null in single mode, `[large, small, all]` content identity in dual mode.
