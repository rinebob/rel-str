**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Issue:** #1436  
**Task:** #1433  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — Allocation watch streams: self-heal on transient permission errors

## Scope

Task #1433 fixed the intermittent "Missing or insufficient permissions"
banner that latched on `/portfolio/allocation` — visible in **both** the
Buckets and Positions tabs (they share one account error banner). A
transient auth-token/network blip kills a Firestore snapshot listener;
previously the dead stream never re-attached and the error stayed visible
until a manual refresh or account switch.

The fix: each watch stream (buckets, attributions) now retries with
bounded backoff — **5s, 15s, 45s** — resubscribing a fresh Firestore
listener each time. A healthy emission resets the retry budget and clears
that stream's error slot. After 3 failed retries the stream stays dead
and the banner stays latched until the next account switch or refresh.
MCP load errors and per-stream errors occupy separate slice fields —
one cannot mask the other.

Automated coverage (green at review): 7 recovery specs in
`allocation.store.spec.ts` `describe('stream error recovery (#1433)')`
pin the state machine — auto re-attach, error-clear on recovery, bounded
retries, budget reset, MCP preservation (both orderings), per-stream
masking. This UAT covers what the specs can't see: live render, real
listener behavior, and the behavioral nuances from code review.

## Prerequisites

- Dev server running: `npm start` (Observation API on `:3456` +
  `ng serve` on `:4210`).
- Signed-in user with at least one Robinhood account (positions optional —
  the streams fire on any data, including empty).
- Chrome/Edge devtools (optional, for the induced-error scenario).

## Getting to the feature

1. Navigate to `http://localhost:4210/portfolio` (sign in if prompted).
2. Click **Allocations** in the header to reach `/portfolio/allocation`.
3. The surface is the account error banner (`data-testid="account-error"`)
   which renders inside either tab pane when `selectedError()` is set —
   plus the absence of that banner when streams are healthy.

## Scenarios

### 1. Healthy render — no banner, both tabs

- **Start:** `/portfolio/allocation`, streams healthy.
- **Steps:** On the **Buckets** tab confirm the table renders (buckets,
  Unassigned, Cash rows — or the empty state if the account has no
  buckets). Switch to the **Positions** tab.
- **Expected:** No `account-error` banner in either tab; both render
  their tables. (Pre-fix, a latched banner would block BOTH tabs.)
- **Result:** PASS — user confirmed live, 2026-11-06.

### 2. Refresh still works (manual attach path unchanged)

- **Steps:** Click the refresh icon (`refresh-btn`) in the page header.
- **Expected:** Data reloads (as-of timestamp updates); no error banner;
  no duplicate listeners (buckets/positions don't double-render or
  flicker repeatedly).
- **Result:** PASS — user confirmed live, 2026-11-06.

### 3. Account switch attaches streams (N/A with one account)

- **Start:** ≥2 accounts in the switcher.
- **Steps:** Switch to another account, then switch back.
- **Expected:** Each account's buckets/positions load; no banner; the
  previously-selected account's data still renders on return (cached
  slice re-derives).
- **Result:** N/A — single account (user confirmed, 2026-11-06).

### 4. Stream error self-heals (the core fix — observational)

- **Start:** The intermittent blip can't be induced deterministically
  without touching prod rules; the unit specs pin the mechanism
  (evidence below).
- **Steps (when the blip next occurs):** Note the permission banner;
  wait **~5 seconds** without touching anything.
- **Expected:** The banner clears on its own as the retried stream emits;
  tables return. No refresh or account switch needed.
- **Evidence (automated):**
  `npx jest src/app/features/portfolio-dashboard/allocation.store.spec.ts`
  — 29/29 pass; the 7 recovery specs pin: auto re-attach after 5s
  backoff, error cleared on the recovering emission, bounded retries
  (4 subscribe attempts then dead), budget reset on healthy emission.
- **Result:** MECHANISM PASS (specs, 2026-11-06) — live observation
  pending next natural blip; not a ship blocker (pre-fix the same banner
  required manual recovery; the failure mode is strictly improved
  regardless).

### 5. Behavioral nuance — refresh during backoff waits for the retry

- **Start:** Only meaningful during an active error + backoff window
  (same induction problem as scenario 4).
- **Steps (if ever observed):** With the banner showing from a recent
  stream error, click refresh before ~5s elapse.
- **Expected:** The banner may persist briefly — the scheduled retry
  (not the click) clears it. Acceptable per code review: the stream is
  alive mid-backoff, so a manual attach correctly doesn't
  double-subscribe.
- **Result:** Documented nuance — not independently observed; unit spec
  ('a terminally-dead stream re-attaches on next selectAccount') pins
  the manual path for the exhausted-retry case.

### 6. Terminal failure stays latched until manual action

- **Start:** Requires a persistent deny (all 3 retries fail ≈ 65s) —
  can't occur transiently.
- **Expected:** Banner remains visible after retries exhaust; an account
  switch or refresh re-attaches instantly.
- **Evidence (automated):** spec 'retries are bounded — a permanently
  failing stream stops re-attaching' + 'a terminally-dead stream
  re-attaches on next selectAccount'.
- **Result:** MECHANISM PASS (specs, 2026-11-06).

### 7. Error-source separation — stream can't mask an MCP failure

- **Start:** Requires the Robinhood MCP to fail while streams are live —
  occurs during real MCP outages.
- **Steps (if MCP is observed down):** Banner shows the MCP error; stream
  emissions continue arriving for buckets/attributions.
- **Expected:** The banner keeps showing the **MCP** error — stream
  activity can't clear a different source's latched error.
- **Evidence (automated):** specs 'a stream emission does NOT clear an
  MCP load error' + 'a stream error latched BEFORE an MCP failure cannot
  be cleared by a later emission' + 'a recovering stream cannot mask its
  dead sibling'.
- **Result:** MECHANISM PASS (specs, 2026-11-06).

### 8. Regression smoke — allocation surface otherwise unchanged

- **Steps:** Create/rename/retire a scratch bucket if desired (existing
  flows untouched); verify Positions tab attribution display.
- **Expected:** All existing allocation behavior unchanged — this task
  touched only the error/recovery paths.
- **Result:** PASS — live render confirmed (scenario 1) + full suite
  green (301 suites / 5254 tests, 2026-11-06).

## Traceability

| Acceptance criterion (issue #1433) | Scenario |
|---|---|
| Dead watch stream auto re-attaches — no manual action | 4 (specs) |
| Banner clears on next successful emission | 4 (specs) |
| Bounded backoff — retries stop | 6 (specs) |
| Both tabs consistent (shared banner) | 1 |
| Manual attach paths preserved (select/refresh) | 2, 3, 6 (specs) |
| MCP vs stream errors stay distinct | 7 (specs) |
| No regression on the allocation surface | 1, 2, 8 |

## Notes

- The live self-heal (scenario 4) is inherently observational: the trigger
  is a transient prod auth/network blip. A deterministic variant exists
  (temporarily deploy a deny rule on `st-portfolio` to force
  permission-denied, then revert) but was not run — it requires two prod
  rules deploys for marginal coverage over the pinned unit behavior.
  If the blip recurs and the banner does NOT self-clear, reopen #1433.
