**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1490  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1504  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — FE Task: Variant builder dialog (#1504)

## Verdict

**PASS** — r1 surfaced 2 majors and ~7 minors across the three axes; all
majors and all worthwhile minors remediated in-cycle and re-verified
(30/30 focused specs, 214/214 backtest surface, tsc clean). Spec axis
MET on all four acceptance criteria.

## Change summary

Shared variant-builder dialog per FE IMPL §4 — the composition surface
that named-variant, base-template, and from-scratch modes all funnel
through to concrete `VariantLeg[]`:

- `utils/variant-builder.utils.ts` — pure helpers: `deltaOptionsForBand`
  (grid magnitudes ∩ `[min,max]` band), `signedTargetDelta` (PUT→−,
  CALL→+), `defaultDeltaForBand`, `defaultDialedForShape`,
  `composeShapeLegs` / `composeScratchLegs`, `variantToJsonBlock`,
  `MAX_VARIANT_LEGS = 8` (mirrors the request boundary at
  `functions/src/options-replay/start.ts:204`).
- `stores/variant-builder.store.ts` — dialog-scoped `VariantBuilderStore`
  SignalStore: mode/variantId/shapeId/dialed/scratchLegs/variantName/
  exportId state + computed `shapeLegControls` (band-bounded pickers;
  stock rows fixed), `composedLegs`, `legErrors` (via shared
  `validateVariantLegs`), `canSubmit`, `submitResult` (`{variantId}` for
  named; `{legs, variantName?}` for shape/scratch), `exportJson` (gated
  on `legErrors` + free registry id).
- `components/options-variant-builder-dialog/` — dumb view over the
  store; `submitLabel` via `DS_DIALOG_DATA` (Run/Apply per destination).
- Intentionally un-wired: entry points belong to #1505/#1506.

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| Named variant mode | MET | `submitResult()` → `{ variantId }` when `mode === 'named'` (`variant-builder.store.ts`); preview shows registry legs read-only |
| Base-template mode with band-bounded pickers | MET | `shapeLegControls` derives per-leg `deltaOptions`/`dteOptions` from the shape's `deltaBand`/`dteBand`; stock rows render fixed with no pickers |
| From-scratch mode + live preview | MET | `scratchLegs` rows (type/side/delta/dte selects on the full grid), `composedLegs` recomputed per signal; preview renders every composed leg |
| Copy JSON → paste-ready `ReplayVariant` | MET | `exportJson` emits a registry-block object validated by `validateVariantLegs` round-trip in specs; gated on `legErrors` + non-reserved/non-colliding id |

## Findings (r1 → disposition)

**Majors — remediated in-cycle:**

1. **Dialog-width contract breach** — `:host { min-width: 560px }` vs
   the DS dialog pane contract (~480px max, hidden overflow) → clipped
   controls for any caller opening with defaults (Standards M1). →
   Fixed: host `width: 440px`; scratch row selects `flex: 0 1 auto;
   min-width: 0; max-width: 84px` so a 5-select + remove row fits.
   Comment documents the 480px contract so future editors don't regress
   it.
2. **Scratch mode could exceed the 8-leg request boundary** —
   `optionsReplayStart` rejects `legs.length > 8` with
   `invalid-argument`; the UI had no cap — the only normal-click path to
   a server rejection (Thermo F1). → Fixed: `MAX_VARIANT_LEGS = 8` in
   utils, `addScratchLeg` no-ops at the cap, Add-leg button
   `[disabled]` at 8. Pinned by spec (10 attempted adds → 8 rows,
   `canSubmit` false via validator).

**Minors — remediated in-cycle:**

- `variantName` unbounded vs server's 200-char limit → `maxlength="200"`.
- Copy JSON could emit a duplicate-leg composition that fails registry
  validation → `exportJson` returns `''` when `legErrors` non-empty.
- Export id could be `custom` (reserved sentinel) or collide with an
  existing registry id → gated in `exportJson`; both paths spec-pinned.
- `legErrors` path had no direct spec → duplicate-scratch spec asserts
  errors surface, `canSubmit` false, `dialogRef.close` never called.
- `variantName` field visible in named mode where it's submit-inert →
  `@if (store.mode() !== 'named')`.
- `ShapeLegControl.type`/`side` loose `string` → `OptionType | null` /
  `TradeSide`.
- Dead no-op `.replace('0.', '0.')` → removed (kept the `−` minus-glyph
  replace which is live).
- Clipboard call could throw in non-secure contexts → optional chaining;
  spec now stubs via `defineProperty` + `try/finally` restore.
- Empty `imports: []` + `CommonModule` import → removed; template is
  pure control-flow/DS classes.
- Module-level `initialState` mutable-looking → immutability comment;
  `patchState` never mutates it in place.

**Nits — judged, no change:**

- `.field-error` marker class has no stylesheet rule — kept: semantic
  hook the template binds `[class.field-error]` to; DS-field siblings
  use the same unstyled-marker convention for error state.
- Multi-mode dialog ~270 lines of template — kept: single cohesive
  surface per IMPL §4; splitting into three mode components adds indirection
  without a reuse consumer yet.

## Test results

- `variant-builder.utils.spec.ts`: **11/11**
- `options-variant-builder-dialog.component.spec.ts`: **19/19**
  (incl. 3 new pinning specs: dup-leg legErrors, 8-leg cap, export gating)
- Backtest feature surface: **214/214** (16 suites)
- `tsc -p tsconfig.app.json --noEmit`: clean

## Pass protocol

```text
First pass complete — 3 axes in parallel: Spec PASS (all 4 ACs MET);
Standards 1 major (dialog width) + minors/nits; Thermo 1 major (8-leg
server boundary) + validation gaps
Second pass complete — both majors fixed + test-pinned; all worthwhile
minors remediated; 30/30 focused, 214/214 backtest surface, tsc clean
Convergence: PASS — no remaining criticals/majors
```
