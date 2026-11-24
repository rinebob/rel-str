**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1720  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1710  
**Domain:** SHARED  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT: #1710 — shared netMark + uniform P&L + selection contract

## Scope

The shared lifecycle-math contract the BE passes and FE dashboard consume:
`shared/options-position-math.ts` — signed `netMarkValue` (liquidation
space), `entryNetMark` / `signedEntryPremium`, one-formula `unrealizedPnl`,
and the `hasOptionLegs` / `isOpenOptionPosition` selection predicate.

## Prerequisites

- Repo checkout on `prod` with the uncommitted #1710 files present
  (`shared/options-position-math.ts`, `shared/options-position-math.spec.ts`).
- `npx jest` and `npx tsx` on PATH (dev dependencies).
- No server, credentials, or Firestore needed — the module is pure.

## Getting to the feature

There is no UI surface. The contract lives at
`shared/options-position-math.ts`; consumers will be the BE passes (#1712+)
and the FE dashboard (#1716+). All verification is command-line:

```powershell
npx jest shared/options-position-math.spec.ts --coverage=false
npx tsx .devin/tmp/qa-1710-eval.ts   # live-eval script (see S2)
```

## Automated evidence

- `npx jest shared/options-position-math.spec.ts --coverage=false`
  → **28/28 passed** (2026-11-23).
- `npx jest shared/ --coverage=false` → **57 suites / 1195 tests passed**
  (worker-teardown warning is pre-existing, unrelated).

## Scenarios

### S1 — posture matrix via the spec suite

- Feature: signed netMark + uniform P&L across every spread posture.
- Steps: run `npx jest shared/options-position-math.spec.ts --coverage=false`.
- Expected: 28 tests green covering CCS, PCS, CDS, PDS, naked strangle,
  iron condor, multiplier×qty, zero-mark, missing-mark, and both
  predicates.
- Result: **PASS** — 28/28.

### S2 — live eval of the exported helpers

- Feature: the helpers produce the documented values when called for real.
- Steps: run a tsx eval importing `shared/options-position-math.ts`
  (`.devin/tmp/qa-1710-eval.ts`, `-eval2.ts`):
- Expected/observed output:

```
CCS entryNetMark: -300 | signedEntry: 300          ← credit = cash in, liability
CCS netMark now: -100 | uPnl: 200                  ← C − V profit
CDS signedEntry: -200 | netMark now: 300 | uPnl: 100 ← debit = cash paid, asset
missing mark -> undefined                           ← never fabricates
option legs: true | stock legs: false
open option: true | pending: false | expired: false | open stock: false
```

- Result: **PASS** — output matches the contract exactly (verified above).

### S3 — regression: the whole shared suite

- Steps: `npx jest shared/ --coverage=false`.
- Expected: all suites green, no shared-module breakage.
- Result: **PASS** — 57/57 suites, 1195/1195 tests.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. Refinement was limited to API
ergonomics (checked in review: `undefined` propagation keeps the
unpriceable decision at the caller's boundary).

## Findings

None.

## Traceability

| Acceptance criterion | Evidence |
|---|---|
| netMark + unrealizedPnl consolidated, one formula, no posture branching | S1 `netMarkValue`/`unrealizedPnl` describes; S2 live eval |
| signedEntryPremium pinned (credit + / debit −) | S1 `entryNetMark / signedEntryPremium` describe; S2 |
| hasOptionLegs spec-pinned (option in, stock out) | S1 `hasOptionLegs`/`isOpenOptionPosition` describes; S2 |
| posture matrix CCS/PCS/CDS/PDS + strangle | S1 — all postures + strangle + IC |

## Regression / smoke

- [x] `npx jest shared/` — 1195 green; no existing shared module affected
- [x] No imports added to `functions/` or `src/` — consumers land in later tasks

## Verdict

**PASS**

## Results log

- 2026-11-23 — S1/S2/S3 all PASS on first execution; QA #1720 → RESOLVED.
