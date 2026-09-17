**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Save param configuration  
**Thread Slug:** save-param-config  
**Issue:** #367  
**Task:** #372  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-17  
**Last Updated:** 2026-09-17  

---

# Code Review — Task #372: Add target type selector component

## Summary

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The task adds a standalone Angular component for selecting the target date resolution mode (pct-change, swing-extremes, user-dates) with sub-mode UIs and editable target dates.

## Findings by severity

### Critical
1. **`generateIntervalDates('')` hardcoded empty startDate** — `target-type-selector.component.ts:182,402` (all axes). **FIXED**: Added `startDate` as `@Input()`. The `generateInterval()` method now uses `this.startDate` and guards against empty values.
2. **`resolvePctChange()` did not resolve** — `target-type-selector.component.ts:376-381` (Spec + Thermo-nuclear). **FIXED**: Added pct value parsing (`parsePctValues`). The component now emits a `resolvePctChangeRequest` event with parsed values/gradation params. The store (which has access to `LocalBarReadService`) performs the actual resolution and pushes results back via the `targetDates` input.
3. **Pct values not parsed** — `target-type-selector.component.ts:317,350-352` (Thermo-nuclear). **FIXED**: Added `parsePctValues()` method that splits, trims, filters empty strings, and validates finite numbers.

### Major
4. **Manual user-dates mode had no UI** — `target-type-selector.component.ts:134-188` (Spec + Thermo-nuclear). **FIXED**: Added manual date input + Add button with `addManualDate()` method.
5. **Tests were shallow, tested internal state** — `target-type-selector.component.spec.ts` (Thermo-nuclear). **FIXED**: Rewrote tests to assert emitted output values (`targetTypeChange`, `targetDatesChange`, `resolvePctChangeRequest`) rather than internal signals. Added edge-case tests for empty inputs.

### Minor
6. **Duplicate `data-testid` on segmented buttons** — `target-type-selector.component.ts:33` (Standards + Thermo-nuclear). **FIXED**: Made test IDs unique per button (`target-type-btn-pct-change`, `target-type-btn-swing-extremes`, `target-type-btn-user-dates`).
7. **`styles` as plain string instead of array** — `target-type-selector.component.ts:217` (Standards). **FIXED**: Changed to `styles: [...]` array form. Also flattened CSS nesting for JSDOM compatibility.
8. **Unused type imports in spec** — `target-type-selector.component.spec.ts:6` (Standards). **FIXED**: Removed unused `PctMode`, `UserDatesMode`, `PctDirection` imports.
9. **Missing input validation on numeric inputs** — `target-type-selector.component.ts:354-399` (Thermo-nuclear). **FIXED**: Added `> 0` guards on all numeric input handlers.

### Nit
10. **`targetDatesChange` output name vs internal signal** — `target-type-selector.component.ts:308,314` (Thermo-nuclear). Noted. The `targetDates` input uses a setter that mirrors to `_targetDates` signal; the template uses `targetDatesSignal()` for rendering. The naming is intentional for the two-way binding pattern.

## Design decisions

- **Pct-change resolution delegated to store**: The component emits `resolvePctChangeRequest` with parsed values. The store (which injects `LocalBarReadService`) calls `resolvePctChangeTargets` and pushes results back via the `targetDates` input. This keeps the component dumb and the store as the data orchestrator, matching the IMPL plan's note: "Either inject `LocalBarReadService` directly or receive bars as input."
- **Swing-extremes inputs rendered but disabled**: The IMPL plan requires count, deviation, depth, backstep inputs. They are rendered with `disabled` attribute alongside the "Coming soon" message, signaling the intended UI without enabling interaction until ZigZag integration is ready.
- **`@Input()` + setter pattern**: Used instead of `input()` signals because the repo's Jest setup doesn't recognize `input()` signals (documented in `stats-panel.component.ts`).

## Test results

- `target-type-selector.component.spec.ts`: 25/25 passed
- Angular production build: passed

## Verdict: PASS

All critical and major findings are fixed. The component now has proper `startDate`/`targetDates` inputs, real pct value parsing, manual date entry, disabled swing-extremes inputs, and tests that assert emitted output values. Minor issues (unique test IDs, styles array form, unused imports, input validation) are all fixed.
