**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Screenshot Auto-capture with Orders  
**Thread Slug:** order-lifecycle-capture  
**Issue:** #883  
**Thread Parent:** #826  
**Topic Parent:** #746  
**Task:** #845  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — Lifecycle intake (`captureLifecycleEvent`) (#845)

## Scope

`functions/src/screenshot-capture/lifecycle-capture.ts` + the
`executeCaptureChart` extraction in `capture-chart.ts` +
`ST_SCREENSHOTS_COLLECTION` + the `st-screenshots` rules block.

No user-facing surface — refinement pass N/A.

## Scenarios (executed 2026-10-07, fresh)

### 1. Intake spec suite

- `npx jest tests/functions/screenshot-capture/lifecycle-capture --coverage=false`
- Expected: 15/15 — claim-before-invoke ordering, dedup skip, fresh-pending
  concurrent skip, stale reclaim, failed→retry, spec fields +
  `renderOnly:false`, manifest commit, index doc shape/id, both carrier
  kinds, ungrouped index doc omits `groupId`, throw/timeout/txn-failure
  swallow.
- **Result:** PASS — 15/15.

### 2. Regression — capture-chart refactor

- `npx jest tests/functions/screenshot-capture --coverage=false`
- Expected: existing capture-chart, utils, renderer, assembler suites
  unaffected by the `executeCaptureChart` extraction.
- **Result:** PASS — 147/147 across 7 suites.

### 3. Types + bundle

- `cd functions && npx tsc --noEmit` — clean.
- `npm run build` (esbuild) — clean, `lib/index.js` 1.8mb.
- **Result:** PASS.

### 4. Dedup-ledger semantics (spec walkthrough)

- `capturedEvents` is a map keyed by event — `order-filled` and
  `position-closed` dedup independently on one carrier.
- `pending` claimed in-transaction → concurrent trigger loses (Firestore
  serializes txn retries; loser re-reads and skips).
- `pending` older than `LIFECYCLE_STALE_CLAIM_MS` (60s) reclaims — a dead
  claimant can't wedge the slot.
- `failed` always retries — never terminal.
- Commit-txn failure leaves `pending` (stale-reclaimable) while artifacts
  already exist — logged loudly, outcome still `captured`. Documented
  trade-off in the module header.
- **Result:** PASS by spec coverage (cases 1–5 each have a dedicated test).

### 5. Live Firestore + bucket verification

- Deferred to task **#848** per blueprint split — the seeded-carrier → real
  bucket → manifest/index asserts + dedup re-run script is
  `screenshot-capture-826-lifecycle.ts`.
- **Result:** DEFERRED (by plan).

## Verdict

**PASS.** #845 is ship-eligible.

## Files under this task (for ship staging)

- `functions/src/screenshot-capture/lifecycle-capture.ts` (new)
- `functions/src/screenshot-capture/capture-chart.ts`
- `functions/src/common/st-collections.ts`
- `firestore.rules`
- `tests/functions/screenshot-capture/lifecycle-capture.spec.ts` (new)
- `docs/topics/746-screenshot/746-842-845-CODE-REVIEW-SCREENSHOT-screenshot-capture.md`
- `docs/topics/746-screenshot/746-883-845-UAT-SCREENSHOT-screenshot-capture.md`
