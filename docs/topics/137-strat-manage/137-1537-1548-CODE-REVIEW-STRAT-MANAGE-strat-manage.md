**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1537  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1548  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1548 FE: Create New Strategy dialog + Export-to-JSON

**Verdict: PASS**

Three axes ran in parallel over the uncommitted diff (new dialog +
export dialog + page wiring, all under
`src/app/features/savant-trader/pages/strategy-manage/`). One critical
defect, three majors, and a batch of minors were fixed in-cycle before
this verdict; remaining items are dispositioned below.

## Standards

- Contract checks all pass: `DsDialogService.open(c,{data})` /
  `DS_DIALOG_DATA` / `DsDialogRef.close(result?)` match
  `src/app/shared/ds/ds-dialog.ts`; `VariantLeg` construction matches
  `shared/options-replay-contracts.ts`; catalog-id grammar matches the
  `MANAGE_VARIANTS` seeds; `addSessionVariant` dedupes by id.
- Judgement calls raised: `previewVariant`/`previewVariantRaw`
  duplication (fixed — single unconditional `draftVariant` computed,
  `previewVariant` is a thin formError-gated wrapper);
  `LegInput.delta: string` vs `type=number` ngModel emitting
  `number|null` (fixed — `setLegInput` normalizes `value ?? ''` →
  `String(value)`); missing page-spec coverage for the new button
  (fixed); `legs.indexOf(p.slot)` → positional `i+1` (fixed).
- Nits accepted: `inject(DS_DIALOG_DATA) as ExportJsonData` cast
  (existing token is `InjectionToken<any>` — precedent), untyped
  `DsDialogRef` (matches sibling).

## Spec

- All three ACs met: template picker renders per-leg Δ+DTE inputs from
  the template's leg slots (stock slots read-only); suggested editable
  name (`{template-name} {Δs} {dte}` convention, stops tracking after
  user edit); Save → `store.addSessionVariant` only — no Firestore
  write; Export opens `ManageExportJsonComponent` with the exact
  `MANAGE_VARIANTS` entry shape.
- Beyond-spec but justified: catalog-recipe id rejection (without it
  `store.variants` silently drops a session variant colliding with a
  catalog id); uniform-DTE rejection (`ManageVariant.dte` contract —
  multi-expiry variants cannot instantiate); variant-id preview line.
- Template-band non-enforcement is intentional per
  `manage-variant-catalog.ts` (bands are authoring policy, ad hoc
  variants may exceed).
- TEST-doc unit targets for the create-strategy dialog all covered.

## Thermo-nuclear

- **Critical (fixed):** `input[type=number]` + `ngModel` emits
  `number|null` via `NumberValueAccessor` — `deltaRaw.trim()` threw on
  the first keystroke in a real browser; every spec had bypassed the
  DOM. Fixed by normalizing in `setLegInput` + a new DOM-driven spec
  (`dispatchEvent('input')` on all four leg inputs, then clearing one →
  asserts no crash, normalized state, and the required error).
- **Major (fixed):** duplicated variant-build collapsed into
  `draftVariant`; whole-percent Δ validation added (rejects >2-decimal
  Δ the `round(|Δ|·100)` ID grammar can't distinguish); specs now
  exercise the real DOM seam.
- **Minor (fixed):** Δ sign parity by slot `type` (calls positive, puts
  negative — the dialog is a request boundary per the OptionLeg doc);
  error ordering (catalog-recipe collision precedes name-dup); zero-
  option-leg guard; clipboard `try/catch` → `Copy failed` label.
- **Accepted:** session same-id replace-by-recipe is documented store
  semantics; with 2-decimal Δ enforced, distinct recipes can no longer
  alias one id. `MANAGE_TEMPLATES[0]` on an empty registry is a
  hypothetical edge.

## Pass protocol

- First pass complete — 1 critical (number-input crash), 3 majors
  (duplication, Δ precision, DOM-untested seam), ~8 minors/nits across
  the three axes
- Second pass complete — all critical/major findings fixed and
  re-verified against the diff; axes' union covers the change; no new
  findings
- Convergence: PASS — no further passes needed

## Test results

- `npx jest src/app/features/savant-trader/pages/strategy-manage
  --coverage=false` — 4 suites, 64 tests green (includes new
  DOM-driven number-input test and page button test).
- Full suite `npx jest --coverage=false` — 5975 tests pass; 1 failing
  suite (`portfolio-dashboard.component.spec.ts`) is foreign in-flight
  work in the same working tree (`EquityPositionWithPnL` import removed
  by an unrelated uncommitted edit) — outside this change set.
- Dev `ng build --configuration development` — clean.
