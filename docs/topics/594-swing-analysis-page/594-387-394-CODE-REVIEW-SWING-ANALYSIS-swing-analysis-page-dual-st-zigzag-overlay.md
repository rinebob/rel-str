# Code Review — Task #394: FE: Nested tree swing table

**Task:** #394 — FE: Nested tree swing table
**Thread:** #383 — Dual ST ZigZag Overlay
**Blueprint:** #386 — Dual ST ZigZag Overlay Blueprint
**Status:** Complete
**Last Updated:** 2026-09-18

## Verdict: PASS (after fixes)

Three review axes ran in parallel: Standards, Spec, and Thermo-Nuclear. The initial review found **4 Majors** (triplicated cell template, duplicate `@for` track keys, `collapsedKeys` leaking across dataset changes, file size over threshold) and several Minor findings. Fixes were applied and verified; the review now passes.

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| When dual mode on, swing table becomes nested tree | Met | `smallSwings` bound only when `dualMode()` (page `smallSwings` computed); `isTreeMode` computed; tree `<tbody>` branch |
| Parent rows = large swings (config 0) | Met | `swings = store.swings()[0]` passed as `swings` input |
| Child rows = small swings within parent's time range | Met | `buildTreeSwings`: `small.start.time ∈ [parent.start, parent.end]` |
| Small swing assigned to large swing active at its start | Met | Scan-from-end loop assigns boundary starts to the *later* parent; spanning smalls go to the start-active parent — both tested |
| Expand/collapse all button | Met | `onToggleAll()`, `data-testid="expand-collapse-all"`, label flips — tested |
| Individual parent rows expand/collapse independently | Met | `collapsedKeys: Set<number>` keyed by `_order`; `toggleRow` — tested |
| Current swing = last row at each level | Met | Chronological order + `.projected` styling on `!confirmed` rows at both levels — tested |
| Sorting applies to parent rows; children stay chronological | Met | `applySort` on `viewTreeRows` only; children sorted once in `buildTreeSwings` — tested |
| When dual mode off, table reverts to flat view | Met | `smallSwings = null` → `isTreeMode` false → flat branch — tested |
| `buildTreeSwings` is pure and unit-tested | Met | Pure function in `swing-tree.utils.ts`; 11 spec cases incl. non-mutation |

---

## Major Findings (fixed)

### M1. Cell template triplicated (Standards)

**File:** `swing-table.component.ts` — parent row, child row, flat row `<td>` blocks

**Issue:** The same 9 cells (direction badge through volume) appeared three times with only the variable name differing. Any column change would need three edits — a drift hazard, and the duplication contributed to the file-size overage.

**Fix:** Extracted `<ng-template #swingCells let-s>` with `*ngTemplateOutlet` in all three row types. The per-row-type cells (`#` index, expander) stay inline.

### M2. Duplicate `track row.start.time` keys → NG0955 crash (Thermo-Nuclear)

**File:** `swing-table.component.ts` — `@for` track expressions

**Issue:** With `allowZigZagOnOneBar: true` (default), a pivot high and low can occur on the same bar → a zero-duration swing whose `start.time` equals the next swing's `start.time`. Two parent rows sharing a track key throws `NG0955` in dev and corrupts DOM identity in prod. `collapsedKeys` (also keyed by `start.time`) could not distinguish the rows — collapsing one would collapse both.

**Fix:** Track by `row._order` (unique merged-position index assigned per row) for parents and `track $index` for children. `collapsedKeys` now keyed by `_order`; `toggleRow`/`isCollapsed`/`onToggleAll` updated. Regression test added (two parents sharing `start.time`).

### M3. `collapsedKeys` persisted across dataset/symbol changes (Thermo-Nuclear)

**File:** `swing-table.component.ts` — `ngOnChanges`

**Issue:** All symbols share the same daily-bar timestamps. Switching AAPL→MSFT produces large swings at identical `start.time` values — a parent collapsed on one symbol silently collapsed a *different* parent at the same timestamp on the next.

**Fix:** `collapsedKeys` cleared in `ngOnChanges` when `swings` or `smallSwings` inputs change. Regression test added (collapse → swap array with same timestamps → row renders expanded).

### M4. File size 504 lines over the ~400-line guideline (Standards)

**File:** `swing-table.component.ts`

**Issue:** Tree mode added ~175 lines to a ~330-line file, crossing the guideline threshold.

**Fix:** The `#swingCells` extraction (M1) recovered ~30 lines. Remaining size (~470) is documented in the file header per the "documented reason" clause: the file hosts two table presentations sharing one filter/sort/cell pipeline; splitting would duplicate that pipeline. A `SwingTreeTableComponent` extraction is a candidate follow-up if the file grows further.

---

## Minor Findings (fixed)

### m1. Stale page header comment (Standards)

**File:** `swing-analysis-page.component.ts` — header doc

**Issue:** Said "the nested tree table (B4) ... is a later task" — B4 is now wired.

**Fix:** Updated — tree table described as implemented; only stats toggle (B5) remains.

### m2. `isTreeMode` used `!== null` — `undefined` would enter tree mode (TN nit)

**File:** `swing-table.component.ts`

**Fix:** `!= null` — covers both `null` and `undefined`.

### m3. `buildTreeSwings` boundary rule depended on input ordering (TN minor)

**File:** `swing-tree.utils.ts`

**Issue:** "Later parent" was determined by array position; unsorted `largeSwings` input could assign a small swing to a temporally-earlier parent. Latent (store produces sorted swings).

**Fix:** Defensive `parents.sort` by `start.time` before assignment + precondition comment.

### m4. Inconsistent expand/collapse API signatures (Standards nit)

**File:** `swing-table.component.ts`

**Fix:** `toggleRow` now takes the row like `isCollapsed` (was raw key).

---

## Spec Deviations (documented, not fixed)

| Finding | Severity | Rationale |
|---|---|---|
| Orphan rows — small swings outside every parent's range render as top-level `S{n}` rows instead of being dropped | Improvement | The plan's edge case says "no large swings → tree is empty"; dropping orphans would silently lose data. Early-history small swings before the first confirmed large pivot are common in real data. Documented in `swing-tree.utils.ts` header; tested (utils spec + component spec) |
| Filters apply to top-level rows only — children of a filtered-out parent vanish; matching children of non-matching parents are not promoted | Minor | Intentional and tested. The alternative (independent child filtering or descendant-match promotion) is a product decision — flagged for future UX review |
| Collapse-all operates on filtered rows only | Nit | A filtered-out parent stays expanded; acceptable |
| Orphan/parent `_index` numbering is pre-filter, so filtered views can show gaps (`1, 3`, `S2`) | Nit | Consistent with flat mode where `_index` is an identity label |
| Empty-state copy can't distinguish "no symbol" from "symbol entered, zero swings" | Minor | Pre-existing weakness inherited from flat mode |

---

## Deferred (not fixed — out of scope or follow-up)

| Finding | Severity | Reason |
|---|---|---|
| `swing-table.component.ts` ~470 lines (post-dedup) | Minor | Documented per guideline "documented reason"; extract `SwingTreeTableComponent` if it grows |
| `swing-analysis-page.component.ts` ~450 lines | Minor | Pre-existing; component extraction is a separate refactor |
| `isCollapsed` structural param type | Nit | Typed `ViewTreeRow` now |
| `formatMagnitudeAbsolute` duplicates `formatPrice` | Nit | Pre-existing; kept for semantic clarity |

---

## Test Coverage

| Test | Added |
|---|---|
| `buildTreeSwings` assigns by start time | **New** |
| Shared-pivot boundary → later parent | **New** |
| Spanning small → start-active parent | **New** |
| Orphan before first / after last parent | **New** |
| Orphan-only when no large swings | **New** |
| Empty inputs → empty | **New** |
| Children chronological on unordered input | **New** |
| Top-level rows chronological | **New** |
| Small at first parent start included | **New** |
| No input mutation | **New** |
| Tree mode renders parents + expander column | **New** |
| Children under expanded parents (default) | **New** |
| Per-parent collapse/expand | **New** |
| Collapse-all / expand-all round trip | **New** |
| No expand-all button when no children | **New** |
| Orphan rows `S{n}` index, no expander | **New** |
| Sort top-level only; children chronological | **New** |
| Direction filter on top-level rows | **New** |
| Projected styling on child rows | **New** |
| Reverts to flat when `smallSwings` → null | **New** |
| Orphan-only tree with no large swings | **New** |
| Collapse state clears on dataset change | **New** |
| Zero-duration parents sharing `start.time` | **New** |
| Page passes null `smallSwings` in single mode | **New** |
| Page passes `swings()[1]` in dual mode | **New** |

**Total: 179 tests (6 suites), all passing.**

---

## Files Changed

| File | Change |
|---|---|
| `swing-tree.utils.ts` | **New** — `TreeSwingRow` + pure `buildTreeSwings`; boundary rule (later parent), orphan rows, defensive parent sort |
| `swing-tree.utils.spec.ts` | **New** — 11 tests |
| `swing-table.component.ts` | `smallSwings` input, tree mode (parents/children/orphans), `_order`-keyed expand/collapse, collapse cleared on dataset change, shared `#swingCells` template, shared filter/sort helpers, `!= null`, file-size note |
| `swing-table.component.spec.ts` | Host binds `smallSwings`; 13 new tree-mode tests |
| `swing-analysis-page.component.ts` | `smallSwings` computed bound to table; header comment updated |
| `swing-analysis-page.component.spec.ts` | Mock captures `smallSwings`; 2 new tests |

---

## Verification

- 6 suites, **179 tests** — all pass
- Angular build passes
- Only Topic #261 files modified

---

## Next Step

```
/proj ship 261 394
```
