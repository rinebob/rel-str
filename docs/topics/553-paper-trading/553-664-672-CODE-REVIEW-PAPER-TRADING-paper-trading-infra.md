**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #664  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Task:** #672  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# Code Review — #672 FE: Strategy builder — trailing-only governing select, default 8%

**Verdict: PASS** — two rounds. Round 1 (three parallel axes —
Standards / Spec / Thermo-nuclear on the committed implementation,
`7f78fefb`, shipped early under #668 US4): 1 MAJOR (prefill≠validator
wedge) + convergent minors, remediated. Round 2 (same axes on the
remediated state): **1 MAJOR missed by round 1** — Angular's implicit
`min`/`max` attribute validators re-created the wedge invisibly —
plus the sub-1e-6 serialization hole and the orphaned registry
pipeline; all remediated and spec-pinned. Converged thereafter.

## Review surface — retroactive

Unlike a normal review, the implementation was already live ~3 weeks —
it landed early as `7f78fefb` during the #668 review (US4 finding: a
stored non-terminal key silently coercing to `trailing-8` was a
violation; the flag lives in a 2026-09-30 comment on #672). The diff
under review (`.devin/tmp/672-review.diff`, 308 lines) = committed
`7f78fefb` (3 files) + pending delta (spec pin + IMPL as-built).

## Axis results

### Standards — PASS, no critical/major (6 minors + nits)

- FE/BE grammar parity verified line-by-line: `parseVariantKey` regexes
  character-identical to BE `PATTERNS` (`registry.ts:37-54`); decimals
  round-trip (`trailing-8.5` ↔ `stopPct 0.085`).
- Prefill coercion mirrors `governingVariantForInstance`'s
  warn-and-default (`trade-adapter.ts:49-62`).
- Minors remediated (below); NITs accepted: file at ~390 lines (just
  over the 400 threshold — the variant-key block could extract to a
  sibling util, deferred), plain-method `variantParamMeta()` beside
  computed sibling, FE/BE grammar mirror remains duplicated
  (accepted since #568 — a shared `PATTERNS` table would make parity
  structural but return shapes differ).

### Spec — all ACs MET; coverage gaps closed

| AC | Verdict |
|---|---|
| AC1 `trailing-stop`-only select + legacy display | MET — select offers only `trailing-stop`; trade surfaces render stored keys raw (trades table `:164`, sortable Variant column, variant group-by dim, action dialog) |
| AC2 default 8 → `trailing-8`, decimals | MET — `variantParam: [8]` + decimal regexes + new `trailing-8.5` pin |
| AC3 non-terminal not selectable; legacy keys display | MET on trade surfaces; **accepted bound** — the instance list has no Variant column, so instance-level stored legacy keys are never displayed (on edit they coerce per TEST doc). AC wording ambiguous; TEST doc coercion governs |
| AC4 specs per TEST doc | MET after remediation — `trailing-150` added to the coercion `it.each`; create-mode `variantParam === 8` pinned; `parseVariantKey` non-string tolerance spec'd directly |

BE resolver parity confirmed for every specified case
(`time-30d`/`custom-legacy-key`/`none`/`trailing-150`/`trailing-0`/
non-string → `trailing-8` both sides).

### Thermo-nuclear — 1 MAJOR (fixed) + 1 MINOR (fixed)

**MAJOR — prefill/validator predicate mismatch wedged the edit dialog.**
Prefill accepted any `isGoverningEligiblePct` param `(0,100)`; the
validator additionally enforced the FE-invented
`VARIANT_PARAM_META` [1,99] bound. A stored `trailing-0.5`/`trailing-99.5`
— reachable because the pre-#672 form had no `[max]` and only
`param > 0` validation — prefilled into an unsaveable editor. **Fix:**
the shared contract bound is now the sole eligibility gate
(`isGoverningEligiblePct`), matching IMPL §3's literal spec; meta
min/max remains only as spinner hints. Regression spec pins stored
`trailing-0.5`/`trailing-99.5` → prefills *and* stays saveable.

**MINOR — empty/failed registry → blank select that still saves
`trailing-8`.** `variantFamilies()` iterated the loaded registry; a
load failure or pre-resolution window rendered zero options while the
default held. **Fix:** `variantFamilies()` now derives from
`VARIANT_PARAM_META` ∩ `TERMINAL_VARIANT_FAMILIES` — no registry
dependency; dead `PaperTradingStore` inject + `loadExitVariants` call
removed.

## Remediation round — what changed

| Finding | Fix |
|---|---|
| MAJOR prefill≠validator wedge | `variantParamValid` drops meta-bound; `isGoverningEligiblePct` sole gate; dead `integer` branch + template message removed |
| Registry-dependent select | `variantFamilies` derives from meta ∩ terminal families |
| Spec gaps (both axes) | `trailing-150` in coercion `it.each`; `trailing-0.5`/`trailing-99.5` wedge specs; `variantParam === 8` create-default pin; direct `parseVariantKey` spec (non-string → null) — earns the exports |
| `'none'` literals beside `NONE_VARIANT_KEY` | swapped at validator + `variantParamMeta` + `strategy-builder.service.ts:95` |
| Local `VariantFamily` duplicating shared export | imported from `@paper-trading/contracts`; local alias removed |
| Stale validator doc + fallback message | rewritten to describe the contract-bound gate |
| `(component as any)` ×2 in spec | `component['governingVariantKey']()` typed bracket access |
| Unguarded meta lookup | `family in VARIANT_PARAM_META` guard in `variantParamMeta()` |

## Accepted bounds

- **Silent coercion rewrite on edit+save** — stored non-terminal keys
  prefill as `trailing-8` and any save rewrites the doc. This is BE
  parity (the resolver warn-and-defaults those keys at seed anyway);
  the doc merely catches up. Documented, intended.
- **Instance-list has no Variant column** — instance-level legacy keys
  never display raw; trade surfaces do. AC3 satisfied on the surfaces
  that exist; flagged if a future read wants instance-level display.
- **405→~390-line file** — marginally over the 400 threshold before;
  remediation shrank it under. Variant-key block extraction remains an
  option, deferred.
- **`variantParamMeta()` plain method** in an OnPush template —
  reactive-forms `markForCheck` covers it; cosmetic.

## Verification

- Strategy-builder specs: **62/62** (58 prior + 4 new assertions)
- Service spec: 7/7
- tsc: clean on touched files (3 errors in `scripts/bulk-swing-sweep.ts`
  + `indicator-config-dialog.component.ts` belong to unrelated
  in-flight data-pipeline WIP — pre-existing, out of scope)
- `diff --check` clean

---

## Round 2 — converged after second remediation

All three axes re-ran on the remediated state at a real-defects bar.
Round 1's fixes verified landed; **one MAJOR surfaced that Round 1
missed**, plus a convergent tail.

### MAJOR — `[min]`/`[max]` attribute bindings are real Angular validators

`MinValidator`/`MaxValidator` ship in `ɵInternalFormsSharedModule` and
activate on `input[type=number][min][formControlName]` — the meta
`[min]="1"`/`[max]="99"` bindings re-installed the removed [1,99] bound
as **control-level** validators, invisible (the error div reads only
group errors) and undetected because the wedge specs asserted the
group-error channel. The R1 "sole eligibility gate" claim was wrong.

**Fix:** meta bounds for every family made contract-expressive
(`trailing-stop` → `min:0, max:100` — the inclusive attribute
validators can never reject a contract-eligible pct; degenerate
`0`/`100`/`150` still produce the *visible* group `'range'` message).
Wedge specs strengthened to assert `component.form.valid` — the real
save gate. The TEST doc's literal "[min]/[max] bound" requirement is
preserved (bindings kept; bounds contract-expressive).

### Round-2 remediations

| Finding | Fix |
|---|---|
| MAJOR attribute-validator wedge | contract-expressive meta bounds + `form.valid` wedge assertions |
| Sub-1e-6 params serialize `trailing-1e-7` (unparseable both sides) | serialize-then-re-parse round-trip guard in `variantParamValid` (`'range'`) |
| Orphaned registry pipeline — zero production consumers | deleted: `loadExitVariants`/`exitVariants`/`variantsSub` (store), `listExitVariants$` (service), dead spec blocks + form-spec mock scaffolding |
| `'trailing-stop'`/`8` literals beside `DEFAULT_TRAILING_STOP_KEY` | `DEFAULT_GOV = parseVariantKey(DEFAULT_TRAILING_STOP_KEY)!` derives form + prefill defaults |
| `computed` with zero signal deps | `variantFamilies` → plain readonly field |
| `in` operator prototype-chain lookup | `Object.hasOwn` |
| Stale "family from the registry" + "spinner hints" comments | corrected |
| Key-derivation spec never round-tripped | `parseVariantKey(key)` assertion added |

### Accepted bounds (round 2)

- `CallableName.LIST_EXIT_VARIANTS` enum member retained — name
  registry for the BE callable, which still exists server-side.
- Latent: FE applies `isGoverningEligiblePct` unconditionally; BE
  applies it only when params carry `stopPct` — diverges only if a
  non-pct family joins `TERMINAL_VARIANT_FAMILIES`. Documented.
- Non-terminal families' meta bounds (unreachable via select) left
  as hint data — patched-in families hit the group `'range'` gate.

### Round-2 verification

- Affected specs: **94/94** (strategy-builder 62 + store 30 + service —
  regrouped after deletions)
- `diff --check` clean

---

## Round 3 — converged

All three axes re-ran on the round-2 state. **No new defects.**

- **Thermo** verified the wedge fix end-to-end against Angular 21
  internals: `MinValidator`/`MaxValidator` are inclusive, so the
  `[0,100]` attribute bound strictly contains the contract `(0,100)`
  eligibility band — *eligible-but-rejected is impossible*, and
  out-of-contract values still produce the visible group `'range'`.
  The round-trip guard is airtight: `Number.isFinite` short-circuits
  all non-number params before it, and the guard boundary lands exactly
  at the serialization boundary (`1e-6` emits `'0.000001'` and parses;
  `1e-7` emits `'1e-7'` and fails `'range'`). `DEFAULT_GOV` fail-loud
  verified correct (contract constant parses; a `??` fallback would
  silently resurrect the deleted literals).
- **Spec** verified all four ACs remain MET post-R2, the wedge specs
  now assert the real save gate (`form.valid`), `makeInstance()`
  supplies a fully-valid form, and the pipeline deletion left zero
  references.
- **Standards** confirmed every R2 claim landed; compile-level sweep
  clean (no orphaned imports).

Round-3 nits remediated: stale store header comment (variants
deleted), stale spec section label, deletion-site blank lines, and a
new negative pin — `variantParam: 1e-7` → `'range'` — so the
round-trip guard can't silently regress. TEST doc clarified that the
`[min]`/`[max]` bounds are contract-expressive.

**Verification:** 95/95 affected specs green · `diff --check` clean.

## Issue state

- #672 → `7_QA` (advanced from `6_REVIEW` on remediation completion)
- QA issue: #1235 (created this gate)
