**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Issue:** #612  
**Task:** #586  
**Topic Parent:** #576  
**Status:** Complete  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# UAT — Task #586: FE Allocation Services

Service-layer task — no user-facing UI (the Allocation Manager page/components come in later tasks). Verification is unit-spec + prod round-trip evidence.

## Prerequisites

- Repo deps installed (`npm ci`); jest suite runnable.
- ADC for the prod round-trip: `gcloud auth application-default login`.
- Prod verify command: `NODE_PATH=functions/node_modules npx tsx scripts/verify/portfolio-allocation-586-roundtrip.ts`

## Scenarios & results

| # | Scenario | Evidence | Result |
|---|----------|----------|--------|
| 1 | Bucket CRUD — create with composite id `{acct}_{slug}` | `allocation-bucket.service.spec.ts` "createBucket$ writes the composite-id doc" + verify script check 1 | PASS |
| 2 | Create conflict — occupied slug id throws | spec "createBucket$ throws a name-conflict" (slug-alias `CSP:Wheel`) | PASS |
| 3 | Rename — `name` only, id frozen; conflict probe uses stored accountNumber | specs "renameBucket$ updates name only" / "rejects … occupied" | PASS |
| 4 | Retire — `status=RETIRED`, doc preserved | spec "retireBucket$ flips status" + verify script check 3 | PASS |
| 5 | `targetPct` NaN/Infinity rejected on create+update | `Number.isFinite` guards in `allocation-bucket.service.ts` | PASS |
| 6 | Assign writes `fromBucketId: null`; move appends from→to | attribution specs "assign…null" / "move…from→to" + verify script checks 4–5 | PASS |
| 7 | linkKey group move — atomic fan-out, all reads before writes | spec "moves every linkKey sibling atomically" incl. `invocationCallOrder` ordering assertion | PASS |
| 8 | Unlinked leg joins group via `linkKey` param; same-bucket docs get stamped | specs "linkKey param joins…" / "stamps linkKey on a doc already at the target" | PASS |
| 9 | Cross-account / retired / missing bucket rejection | specs "different account" / "RETIRED" / "nonexistent" | PASS |
| 10 | Unassign → doc deleted → Unassigned; group-aware | spec "unassign$ deletes the doc — and every linkKey sibling" + verify check 8 | PASS |
| 11 | seedFromTicket$ — exactly-one ACTIVE slug match seeds; 0/>1/exists → null | 4 seed specs incl. retry-safe `wrote` flag | PASS |
| 12 | All accounts incl. non-agentic surfaced | data spec "listAccounts returns every account" | PASS |
| 13 | Fills: legs×executions expansion, ×100 options, equity sell→close inference, malformed-exec fallback | `allocation-mappers.spec.ts` 12 cases + client legs spec | PASS |
| 14 | Prod data contract — paths, fields, composite indexes live | `portfolio-allocation-586-roundtrip.ts`: **9/9 PASS** against prod | PASS |

## Traceability

- AC "bucket CRUD composite ids scoped to account" → S1–S4
- AC "assign fromBucketId null / move from→to" → S6–S8
- AC "all accounts + non-agentic flag" → S12
- AC "stubbed unit tests" → specs (mocked @angular/fire boundary)

## Refinement pass

Not applicable — no user-facing surface (services only; UI arrives in #587+).

## Regression / smoke

Full suite `npx jest`: **2005/2005 pass, 146 suites** — no regressions in robinhood-mcp client (legs/executions additive), portfolio-dashboard, or shared specs.
