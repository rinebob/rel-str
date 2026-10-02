**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Thread Slug:** core-infra  
**Issue:** #559  
**Task:** #568  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — #568 Strategy-builder governing-variant config

**Verdict: PASS** (3 axes × 4 rounds — ran until no new findings)

**Round 3 (fresh pass on round-2 fixes):**  
- **[MED] silent validation failure** — group-level `variantParam` error
  had no UI surface; save disabled with zero feedback → error div with
  per-error text + DOM/disabled-save spec.
- **[LOW] open-ended family list** — a registry type without
  `VARIANT_PARAM_META` would render no input while the validator still
  demanded a param → `variantFamilies()` filters to known metas (and
  `Record<VariantFamily,…>` forces a compile-time update when the union
  grows).
- **[LOW] spec blind spots** → added stale-param `none` round-trip test.

**Round 4:** `.validation-error` needed `flex-basis: 100%` inside  
`.form-row` (else it squeezed inline). Fixed. Residual accepted:
`param <= 0` reports `'required'` (message covers it); edit-mode param
clearing retains stored values (pre-existing `updateDoc` semantics).

## Summary

The strategy-builder form gains a **Governing Variant** section — a
family select (options derived from the exit-variant registry via
`listExitVariants`) + a per-family param input. On save the pair is
encoded into a `governingVariant` key on the instance doc
(`initial-stop-{pct}`, `trailing-{pct}`, `time-{d}d`, `limit-sd{σ}`) —
the same format the BE's `parseVariantKey` consumes, so arbitrary
per-instance params work with zero backend change. Edit mode parses the
stored key back into family+param; unparseable keys surface as `'none'`
(BE no-op parity).

Service/store widened via `InstanceInput` (`PaperStrategyInstance` minus
server-stamped fields, `governingVariant?` optional — service defaults
`'none'`).

## Spec compliance — all ACs met

- Path repoint: verified already done (`paper-trading/instances/items`).
- Variant **and** params selectable, saved on the instance doc.
- Options sourced from `listExitVariants` (registry-driven families).
- Spec coverage: family derivation, key encode (incl. `limit-sd2.5`),
  edit prefill, unparseable→none, param validators.

## Round 1 — findings → resolution

- **[PARTIAL AC] preset-only select couldn't set params** → replaced with
  family+param controls deriving registry-parseable keys.
- **[LOW] misplaced `generateInstanceId` import** → moved to top block.
- **[LOW] spec fixture cast** → `makeInstance() as PaperStrategyInstance`.
- **[LOW] adjacent write bug**: exit-policy params used `?? undefined` —
  Firestore rejects explicit undefined → conditional spreads.

## Round 2 — verified clean + 2 more fixes

- `variantParam` had no validators — `time-1.5d` would silently save a
  key the BE can't parse. → `variantParamValid` group validator
  (finite, >0, integer for time-stop); save disabled while invalid.
- Import ordering nit → consolidated.
- **Deferred (pre-existing):** clearing a param in edit mode now silently
  retains the stored value (conditional spreads omit the key rather than
  `deleteField()`); multi-policy prefill only reads `exitPolicies[0]`.
  Both pre-date this change — noted for a future task.
- **Deferred (design note):** BE doesn't yet consume
  `instance.governingVariant` when launching strategy trades — variant
  seeding is Phase-3 exit-engine work. The field is stored and ready.

## Test results

- Form spec: **17/17** (incl. 6 new variant tests).
- Focused strategy-builder suites: **81/81**.
- Full Jest: **2043/2043** (149 suites); `ng build` clean, zero warnings.
