**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signal Selection  
**Thread Slug:** signal-selection  
**Issue:** #1668  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1650  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1650 BE-IMPL: signal-review callables (queue + bundle)

## Scope

Two deployed `onCall` functions — `getSignalReviewQueue` +
`getSignalReviewBundle` — the pane-facing read surface for
signal-selection review. Queue: PRIMARY ∪ SECONDARY members with
`lastDailySignalDate`/`lastOpenedAt` merges. Bundle: daily `st-signals`
occurrences newest-first, joined to `source=SIGNAL` ledger trades via
`signalDedupeKey` (`checked`/`tradeId`/`tradeStatus`), plus the
read-then-stamp `lastOpenedAt` divider contract.

## Prerequisites

- Functions deployed: `firebase deploy --only functions` (done —
  both callables report `Successful update operation`, 2026-11-22).
- Authenticated-access evidence uses ADC (`GOOGLE_CLOUD_PROJECT=rel-str`)
  through the prod-deps path — the same code the callables run.
- Endpoint-level checks need no credentials: unauthenticated calls must 401.

## Getting to the feature

Backend surface — no UI until #1653 builds the review pane. Reach the
functions two ways:

```bash
# 1. Deployed endpoint (auth boundary — no credentials needed):
curl -sv -X POST https://us-central1-rel-str.cloudfunctions.net/getSignalReviewQueue \
  -H "Content-Type: application/json" -d '{"data":{}}'
# expect HTTP/1.1 401 Unauthorized

# 2. Behavioral path (prod deps + real Firestore via ADC):
cd functions
npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts --live
```

## Automated evidence

- `tests/functions/paper-trading/signal-review-callables.test.ts` — 19/19
- `npm run test:paper-trading` — 437/437
- `tsc -p functions/tsconfig.json` + `tsc -p tests/tsconfig.json` — clean
- `npm run build` — clean
- Verify — 14/14 DRY, 20/20 `--live`
- Jest — 6190/6190 (1 foreign mid-implementation suite failure, #1504)

## Scenarios

### S1 — Deployed endpoints reject unauthenticated calls

- **Feature:** auth boundary on both callables.
- **Steps:**

  ```bash
  curl -sv -X POST https://us-central1-rel-str.cloudfunctions.net/getSignalReviewQueue -H "Content-Type: application/json" -d '{"data":{}}'
  ```

  ```bash
  curl -sv -X POST https://us-central1-rel-str.cloudfunctions.net/getSignalReviewBundle -H "Content-Type: application/json" -d '{"data":{"symbol":"AAPL"}}'
  ```

- **Expected:** `HTTP/1.1 401 Unauthorized` on both.
- **Result:** PASS — 401 on both endpoints (deployed + enforcing).

### S2 — Queue resolves owner and returns real members

- **Feature:** `st-config/autoPaper.ownerUid` → PRIMARY ∪ SECONDARY union.
- **Steps:** the LIVE block reports `ownerUid resolves` + `queue returns real list members`.

  ```bash
  cd functions && npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts --live
  ```
- **Expected:** ownerUid non-null; ≥1 queue row with symbol + optional `lastDailySignalDate`/`lastOpenedAt` merges.
- **Result:** PASS — ownerUid resolved, real members returned.

### S3 — Bundle returns daily occurrences newest-first with the ledger join

- **Feature:** `st-signals` → `SignalReviewOccurrence` reshape + `signalDedupeKey` join.
- **Steps:** same LIVE run as S2 — `bundle for AAMI returned`, `occurrences are daily + newest-first`, `checked rows carry tradeId + tradeStatus`.

  ```bash
  cd functions && npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts --live
  ```
- **Expected:** all rows `signalTimeframe==='D'`; `signalBarDate` descending; every `checked:true` row has both `tradeId` and `tradeStatus`.
- **Result:** PASS.

### S4 — Read-then-stamp divider contract (live)

- **Feature:** `previousOpenedAt`/`openedAt` + `st-config/signalReview` write.
- **Steps:** call the bundle twice for the same symbol through prod deps
  (from the repo root):

  ```bash
  cd functions && cat > scripts/qa-divider-tmp.ts <<'EOF'
import { handleGetSignalReviewBundle, signalReviewProdDeps } from '../src/paper-trading/signal-review-callables';
const deps = signalReviewProdDeps();
const req = { auth: { uid: 'qa-1650' }, data: { symbol: 'AAMI' } };
const r1 = await handleGetSignalReviewBundle(req, deps);
console.log('visit1 previous:', r1.previousOpenedAt, 'opened:', r1.openedAt);
const r2 = await handleGetSignalReviewBundle(req, deps);
console.log('visit2 previous:', r2.previousOpenedAt, 'opened:', r2.openedAt);
console.log(r2.previousOpenedAt === r1.openedAt ? 'DIVIDER-OK' : 'DIVIDER-FAIL');
EOF
  ```

  ```bash
  npx tsx scripts/qa-divider-tmp.ts && rm scripts/qa-divider-tmp.ts
  ```
- **Expected:** visit2's `previousOpenedAt` equals visit1's `openedAt`; the stamp doc carries the latest `openedAt`.
- **Result:** PASS — visit1 opened `2026-11-22T08:04:34.978Z`; visit2 previous `2026-11-22T08:04:34.978Z` — `DIVIDER-OK`. Stamp confirmed on `st-config/signalReview` by the LIVE verify (`stamp landed`).

### S5 — Error mapping

- **Feature:** `unauthenticated` / `invalid-argument` / `failed-precondition` / `internal` codes.
- **Steps:** DRY verify + spec suite — empty/non-string symbol → `invalid-argument`; missing `ownerUid` → `failed-precondition`; stamp failure → `internal`; no auth → `unauthenticated`; deployed 401 (S1) covers the wire boundary.

  ```bash
  cd functions && npx tsx scripts/verify/paper-trading-signal-review-callables-1650.ts
  ```

  ```bash
  npm run test:paper-trading
  ```
- **Result:** PASS — all pins green (19/19 spec; DRY 14/14).

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. The review pane lands under
#1653; this task ships only the callables.

## Findings

None outstanding. In-gate review findings were fixed and re-verified
(CODE-REVIEW doc). The stamp-then-fail divider edge is deferred to
#1654 (triaged by the #1649 review); this task's stamp-last ordering
removes its contribution anyway.

## Traceability

| AC | Scenario |
|----|----------|
| Handlers + onCall + prod-deps + DI | S3, S4 (prod deps exercised) |
| Bundle: daily + newest-first + dedupe join + checked/tradeId/tradeStatus | S3 |
| Bundle: reshape, previousOpenedAt/openedAt, stamp-always, error codes | S4, S5 |
| Queue: ownerUid, PRIMARY∪SECONDARY, merges, unsignaled members, missing-owner failure | S2, S5 |
| index.ts exports + callable names | S1 (deployed endpoints live) |
| Specs + verify script + registrations | Automated evidence |

## Regression / smoke

- [x] `test:paper-trading` 437/437 — sibling callables unaffected
- [x] functions build clean
- [x] Full deploy completed (all functions updated)

## Verdict

**PASS** — all scenarios green with live evidence.

## Results log

- 2026-11-22 — S1–S5 executed against the deployed revision + real
  Firestore. Endpoint 401s verified by curl; LIVE verify 20/20; divider
  contract confirmed by a second live read (DIVIDER-OK).
- 2026-11-22 — user re-executed all manual scenarios: both curls 401
  `UNAUTHENTICATED`, LIVE verify 20/20, divider probe `DIVIDER-OK`
  (visit2 `previousOpenedAt` 2026-11-22T17:47:55.063Z == visit1
  `openedAt`).
