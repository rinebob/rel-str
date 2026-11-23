**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1490  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1505  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — #1505 FE Task: Replay run dialog — variant/template sections

## Pass sequence

```text
First pass complete — 1 major + 3 minors + nits across 3 axes, all converging on the customResult type boundary and dual enforcement
Second pass complete — remediated diff re-reviewed; all findings resolved or consciously deferred as nits; no new issues
Convergence: PASS — second pass clean
```

## Scope

- `components/options-replay-new-run-dialog/options-replay-new-run-dialog.component.{ts,html,scss,spec.ts}` — template picker replaced by two-section named/custom layout; builder nested via `DsDialogService`; request narrows to `{variantId, symbols, startDate}` or `{legs, variantName?, symbols, startDate}`.
- `utils/variant-builder.utils.ts` — `VariantLegsResult` interface extracted from the union member (in-gate remediation).
- `components/options-variant-builder-dialog/options-variant-builder-dialog.component.ts` — stale `submitLabel` doc comment corrected (in-gate remediation).

## Standards axis

- **Found:** dead `selectedVariantName()` (stale doc comment describing a mat-select trigger that no longer exists — the control is a native select); unreachable `customResult` `setErrors`/`field-error` path gated off by `canSubmit()` (dead UI); over-broad `customResult` control type.
- **Resolved in-gate:** all three.
- **Verified clean:** `DsDialogService.open` call matches the real signature; `markForCheck()` in `afterClosed` is the correct zoneless OnPush fix (result lands on a child-overlay `Subject` outside template events); dialog-local form state is proportionate (no store-convention violation); jest-30 spec conventions followed; contract baseline passes — the emitted payloads are exact union members and `templateId` is never emitted.

## Spec axis

All nine verified requirements **MET** with file:line evidence: two-section layout replaces the template picker; named → `{variantId, symbols, startDate}` (asserted no `legs`/`templateId`/`variantName`); custom → `{legs, variantName?, symbols, startDate}` (asserted no `variantId`/`templateId`); builder opened with `submitLabel:'Apply'` and both result shapes routed correctly; symbols/date controls byte-identical; multi-symbol single-request shape preserved through `backtest-dashboard.component.ts` → `optionsReplayStart`; submit gating correct.

- **Minor gap resolved in-gate:** spec now pins `variantName` omission when the builder returns no name, and that a direct `submit()` on uncomposed custom never emits the named form.

## Thermo-nuclear axis

- **Major (resolved):** `customResult` was typed as the full `VariantBuilderResult` union while only ever storing the legs member — forcing `'legs' in result` template checks, a dead `:0` fallback, a redundant re-guard in `submit()`, and a silent fall-through that would have emitted the named request form against the custom section if the invariant ever broke. Remediated by extracting `VariantLegsResult`, narrowing the control type, and restructuring `submit()` so the named close is unreachable on the custom path — branches deleted, not polished.
- **Minor (resolved):** the "custom needs a result" rule was enforced by two mechanisms (`canSubmit()` + imperative `setErrors`). Collapsed to the `canSubmit()` gate; the muted "No composition yet" summary communicates the missing piece.
- **Verified clean:** `markForCheck` is required and minimal; state placement is proportionate; file sizes healthy; specs test external behavior including union-shape key-absence assertions.

## Test results

- Focused suite: **20/20** (`options-replay-new-run-dialog.component.spec.ts`).
- Full suite: **6235/6235** green; `tsc --noEmit -p tsconfig.app.json` clean.

## Deferred nits (documented, not blocking)

- A stale `customResult` survives a named Apply and resurfaces if the user re-selects custom — retained as reasonable UX (composition persistence), undocumented.
- `variantId`'s `required` validator runs even on the custom path — only matters if `REPLAY_VARIANTS` were ever empty; curated registry.
- `CommonModule` import is likely unused under the new control-flow syntax — pre-existing, not introduced by this diff.

## Verdict

**PASS** — 1 major + 2 minors remediated in-gate; second pass clean.
