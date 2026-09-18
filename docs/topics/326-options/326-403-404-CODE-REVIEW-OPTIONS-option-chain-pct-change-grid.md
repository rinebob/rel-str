**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Contract chart popup  
**Thread Slug:** contract-chart-popup  
**Issue:** #403  
**Thread Parent:** #400  
**Topic Parent:** #326  
**Task:** #404  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-18  
**Last Updated:** 2026-09-18  

---

# Code Review — Task #404: Add extractContractSeries util

## Verdict: PASS (after fixes)

## Scope reviewed

- `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change.utils.ts`
  — added `ContractSeriesPoint`, `ContractSeriesIdentity`, `extractContractSeries`
- `src/app/features/savant-trader/pages/option-chain-pct-change/utils/pct-change.utils.spec.ts`
  — added 17 tests for `extractContractSeries`

## Standards axis

No hard violations. No `any`, no `as` assertions, no SDK calls, no dead
code; file stays under the 300-line guideline. Tests follow the existing
spec conventions exactly (shared `makeContract` factory, real
`OptionType` enum, `toEqual` on full objects, no mocks).

Judgement calls:

- **Duplicated logic across FE/BE boundary (pre-existing)** —
  `resolvePrice`/`normalizeType`/`toNum` mirror backend
  `av-eod-option-quote-provider.ts` logic with subtly divergent
  semantics (throw vs undefined; CALL-fallback vs undefined). Predates
  this diff; deepening reliance noted. Candidate for a shared-helper
  extraction follow-up.
- **`ContractSeriesIdentity` duplicates three `PctChangeCell` fields** —
  could be a `Pick`. Explicit interface kept for boundary clarity.

## Spec axis

All acceptance criteria from issue #404 are met:

- `extractContractSeries` returns `ContractSeriesPoint[]`
- Points chronological (start first, then sorted target date keys)
- Snapshots missing the contract are skipped
- Price uses mark → bid/ask midpoint → last fallback
- `delta: null` when missing/unparseable
- Empty array when contract in no snapshots
- Does not mutate inputs (strengthened to full JSON snapshot comparison)
- Tests cover all listed cases plus symbol mismatch, case-insensitive
  contractID, and duplicate-startDate edge

Spec-silent additions (justified, documented):

- Economic-identity fallback matching — needed because a cell's
  `contractID` can be the synthesized `contractKey` when AV omits
  `contractID`
- Skipping points with unresolvable price — consistent with grid
  behavior (`computePctChange` skips unpriced contracts)

## Thermo-nuclear axis

- **False positive (dismissed):** claimed spec file corruption at
  line 413 — verified clean; 206/206 tests pass.
- **Fixed — fallback identity omitted `symbol`:** docstring claimed
  "same identity the grid uses" but `contractKey` includes symbol.
  `symbol` added to `ContractSeriesIdentity` and the fallback predicate.
- **Fixed — duplicate start point:** `startDate` keys in
  `targetSnapshots` are now skipped.
- **Fixed — case-sensitive contractID match:** now normalized to
  uppercase, mirroring the backend provider's matching.
- **Noted — synthetic contractID (`key` fallback) compared against real
  IDs:** harmless today (OCC IDs can't collide with the
  `SYMBOL-EXP-STRIKE-TYPE` format); accepted design trade-off.
- **Noted — precedence gap:** if the contractID-matched contract has an
  unresolvable price, the identity match is not retried. Deliberate —
  a different instrument sharing economic identity shouldn't supply a
  price for this contract.
- **Minor — untested edges remaining:** duplicate contractID within one
  snapshot (`find` takes first), non-ISO date keys (lexicographic sort
  misorders). Accepted for now.

## Test results

- Pct-change suite: **206/206 pass** (was 203, +3 net new tests).
- Full suite: Angular app suites all pass. The `functions/` suites
  (107 failures) fail on a pre-existing `jwks-rsa`/firebase-admin
  module compile error unrelated to this change.

## Findings summary

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| Major | 3 | All fixed (symbol in identity, dup startDate, case-insensitive ID) |
| Minor | 3 | Documented, accepted |
| Nit | 2 | Documented |
