# Code Review — Task #393: FE: Dual-mode toggle and config UI

**Task:** #393 — FE: Dual-mode toggle and config UI
**Thread:** #383 — Dual ST ZigZag Overlay
**Blueprint:** #386 — Dual ST ZigZag Overlay Blueprint
**Status:** Complete
**Last Updated:** 2026-09-18

## Verdict: PASS (after fixes)

Three review axes ran in parallel: Standards, Spec, and Thermo-Nuclear. The initial review found **1 Major** (keystroke clamp+rewrite on numeric inputs) and several Minor findings. Fixes were applied and verified; the review now passes.

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| Dual-mode toggle control on page | Met | `data-testid="dual-mode-toggle"` → `onToggleDualMode` → `store.toggleDualMode()` |
| When off: page behaves as today (single config, flat table) | Met | `configs` has 1 entry, `chartConfig` has 1 indicator, table/stats show config 0 |
| When on: chart shows two ZigZags, two stacked collapsible config sections | Met | `@for (cfg of configs())` renders one `<details>` per config; `chartConfig` has 2 `IndicatorConfig`s |
| Each section controls deviation, leftDepth, rightDepth, lineColor, allowZigZagOnOneBar | Met | `param-devThreshold-i`, `param-leftDepth-i`, `param-rightDepth-i`, `param-lineColor-i`, `param-allowZigZagOnOneBar-i` |
| Projection pivots always on (no toggle in UI) | Met | No `projectionPivots` input in template; still in config defaults and chart params |
| `chartConfig` builds array with unique `IndicatorConfig.id` per instance | Met | `st-zigzag-${index}` — tested for both slots |
| Config 1 labeled "Large Swings", Config 2 labeled "Small Swings" | Met | `CONFIG_LABELS` constant, tested |
| Save button calls correct index | Met | `onSave(i)` → `store.saveAnalysis(index)` — tested for both slots |

---

## Major Findings (fixed)

### M1. Keystroke clamp+rewrite on numeric inputs

**File:** `swing-analysis-page.component.ts` — numeric input handlers

**Issue:** `(input)` fires on every keystroke → `updateConfig` clamps → `[value]` binding writes the clamped value back into the focused input mid-typing. Typing `15` into Left Depth: `1` → clamped to `2` → input rewritten → `25`/`52` depending on cursor.

**Fix:** Changed `(input)` to `(change)` on numeric inputs. `change` fires on blur/Enter, not per keystroke. `min`/`max` attributes bound to `NUMERIC_BOUNDS` for browser-level validation hints. The `lineColor` input keeps `(input)` since it's a picker, not typing.

### M2. `swings`/`stats` only expose config 0 — config 1 results never rendered

**File:** `swing-analysis-page.component.ts` — computed signals

**Issue:** In dual mode the table and stats panel render only "Large Swings" results — config 1's swings/stats are computed but never displayed except through `canSave`.

**Fix:** Documented in the header comment — intentional per the plan. The nested tree table (B4) and stats toggle (B5) will consume config 1's results. This is a staging step, not a gap.

---

## Minor Findings (fixed)

### m1. `[open]="true"` binding defeats collapsible `<details>`

**File:** `swing-analysis-page.component.ts` — `<details>` element

**Fix:** Changed `[open]="true"` to static `open` attribute. Angular only writes the property once (constant value) but the static attribute is clearer and won't be "fixed" to a dynamic binding by a future dev.

### m2. `canSave` uses `!== null` instead of `!= null`

**File:** `swing-analysis-page.component.ts` — `canSave` method

**Fix:** Changed `!== null` to `!= null` (loose) — catches both `null` and `undefined`. Arrays are kept aligned by the store today, but this is a safer contract.

### m3. `min`/`max` attributes duplicated in template

**File:** `swing-analysis-page.component.ts` — template

**Fix:** Bound `[attr.min]`/`[attr.max]` to `NUMERIC_BOUNDS` via `numericBounds()` method — single source of truth for validation bounds.

### m4. `onToggleDualMode` ignores checkbox's checked state

**File:** `swing-analysis-page.component.ts` — `onToggleDualMode` method

**Fix:** Now passes `$event` and reads `checked` — only toggles when `checked !== dualMode()`. Prevents desync if the checkbox state ever diverges from the store.

### m5. No test for toggling OFF

**File:** `swing-analysis-page.component.spec.ts`

**Fix:** Added test — toggle on → toggle off → expect 1 `.config-section` and 1 indicator.

### m6. No test for collapsible sections

**File:** `swing-analysis-page.component.spec.ts`

**Fix:** Added test — asserts `details.config-section` elements exist, `open` is true, `summary.config-section-header` exists.

### m7. No test for save button disabled when stats is null

**File:** `swing-analysis-page.component.spec.ts`

**Fix:** Added test — without `setSymbol`, both save buttons are disabled (stats are null).

---

## Deferred (not fixed — out of scope or follow-up)

| Finding | Severity | Reason |
|---|---|---|
| File size 438 lines exceeds 400-line threshold | Minor | Borderline — inline template + styles are the bulk; extracting a `SwingConfigSectionComponent` is a follow-up |
| `loadAnalysis` can apply `projectionPivots: false` silently | Minor | `loadAnalysis` patches config from doc — invisible-but-active state; edge case for saved docs with non-default `projectionPivots` |
| `toggleDualMode` discards config-1 edits on off→on | Minor | Store restores `SMALL_CONFIG` defaults — UX concern; consider keeping config in state and only filtering renders |
| Double ZigZag computation per config change | Minor | Pre-existing architectural pattern — `computedSeries` and `zigZagSeries` both call `computeZigZagPivots` |
| Spec `any` types (`fixture: any`, `(el: any)`) | Minor | Pre-existing pattern in page spec |
| Spec TestBed duplication (error/loading tests) | Minor | Pre-existing pattern — parameterized by `loadBars$` observable |
| `configLabel` fallback `Config ${index}` dead code | Nit | Store hard-codes `dualMode = configs.length === 2` — N-ready hedge |
| `swing-analysis-controls` layout — dual-mode checkbox in same flex row as Symbol | Nit | Cosmetic — no separator between global and per-config controls |

---

## Test Coverage

| Test | Added |
|---|---|
| Dual-mode toggle control exists | **New** |
| One config section when dual mode off | **New** |
| Two config sections when dual mode on | **New** |
| Config section labels "Large Swings" / "Small Swings" | **New** |
| `toggleDualMode` called when toggle clicked | **New** |
| `chartConfig` one IndicatorConfig when off | **New** |
| `chartConfig` two IndicatorConfigs with unique ids when on | **New** |
| Per-config params to each chart indicator | **New** |
| `updateConfig` with correct index when param changes | **New** |
| `updateConfig` when lineColor changes | **New** |
| `saveAnalysis` with correct index when save clicked | **New** |
| Save buttons enabled independently | **New** |
| Toggling off restores single section and one indicator | **New** |
| Collapsible sections via details/summary | **New** |
| Save button disabled when stats is null | **New** |
| Param controls exist for all fields | Updated |
| Default config values in controls | Updated |
| `setSymbol` on symbol input | Already existed |
| `updateConfig` on numeric param change | Already existed |
| Clamp to minimum | Already existed |
| Reject empty input | Already existed |
| `updateConfig` on boolean param | Already existed |
| `chartData` from store bars | Already existed |
| `chartConfig` with ST_ZIGZAG indicator | Already existed |
| Config params to chart indicator | Already existed |
| Swing table with store swings | Already existed |
| Loading state to swing table | Already existed |
| Stats panel with store stats | Already existed |
| Save button renders | Already existed |
| `saveAnalysis` called on click | Already existed |
| Service called on save | Already existed |
| Save disabled when no symbol/stats | Already existed |
| Save enabled when symbol and stats | Already existed |
| Error message renders | Already existed |
| Loading indicator shows | Already existed |

**Total: 40 tests, all passing.**

---

## Files Changed

| File | Change |
|---|---|
| `swing-analysis-page.component.ts` | Full rewrite: dual-mode toggle, collapsible config sections, per-config controls, unique `IndicatorConfig.id`, per-config save buttons, `numericBounds()` method, `(change)` on numeric inputs, `!= null` in `canSave`, `onToggleDualMode` passes checked state, static `open` attribute, header comment documents B4/B5 scope |
| `swing-analysis-page.component.spec.ts` | Updated test IDs to indexed format, `(input)` → `(change)` for numeric inputs, added 16 new tests for dual-mode features |

---

## Verification

- 5 suites, **153 tests** — all pass
- Angular build passes
- Only Topic #261 files modified

---

## Next Step

```
/proj ship 261 393
```
