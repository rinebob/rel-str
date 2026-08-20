**Topic:** Strategy Builder UI  
**Issue:** #137  
**Task:** #149 — FE: Strategy Builder create/edit form  
**Domain:** STRAT-BUILD-UI  
**Area:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-08-19  
**Last Updated:** 2026-08-19

## Summary

Three-axis review of Task #149 (Strategy Builder create/edit form) against the project coding standards, the PRD/implementation/test plans, and a thermo-nuclear quality pass. This review covers the new form dialog component, the ID generator update (openTimePT segment), the list component changes (dialog open, icon buttons, target delta column), and the store/service updates.

## Standards

### Findings by severity

**MAJOR (all resolved):**
1. ~~**Dead code — `toggleExitPolicy` method**~~ — **RESOLVED.** Removed. The template now uses `mat-select` with `onExitPoliciesChange()`.

2. ~~**Dead code — `policiesWithParams` Set**~~ — **RESOLVED.** Removed. The conditional field visibility uses `isPolicySelected()` directly.

3. ~~**Dead code — `.policy-chips` CSS**~~ — **RESOLVED.** Removed. The chip buttons no longer exist in the template.

**MINOR:**
4. **`finalize` import removed but `Subscription` retained** (`strategy-builder.store.ts`) — The `finalize` import was removed and replaced with inline `isLoading: false` in both `next` and `error` handlers. This is correct and cleaner, but the `Subscription` import is still present — verify it's still used.

### Smells (judgement calls)
- ~~**Primitive Obsession** — `openTimePT` is a plain string with no format validation.~~ **RESOLVED** — added `Validators.pattern` with HH:MM regex (`/^([01]\d|2[0-3]):[0-5]\d$/`). A dedicated `OpenTime` value object would be cleaner long-term, but the regex validator catches invalid input at the form layer.

## Spec

### Requirements met
- Standalone OnPush component with external template/styles ✓
- Spread type dropdown from `PositionSpreadType` enum ✓
- Symbol input with uppercase normalization ✓
- Frequency dropdown ✓
- Open time input with HH:MM format validation ✓
- Live ID preview (includes open time segment) ✓
- Target delta, DTE min, DTE max fields ✓
- DTE max > DTE min validation ✓
- Delta validation 0 < delta <= 1 ✓ (correct — backend uses `useAbsoluteDelta: true` with `Math.abs(signedDelta)`, so put deltas which are negative are handled by absolute value. The user enters the absolute delta.)
- Exit policy multi-select with conditional parameter fields ✓
- Exit policy compatibility validation (incompatible pairs rejected) ✓
- At least one exit policy required (defaults to HOLD_TO_EXPIRATION) ✓
- Trailing stop defaults to stop loss value ✓
- Save calls `store.create()` or `store.update()` ✓
- Edit mode pre-fills from selectedInstance ✓
- Form invalid → save button disabled ✓
- Component tests covering field rendering, validation, ID preview, edit pre-fill, exit policy compatibility, open time format ✓
- FE build passes ✓

### Requirements missing or partial
1. **Task #149 originally said "5-step Material Stepper form"** but the implementation is a single-screen dialog. The stepper was abandoned in favor of a compact dialog (documented in PRD line 155: "No stepper" and IMPL doc line 72: "Single compact form — no stepper"). Task #149's issue body has been updated to reflect the dialog design. **Not a violation.**

2. **"Add Phase" button for multi-phase** — Not implemented. The form only supports single-phase (one phase built from the flat delta/DTE fields). The PRD mentions wheel phases but the IMPL doc's form layout doesn't include an add-phase button. **Deferred** — acceptable for v1.

3. **Market regime dropdown** — Not implemented. PRD line 155 says "no market regime field in v1." **Correctly omitted.**

### Scope creep
None identified.

## Thermo-nuclear

### Findings by severity

**MAJOR (all resolved):**
1. ~~**Missing validation for `openTimePT` format**~~ — **RESOLVED.** Added `Validators.pattern(/^([01]\d|2[0-3]):[0-5]\d$/)` to the `openTimePT` form control. Invalid formats (e.g., "25:99" or "noon") are now rejected at the form layer.

2. ~~**No validation that at least one exit policy is selected**~~ — **RESOLVED.** Added `validateExitPolicies()` that rejects empty selection with "At least one exit policy is required." The default remains `HOLD_TO_EXPIRATION`. Also added incompatible pair validation: `HOLD_TO_EXPIRATION` conflicts with any active policy; `WHEEL_IF_ASSIGNED` conflicts with `HOLD_SHARES_IF_ASSIGNED`. Save button is disabled when validation fails.

**MINOR:**
3. **Form component complexity** (`strategy-builder-form.component.ts`) — Mixes form validation, ID preview, exit policy state, and config building. Approaching the 300-line target. Consider extracting exit policy logic if the form grows further. *(Not addressed — deferred.)*

4. ~~**Missing test: trailing stop defaults to stop loss**~~ — **RESOLVED.** Added two tests: one for initial defaulting, one for updating when stop loss changes after both are selected.

5. ~~**Missing test: open time in ID**~~ — **RESOLVED.** Added test verifying `-0730` appears in the ID preview when `openTimePT` is `07:30`.

### Architectural risk
Low. Clean separation: component → store → service → Firestore. No boundary violations or god objects. File sizes all under 300 lines. The main risk is form component complexity growing as features are added.

## Test results

All 86 tests pass across 5 test suites (up from 77 — 9 new tests added):
- `shared/strategy-instance-id.spec.ts` — 13 tests
- `strategy-builder.service.spec.ts` — tests pass
- `strategy-builder.store.spec.ts` — tests pass
- `strategy-builder.component.spec.ts` — tests pass
- `strategy-builder-form.component.spec.ts` — 32 tests (9 new: trailing stop update, 5 exit policy compatibility, open time format, open time in ID preview)

Note: jsdom CSS parse warnings on the form component's SCSS are benign (same pattern as other components in the codebase).

## Verdict

**PASS** — all major findings resolved.

- Dead code from the chip-to-dropdown refactor: removed.
- openTimePT format validation: added (HH:MM regex).
- Exit policy compatibility validation: added (incompatible pairs + at-least-one required).
- Missing tests: added (trailing stop default, open time in ID preview, exit policy compatibility, open time format).
- Delta validation confirmed correct: backend uses `useAbsoluteDelta: true` with `Math.abs()`, so the form's `0 < delta <= 1` on the absolute value is correct for both puts and calls.
