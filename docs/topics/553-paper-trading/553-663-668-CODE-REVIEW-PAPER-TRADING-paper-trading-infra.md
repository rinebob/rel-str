# Code Review — #668 BE terminal-family guard + governingVariant seeding

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Issue:** #663  
**Task:** #668  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

## Diff scope

| File | Change |
|---|---|
| `functions/src/paper-trading/exits/registry.ts` | `isTerminalVariantKey(key)` — parse + `TERMINAL_VARIANT_FAMILIES` membership |
| `functions/src/paper-trading/ledger.ts` | `seedVariantRuns` guards: governing must be terminal (no `'none'` — no legit caller); every seeded key must parse |
| `functions/src/paper-trading/engine/trade-adapter.ts` | `governingVariantForInstance(instance)` — stored `governingVariant` key wins when terminal; else warn + `trailing-8` |
| `functions/src/paper-trading/engine/position-repository.ts` | `createPosition` seeds the resolved key (instance already fetched once per call — the batched launch read) |
| `shared/paper-trading-contracts.ts` | `NONE_VARIANT_KEY`; honest `TERMINAL_VARIANT_FAMILIES` comment (product gate, not capability claim) |
| `shared/options-strategy-engine-contracts.ts` | `StrategyInstanceConfig.governingVariant?: string` — the paper-ledger extension field the FE already writes |
| `tests/functions/paper-trading/{exit-variants,ledger,trade-adapter}.test.ts` | 12 new cases: terminal predicate, governing rejections ×3 paths, `none` tolerance, resolver matrix |
| `553-652-{629-PRD,656-IMPL-be,656-TEST-be}` docs | 2026-09-29 execution-fidelity amendment; guard narrows to the shipped family constant |

## Round 1 — three axes

- **Standards: PASS** — clean seam (`seedVariantRuns` is the single seeding
  point for both entry paths), no cycles, honest typed fixtures.
- **Spec: PASS** — all ACs and TEST bullets met; no production caller seeds
  a non-terminal governing key.
- **Thermo: REQUEST CHANGES** — one critical, two majors, all addressed in
  round 2 below.

## Round 1 findings → round 2 resolutions

| Sev | Finding | Resolution |
|---|---|---|
| CRITICAL | `instance.governingVariant` (written by the Strategy Builder FE, declared on `PaperStrategyInstance`) was ignored; impl derived the key from `exitPolicies` instead — two sources of truth, stored key silently ignored | **Fixed** — `governingVariantForInstance` reads the stored key per the IMPL doc; `exitPolicies` derivation removed; `governingVariant?: string` added to `StrategyInstanceConfig` |
| MAJOR | `TERMINAL_VARIANT_FAMILIES` comment claimed time-stop/initial-stop "never close a position" — false; both have working triggers. The list is a product gate (US4), not a capability predicate | **Fixed** — contract comment rewritten to say so; name kept (shipped contract; rename churn not worth it) |
| MAJOR | Silent `trailing-8` fallback on bad config | **Fixed** — `logger.warn` on non-terminal/unparseable stored key; fallback remains correct-by-product (a launch must not crash the nightly pass on bad config) |
| MINOR | Guard throws inside `deps.transact` | Accepted — the guard is pure; the throw aborts the txn cleanly either way. Hoisting pre-txn saves a no-op attempt — cosmetic |
| MINOR | `createPendingTrade` guard untested; unparseable non-governing keys seeded dead runs | **Fixed** — added PENDING-path guard test; `seedVariantRuns` now also rejects unparseable `variantKeys` |
| NITs | `'none'` literal duplicated; import block split; narrowing cast | **Fixed** — `NONE_VARIANT_KEY` contract constant; imports merged; `as` cast removed |

## Round 3 — re-review after fixes

- **Spec FAIL → fixed:** TEST doc described the abandoned `exitPolicies`
  resolution — rewritten to `governingVariant`-field semantics; IMPL §4/§5
  wording corrected (product gate; warn+default for non-terminal stored
  keys).
- **Spec FAIL → fixed (US4):** the strategy-builder family select still
  offered `initial-stop`/`time-stop`/`none` — a stored `time-30d` would
  silently coerce to `trailing-8` at launch. The `'none'` mat-option was
  removed, `variantFamilies` now filters to `TERMINAL_VARIANT_FAMILIES`,
  default is `trailing-stop`/8, and edit-prefill coerces ineligible stored
  keys to the default. (Scope note: this is FE-IMPL §3 work nominally
  owned by #672 — landed early under this task because it was the spec
  violation; #672 should not re-implement it.)
- **Thermo HOLD → fixed:** both `'none'` carve-outs deleted from
  `seedVariantRuns` — no legit caller exists (legacy docs are written by
  `positionToTrade` directly), and the exemption was internally incoherent
  with the dead-run rationale.
- `typeof` guard on stored `governingVariant`; degenerate-pct rejection
  (`trailing-0`, `trailing-100+`); warn-path + non-string tests; mojibake
  repaired in `ledger.test.ts` and `expression-fill-pass.ts`.

## Round 4 — convergence pass

- **Shared predicate** `isGoverningEligiblePct(fraction)` added to
  `paper-trading-contracts` — consumed by `isTerminalVariantKey`, the FE
  `variantParamValid`, and prefill eligibility so BE/FE can't drift.
- `isTerminalVariantKey` keys the pct bound off `'stopPct' in def.params`
  — a non-pct terminal family added later is governed by membership alone.
- FE validator distinguishes `range` (out-of-bounds) from `required`;
  `[max]` bound on the param input; `meta.max` added.
- Fixed stale claims: USER-GUIDE "not yet consumed" → updated; FE-IMPL §3
  / SHARED §4 / FE-TEST rewritten to coerce-to-default semantics;
  `positionToPaper` typo → `positionToTrade`.
- Tests added: `isGoverningEligiblePct` fraction bound, `trailing-0`/
  `trailing-150` seed rejections, FE `range` error, stored-key coercion
  `it.each`, warn count, non-string governingVariant.

## Accepted trade-offs (documented, not blockers)

- Editing an instance with an ineligible stored key overwrites it with
  `trailing-8` on save (BE coerces per-launch with a warn and preserves
  the stored key; the FE normalizes at edit time). Chosen for
  US4 consistency — the select can't represent the old value.
- `governingVariantForInstance` falls back rather than throwing — a bad
  stored key must not crash the nightly open pass; the warn is the audit
  trail.

## Deferred (documented, not blockers)

- `trailingStopPct` / governing-key validation at the instance *write*
  boundary (strategy-builder service + `isValidInstance`) — real, but the
  launch resolver now defaults+warns, so bad config can't crash the pass.
  Follow-up to the strategy-builder thread.
- Migration/verify scripts writing `governingVariant: 'none'` on instance
  docs — vestigial but harmless; launches default past it.

## Test results

- Functions suite: **673/673** pass (`npx tsx --test`, all
  tests/functions).
- FE specs: strategy-builder + contracts **69/69**; full-jest spot checks
  green.
- `npm run build` clean.

## Verdict: PASS (4 rounds to convergence)

Round 4 reported CONVERGED — no critical/major findings. The critical
divergence is resolved — the seeded governing run now matches the key the
Strategy Builder wrote (or warns + defaults), the product-gate semantics
are documented honestly, every seeded key is provably parseable, and BE/FE
share one eligibility predicate.
