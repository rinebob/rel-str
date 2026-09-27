**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Issue:** #582  
**Task:** #586  
**Topic Parent:** #576  
**Status:** Final  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# Code Review — Task #586: FE Allocation Services

Verdict: **PASS** (after remediation — one critical + five major findings fixed in-session).

## Scope

- `RobinhoodMcpClient`: `BrokerOrder` + `legs[]`/`executions[]`, `parseLegs`/`parseExecutions`.
- `allocation-mappers.ts` — MCP→domain inputs (positions keyed symbol/UUID + ×100; orders→fills via legs×executions; equity sell→close inference).
- `allocation-bucket.service.ts` — CRUD on `portfolio/buckets/items`, txn-guarded slug uniqueness.
- `position-attribution.service.ts` — `attribute$`/`unassign$`/`seedFromTicket$`, linkKey atomic groups.
- `allocation-data.service.ts` — MCP assembly (all accounts, snapshot, positions, fills).
- Specs ×4 + `tsconfig`/`jest.config` `@portfolio-allocation/*` aliases; IMPL/PRD sync.

## Axis results

| Axis | Findings | Notes |
|------|----------|-------|
| Standards | 1 major, 8 minor | Repo pattern faithful (AngularFire + `requireUserId` + `runInInjectionContext`); `userId` stamped on every write |
| Spec (PRD #578 + IMPL) | 1 critical, 6 minor | All 4 ACs MET after remediation; ACs traced to spec cases |
| Thermo-nuclear | 2 major, 9 minor | Seam depth right; observable teardown correct; error taxonomy clean |

## Critical findings (fixed)

1. **`attribute$` interleaved `txn.get`/`txn.set` per member** — Firestore txns require all reads before all writes; every linkKey group move would have thrown in production (mocked txn couldn't catch it). Fixed: two-pass structure — all member `txn.get`s, then all `txn.set`s. Spec now asserts get-before-set ordering via `invocationCallOrder`.

## Major findings (fixed)

2. **`seedFromTicket$` fabricated a `PositionAttribution`** — returned `{id, bucketId} as PositionAttribution` and claimed a seed even when the txn early-returned (doc existed). Now returns the fully-constructed doc only when actually written (`wrote` flag), `null` otherwise.
3. **Cross-account bucket targets accepted** — `attribute$` now rejects `toBucketId` whose doc's `accountNumber` differs from the call's.
4. **Unseeded legs could never join a group** — `attribute$` accepts an optional `linkKey` param; an existing doc's `linkKey` still wins.
5. **`seedFromTicket$` bucket status staleness** — txn now re-reads the bucket doc and aborts if retired/removed between match and write.
6. **`renameBucket$` conflict probe trusted caller-supplied `accountNumber`** — now derived from the stored doc inside the txn.

## Minor findings (fixed inline / documented)

- Malformed execution in a list → falls back to the order-level fill rather than emitting a subset (silent under-report fixed).
- Dead imports removed; `instrumentId` reconstruction simplified to the in-scope param; `bucketSlug` per-bucket throw documented as defensive (corrupt name impossible via validated writes).
- Group-membership read stays outside the txn — documented single-user race bound; per-member state re-read inside the txn.
- `inferEquityEffect` heuristic documented: compares historical sells to *current* holdings (truncated-history safe; misclassification recoverable via post-hoc attribution).
- "Never split" prose in service + contract clarified: the atomic unit is legs *carrying* a linkKey.

## Deferred / accepted

- `unassign$` deletes the doc (Unassigned = absent doc per contract); history inside the doc is discarded — IMPL sanctions this; contracts note added.
- Non-blocking: unauthenticated/negative-path spec gaps, `targetPct` NaN guard, equity-curve UTC bucketing note, query-block duplication across the two Firestore services (repo-consistent).

## Tests

`npx jest` — **2005/2005 pass**, 146 suites. New: 12 mapper + 12 bucket + 15 attribution + 5 data-service + 2 client legs/executions cases.

---

## Second review pass (same day — user requested clean review)

All three axes re-ran on the remediated state. **Spec: clean** (every prior fix verified, all ACs met). Standards/Thermo found residual LOW findings — all remediated in-session:

- `attribute$` same-bucket skip no longer bypasses `linkKey` stamping — a doc already at target but unlinked now records an identity event and joins the group (specs added for both stamp and pure no-op paths).
- `seedFromTicket$` `wrote` flag resets per txn-callback invocation — a retried attempt can no longer report a phantom write.
- `readAttributions`/`readBuckets` carry the snapshot id (`{...d.data(), id: d.id}`) — path is truth, not the stored `id` field.
- Equity execution fills with no usable timestamp are skipped instead of emitting `filledAt: ''`.
- `bucketSlug(b.name)` inside the seed filter is guarded — a corrupt stored name degrades to non-match instead of throwing.
- `targetPct` gains a `Number.isFinite` guard on create + update (NaN would otherwise poison rollups).

Accepted/documented (no code change): group-membership pre-txn read (single-user race bound; per-member docs re-read in txn); UTC day-bucketing on equity curves (documented approximation); query-block duplication across services (repo-consistent).

Final suite: **2005/2005 pass** — no outstanding findings.
