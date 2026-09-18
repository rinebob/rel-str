**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Issue:** #387  
**Task:** #389  
**Thread Parent:** #383  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** PASS  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #389: Add lineColor to ZigZagConfig type

## Summary

Task #389 adds a `lineColor: string` field to `ZigZagConfig`, updates
`DEFAULT_CONFIG`, adds it to `ST_ZIGZAG_INDICATOR.params`, updates
`extractConfig` to extract it, passes it through `buildZigZagIndicator`,
and updates 7 test files to include the new field.

This is a type-only task (Task A1). Rendering consumption of `lineColor`
is explicitly deferred to Task A2 (Multi-ZigZag rendering in flex-chart)
per the SHARED implementation plan.

## Findings by severity

### Critical

None.

### Major

None.

### Minor

1. **`lineColor` plumbed but not consumed by rendering** —
   `computeZigZagSeries` still uses the hard-coded `ZIGZAG_COLOR` constant
   (`st-zigzag.indicator.ts:127`) at lines 158 and 173. `config.lineColor`
   is extracted but ignored. This is by design — Task A2 will wire
   `config.lineColor` into `buildSegment` calls and remove `ZIGZAG_COLOR`.
   The `ST_ZIGZAG_INDICATOR.params` entry advertises a "Line Color" field
   that has no visual effect until Task A2.

2. **Duplicate source of truth for default color** —
   `DEFAULT_CONFIG.lineColor = '#1976d2'` (`st-zigzag.types.ts:106`) and
   `ZIGZAG_COLOR = '#1976d2'` (`st-zigzag.indicator.ts:127`) are two
   independent literals. Will be resolved in Task A2 when `ZIGZAG_COLOR`
   is removed and `config.lineColor` is consumed directly.

3. **Missing edge-case tests for `extractConfig` lineColor branch** —
   No test for: empty string, non-string value, undefined. The `typeof`
   check handles undefined and non-strings (falls back to default), but
   empty string passes through. Should be addressed in Task A2 when
   rendering consumption is wired.

4. **Legacy Firestore docs lack `lineColor`** —
   Existing saved analyses have `config` without `lineColor`. The type
   says it's required, but `extractConfig` handles undefined gracefully
   (falls back to `DEFAULT_CONFIG.lineColor`). Runtime is safe; the type
   is technically violated. Will be addressed in Task B1 (bars
   deduplication) which touches the Firestore load path.

### Nit

5. **`deriveParamsId` ignores `lineColor`** —
   Two configs differing only by color produce the same `paramsId`. This
   is correct behavior — color is cosmetic and shouldn't affect the
   Firestore doc ID. The JSDoc on `paramsId` says "hash of the
   ZigZagConfig params" which is slightly misleading. Consider updating
   the JSDoc to say "hash of computation-affecting params."

6. **Fixture duplication** —
   `#1976d2` is repeated in 8 test config literals across 3 spec files.
   Could use `DEFAULT_CONFIG.lineColor` or spread `DEFAULT_CONFIG` instead.
   Low priority cleanup.

7. **`ZigZagConfig` doc says "computation"** —
   `st-zigzag.types.ts:10` says "Configuration for ZigZag pivot
   computation" but now includes `lineColor` (a rendering field). Consider
   updating to "Configuration for ZigZag pivot computation and rendering."

8. **Display field in computation config** —
   Architectural concern: `lineColor` is a rendering concern placed in a
   computation config type. This causes pure engine tests to carry an
   irrelevant color field. Pragmatic design decision accepted during
   planning; splitting into `ZigZagConfig` + `ZigZagDisplayConfig` would
   require more refactoring. Document for future consideration.

## Test results

- 10 test suites, 177 tests — all pass.
- Angular build passes.
- Pine export (`rb-st-zigzag.pine`) unaffected — has its own independent
  `Settings.lineColor` field.

## Acceptance criteria verification

| Criterion | Status |
|-----------|--------|
| `lineColor: string` added to `ZigZagConfig` in `st-zigzag.types.ts` | MET |
| `DEFAULT_CONFIG.lineColor` is `'#1976d2'` | MET |
| Pine export unaffected (own `Settings` type) | MET |
| Existing tests pass with the new field | MET (177/177) |

## Verdict

**PASS** — All acceptance criteria met. Findings are actionable items
for Task A2 (rendering consumption) and Task B1 (Firestore load path),
not blockers for this task.

## Files changed

| File | Change |
|------|--------|
| `st-zigzag.types.ts` | Added `lineColor: string` to `ZigZagConfig`, `lineColor: '#1976d2'` to `DEFAULT_CONFIG` |
| `st-zigzag.indicator.ts` | Added `lineColor` to `ST_ZIGZAG_INDICATOR.params`, `extractConfig` extracts `lineColor` |
| `swing-analysis-page.component.ts` | `buildZigZagIndicator` passes `lineColor` through to params |
| `st-zigzag.indicator.spec.ts` | Updated 5-param test to 6-param, added `lineColor` tests |
| `st-zigzag.pivots.spec.ts` | Added `lineColor` to 5 `ZigZagConfig` objects |
| `st-zigzag.engine.spec.ts` | Added `lineColor` to 2 `ZigZagConfig` objects |
| `swing-analysis.service.spec.ts` | Added `lineColor` to local `DEFAULT_CONFIG` |
