**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Issue:** #330  
**Task:** #336  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-17  

---

# Code Review: Task #336 — FE Swing Table Component (Round 3)

**Verdict: PASS**

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear.
Tests pass (8 suites, 129 tests). All previous Major findings across
rounds 1 and 2 are verified fixed. All 10 sort columns and all 4 filter
types are tested. 7 edge-case tests cover NaN inputs, invalid dates,
min>max, filtered-to-empty, no-data, and Date To end-of-day inclusion.

No critical or major findings from any axis. Minor findings are polish
items, not blockers.

## Previous Findings — All Fixed

| Round | # | Finding | Status |
|---|---|---|---|
| 1 | M1 | NaN numeric filter values silently exclude all rows | FIXED — `Number.isNaN` guards (lines 282-307) |
| 1 | M2 | Empty-state message misleading when filters remove all rows | FIXED — `hasData()` computed + separate branch (lines 125-129, 246) |
| 1 | M3 | Missing edge-case tests | FIXED — 6 new tests |
| 2 | M1 | Date To filter exclusive-of-midnight | FIXED — `toMs + 86_400_000 - 1` (lines 205-209) + new test |

All fixes verified by all three review axes in this round.

## Test Results

```
Test Suites: 8 passed, 8 total
Tests:       129 passed, 129 total
```

All 10 sort columns tested (ascending + descending).
All 4 filter types tested.
Loading and error states tested.
Projected-row styling tested (last row specifically asserted).
Empty states tested (both no-data and filtered-to-empty).
7 edge-case tests pass.

## Findings by Severity

### Minor (not blocking)

#### m1 — Timezone coupling between date filtering and display

**File:** `swing-table.component.ts` lines 203-209, 315-317

`new Date(to).getTime()` gives UTC midnight, `+ 86_400_000 - 1` is UTC
end-of-day, but `formatDate()` calls `toLocaleDateString('en-US', ...)`
which renders in the browser's local timezone. If `swing.start/end.time`
is UTC and the user is not in UTC, a row may be included by `Date To`
yet display the previous day.

**Recommendation:** Verify whether `time` is always UTC; if so, use a
consistent display timezone (e.g., `toLocaleDateString('en-US', { timeZone: 'UTC', ... })`).

#### m2 — `viewSwings` computed is monolithic

**File:** `swing-table.component.ts` lines 191-244

The computed maps, filters by 5 dimensions, and sorts in one block.
Splitting into `filteredSwings` and `sortedSwings` would improve
testability and reduce the component's responsibility.

#### m3 — Component at file-size smell threshold

**File:** `swing-table.component.ts` (335 lines)

Even with the justified inline template, the file is long because of
the combined view model, handlers, and formatting. Extracting the
view-model computation would make the component more focused.

#### m4 — Whitespace in numeric inputs can become filter value of 0

**File:** `swing-table.component.ts` lines 283-309

`Number(' ')` is `0`, but the guard only checks `value === ''`. Trim
before parsing: `const raw = value.trim()`.

#### m5 — Spec file is ~580 lines

**File:** `swing-table.component.spec.ts`

Above the 400-line "strong smell" threshold. Coverage is broad and
well-structured, but lacks a documented reason. Consider adding a
header comment or splitting into separate spec files.

#### m6 — Magic number `86_400_000` duplicated

**File:** `swing-table.component.ts` line 208, `swing-table.component.spec.ts` lines 347-349

Define `export const MS_PER_DAY = 86_400_000` in a shared location and
reference it in both files.

#### m7 — `_index` is a pragmatic hack, not a clean view model

**File:** `swing-table.component.ts` lines 33, 103, 105, 229

Prefixed like a private field but displayed in the template and used as
the `@for` track key. Consider `id: i + 1` and a separate `rowNumber`
field.

#### m8 — Edge-case test coverage still has gaps

**File:** `swing-table.component.spec.ts` lines 471-523

NaN tests only cover `durationMin` and `magnitudeMax`; no NaN test for
`durationMax`/`magnitudeMin`. Also missing: exact end-of-day boundary
for `Date To` (only noon is tested), `min > max` for magnitude, and
equal-value sort stability.

### Nit

#### n1 — Sort has no explicit tie-breaker

**File:** `swing-table.component.ts` lines 226-241

Modern JS sort is stable, so ties preserve the pre-sorted `_index`
order, but an explicit `_index` tie-breaker would make the order
deterministic regardless of runtime.

#### n2 — Unchecked `DirectionFilter` cast

**File:** `swing-table.component.ts` line 272

`(event.target as HTMLSelectElement).value as DirectionFilter` is an
unchecked type cast. Low-risk because `<option>` values are controlled,
but a runtime guard would be safer.

#### n3 — DOM casts in event handlers

**File:** `swing-table.component.ts` lines 271-309

`event.target as HTMLSelectElement` / `HTMLInputElement` is correct in
the template but will silently fail if the event source changes. Type
narrowing with a runtime guard is safer.

## Disputed Findings (Rejected)

### `@Input()` + `OnChanges` is an unjustified workaround

Rejected in round 1. A spike PROVED `input()` signals fail with NG0303
in this Jest environment. The `equity-positions-table` cited as
counter-example FAILS with external resource resolution errors. The
pattern is verified correct. Not re-raised in round 3.

### Inline template/styles

Justified deviation — external resources don't resolve in this Jest
setup. Not blocking.

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Renders all swing columns | MET |
| Sortable by any column (asc/desc) | MET |
| Filter by direction, date range, duration range, magnitude range | MET |
| Last row (projected swing) has distinct styling | MET |
| Empty state when no swings | MET |
| Unit tests pass | MET (129 passed) |

## Verdict

**PASS** — No critical or major findings. All acceptance criteria met.
All previous findings fixed. Tests green. Advancing to QA.
