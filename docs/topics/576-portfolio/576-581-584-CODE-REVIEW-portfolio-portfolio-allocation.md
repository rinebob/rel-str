**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread Parent:** #577  
**Issue:** #581  
**Task:** #584  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# Code Review — #584 SHARED: Allocation rollup utils

**Verdict: PASS** (one review round; medium-severity findings remediated and re-verified, lows fixed, deferrals documented)

## Scope

`shared/portfolio-allocation-utils.ts` (new), `shared/portfolio-allocation-utils.spec.ts` (new, 32 specs), `shared/portfolio-allocation-contracts.ts` (additive: `BucketStats.netValue`), IMPL doc synced. Pure functions over normalized domain inputs — zero MCP/Firestore coupling; service-layer mapping is #586.

## Spec compliance

Every IMPL §3 util exists with matching semantics; every TEST-doc unit target and edge case is covered by a spec (worked literals, non-tautological). Domain assumptions verified: signed-lot FIFO correct for long-close and short-cover; `closedCount` = traded-now-flat instruments; Unassigned = absent attribution doc; #586 `BrokerOrder` legs/executions dependency recorded.

## Findings and remediation

### Medium — remediated

1. **Unflagged sells open phantom short lots** (thermo F1) — `positionEffect: undefined` treated a truncated-history sell as sell-to-open, fabricating a short lot that corrupts later matches. **Fix:** explicit documented contract — omitted flag = open-capable, and the service layer is required (IMPL §4) to populate `close` when it can infer it (option `position_effect`; equity sells bounded by `sharesHeldForSells`). Spec now pins the documented fallback explicitly.
2. **`cashExposure` broke the buckets+Cash=account-value identity under shorts** (thermo F2) — gross exposure double-counts short liabilities against the residual. **Fix:** `BucketStats` gains `netValue` (signed Σ marketValue — the reconciliation field; `exposure` stays gross for drift/targets); `cashExposure` now takes the account's full position set and returns the signed residual, so buckets(net) + Unassigned + Cash = account value exactly, shorts included. Specs pin both behaviors.
3. **`wouldExceedTarget` failed open on NaN** (thermo F5) — a guardrail that can't compute must warn. Now returns `true` on non-finite inputs; spec'd.

### Low — remediated

- Positions never validated → `isWellFormedPosition` guard; malformed positions skipped instead of NaN-ing the rollup (spec'd).
- `filledAt` only length-checked → `Date.parse` validation; day-bucketing + fill sort normalized via `toISOString`/`Date.parse` (non-ISO timestamps can't corrupt ordering).
- Curve endpoint could emit a backwards-dated point (stale `asOf`) → clamps/merges; invalid `asOf` handled.
- "merge-sort" comment misdescribed the algorithm → corrected; `hasAnyFill` aligned to `isWellFormed`; dead `?? 0` removed.
- Duplicate-attribution last-write-wins assumption documented at the seam.
- Spec gaps: negative account value, out-of-order fills (pins the sort), never-traded instrument counted nowhere, garbage timestamps.

### Accepted (documented deferrals)

- Omitted-`positionEffect` sells remain a fidelity bound when the service can't infer effect — the contract states it, service carries the duty.
- Lot multiplier wins on mismatch (cost-basis convention) — documented.
- `closedCount` under-counts instruments closed before the history window — inherent to order-history depth (IMPL risk already documented).

## Test results

- `npx jest` full suite: **1939/1939**, 142 suites.
- Focused: `npx jest shared/portfolio-allocation` → **53/53** (32 new util specs).
- No verification scripts apply — pure functions, no pipeline/prod surface.
