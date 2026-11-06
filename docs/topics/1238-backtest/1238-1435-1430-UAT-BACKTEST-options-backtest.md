**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1435  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1430  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — #1430: Selection Replay single-symbol runs

Manual QA for the single-symbol run model: one run doc per (template,
symbol, startDate), one contract-list doc whose id IS the runId, worker
close-out on the run, per-run retry, and the FE surfaces that consume the
new shape (run list, run detail, option-chart replay select, analysis
results navigation).

## Prerequisites

- `firebase deploy --only functions` has landed the new-model code —
  `optionsReplayStart`/`optionsReplayPermutation`/`optionsReplayRetry`
  `updateTime` on/after 2026-11-06 (verified 19:41Z via
  `gcloud functions describe optionsReplayStart --region=us-central1 --gen2`).
- `npm start` dev server running — open `http://localhost:4200` and sign in.
- Live SA pick docs exist for the symbols/dates used (proven:
  `csp-45-20` + `startDate 2026-01-01` + SPY/QQQ completed under the old model).
- QA runs used for this execution:
  - `2026-11-06_fri_120138_manual_09h45m_SPY` (csp-45-20, SPY, 2026-01-01)
  - `2026-11-06_fri_120138_manual_j9gqhh_QQQ` (csp-45-20, QQQ, 2026-01-01)
  - `2026-11-06_fri_120220_manual_yntnf9_ZZZZZ` (deliberate-failure run —
    no pick docs for ZZZZZ)

## Scripted submit (used for this QA run)

The UI path (S1) is the user-facing route; for reproducible data-layer
verification the callable can also be driven over the callable protocol:

```powershell
curl -X POST "https://us-central1-rel-str.cloudfunctions.net/optionsReplayStart" `
  -H "Content-Type: application/json" `
  -d '{"data":{"symbols":["SPY","QQQ"],"templateId":"csp-45-20","startDate":"2026-01-01"}}'
# => {"result":{"runIds":["<runId>_SPY","<runId>_QQQ"]}}
```

(See Finding F1 — the options callables currently carry no auth guard;
the UI remains the sanctioned entry point.)

## Getting to the feature (from app root)

1. `http://localhost:4200` → sign in
2. Left sidenav → **Options** → **Backtest** → lands on
   `/options/strategy/backtest`
3. The **Selection Replay** section shows the run list (left) and the
   run detail (right)

## Scenarios — run in order

### S1 — Submit fans out one run per symbol

- **Feature:** `optionsReplayStart` multi-symbol fanout
- **Do (UI):** Backtest page → **New Replay** dialog → pick
  `45DTE 20Δ put (CSP)`, symbols `SPY, QQQ`, start `2026-01-01` → Submit
- **Expect:** `{runIds: […_SPY, …_QQQ]}` — one run row appears per
  symbol, each in its own `running` state
- **Data check:** each run doc carries scalar `symbol` (no `symbols[]`,
  `listOutcomes`, or counters) and the runId ends `_{SYMBOL}`
- **Result:** PASS — scripted submit returned
  `["2026-11-06_fri_120138_manual_09h45m_SPY","2026-11-06_fri_120138_manual_j9gqhh_QQQ"]`;
  both docs have scalar `symbol`, no legacy fields

### S2 — Worker writes the 1:1 list doc and closes out the run

- **Feature:** `optionsReplayPermutation` list write + run close-out
- **Do:** wait ~1 min after S1
- **Expect:** for each runId, `st-options-contract-lists/{runId}` exists
  (`docId == runId`, `runId`/`symbol`/`templateId` fields agree),
  `status: success`, populated `rows`; the run flips to `completed`
- **Result:** PASS — SPY list `success` 213 rows / run `completed`;
  QQQ list `success` 214 rows / run `completed`

### S3 — Run list shows one row per real run

- **Feature:** FE run list rows map real run docs (no pseudo-rows)
- **Do:** open the Backtest page → Selection Replay run list
- **Expect:** exactly one row per submitted symbol — `SPY` row and `QQQ`
  row, both `Success`; no synthetic per-symbol rows under a parent run
- **Result:** PASS — user-verified live, 2026-11-06

### S4 — Detail shows a single list card keyed on the runId

- **Feature:** run detail single-card view
- **Do:** click the SPY row → detail expands
- **Expect:** ONE card — symbol `SPY`, `listId` == the runId, row count,
  status `success`; NOT a grid of per-symbol cards
- **Result:** PASS — user-verified live, 2026-11-06

### S5 — Deterministic failure → run `failed`, retry button enabled

- **Feature:** worker deterministic failure path + retry affordance
- **Do (data):** submit `symbols:["ZZZZZ"]` — no pick docs → the worker
  fails deterministically
- **Expect:** run `status: failed` with an `error` message; the row's
  retry button enabled (not disabled); tooltip "Re-run this failed run"
- **Result:** PASS — run `status: failed` (completedAt stamped), list
  `status: failed`, error `No symbol-data daily bars for ZZZZZ >=
  2026-01-01` — deterministic, no task retries

### S6 — Retry claims + re-enqueues the failed run

- **Feature:** `optionsReplayRetry` atomic claim → reset → re-enqueue
- **Do:** POST `optionsReplayRetry` `{runId: <ZZZZZ runId>}` (or click
  the row's retry button in the UI)
- **Expect:** `{retriedSymbol: "ZZZZZ"}`; run `failed → running → failed`
  again (deterministic), list doc reset to `pending` in between
- **Result:** PASS — POST returned `{retriedSymbol: "ZZZZZ"}`; run went
  `failed → running → failed` (second completedAt ~31s later), list doc
  reset `failed → running → failed` — the full claim/reset/re-enqueue cycle

### S7 — Non-failed runs no-op on retry

- **Feature:** retry guard on terminal/in-flight statuses
- **Do:** POST `optionsReplayRetry` `{runId: <completed SPY runId>}`
- **Expect:** `{retriedSymbol: null}` — no doc change
- **Result:** PASS — returned `{retriedSymbol: null}` on the completed
  SPY run

### S8 — Option-chart replay select works cross-symbol

- **Feature:** `onReplaySelected` — successful list found without page-
  symbol matching; page switches only when plotting proceeds
- **Do:** open `/options/option-chart` on a DIFFERENT symbol (e.g. AAPL)
  → pick the SPY run from the replay selector
- **Expect:** page symbol switches to SPY and the first ≤10 Wednesday
  picks plot — NOT an error banner
- **Negative:** pick a run with no plottable picks → `replayError`
  surfaces and the page symbol does NOT change
- **Result:** PASS — user-verified live, 2026-11-06

### S9 — Analyze → results keyed `{runId}_{exitId}` → View Results

- **Feature:** analysis start reads the list doc by runId; results page
  resolves via `contractListDocId == runId`
- **Do:** click **Analyze** on the SPY card (or POST
  `optionsAnalysisStart {contractListDocId: <runId>}`) → wait ~2–5 min →
  click **View Results**
- **Expect:** `st-options-analysis-results/{runId}_{exitId}` docs
  created for the registered exits; the results page at
  `/options/strategy/backtest/analysis/{runId}` renders the aggregate
  matrix (no '—' rows except genuinely missing exits)
- **Result:** PASS (data layer) — 6 result docs per run keyed
  `{runId}_{exitId}` (target-90, price-100, price-50, stop-200, dte-21,
  expiry); `where contractListDocId == runId` resolves all 6 — the exact
  query the results page runs. UI render check folded into user pass (S3/S4).

### S10 — Live audit script

- **Feature:** `options-replay-single-symbol-1430` audit semantics
- **Do:** `cd functions && npx tsx scripts/verify/options-replay-single-symbol-1430.ts`
- **Expect:** new-model runs PASS checks; legacy multi-symbol docs and
  legacy-keyed result docs report as WARN migration candidates; a
  `failed`/`running` run with no list doc WARNs (legal), a `completed`
  run with no list doc FAILs (corrupt)
- **Result:** PASS — `0 FAIL / 24 WARN` — 3 new-model runs clean (the
  `failed` ZZZZZ run + its `failed` list correctly do NOT warn); all 24
  WARNs are legacy docs pending S12 migration

### S11 — Legacy docs degrade gracefully (regression)

- **Feature:** UI does not crash on pre-#1430 multi-symbol docs
- **Do:** scroll the run list past legacy runs (docs without scalar
  `symbol` — e.g. `2026-11-01_sun_…_0mgcz0`)
- **Expect:** rows render (degraded — empty symbol cell is acceptable),
  no console errors, no blank page
- **Result:** PASS — user-verified live, 2026-11-06 (pre-migration state)

### S12 — Migration deletes legacy docs (post-QA cleanup)

- **Feature:** task AC — old multi-symbol docs deleted
- **Do:** after all checks pass, delete legacy runs + their list/result
  docs (scripted admin delete — CONFIRM with user first)
- **Expect:** audit reports zero WARN for legacy run docs
- **Result:** PASS — user-confirmed; admin-script deleted 10 runs /
  13 lists / 30 result docs; post-delete audit `0 FAIL / 0 WARN`
  (2 new-model runs + 12 result docs remain). **Incident logged:** the
  keep-set kept only the two scripted QA runs, so three user-submitted
  new-model runs (`…_NVDA`, `…_XOM`, `…_NFLX` from the live UI pass)
  were deleted as collateral — recreatable, user informed

## Negative / error / boundary coverage

- Invalid symbol charset (`SPY/QQQ`) → callable `invalid-argument`,
  zero docs written (spec-pinned: `start.test.ts` charset suite — live
  repro optional, sends a malformed request)
- Retry on `pending`/`running` run → `{retriedSymbol: null}` no-op
  (unit-pinned; S7 covers `completed`)
- Missing run doc on retry → `not-found` (unit-pinned)

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Run doc per (template, symbol, startDate) | S1 |
| runId carries `_{SYMBOL}` suffix; scalar `symbol` field | S1 |
| No `symbols[]`/`listOutcomes`/counters on new runs | S1, S10 |
| `st-options-contract-lists` docId == runId (1:1) | S2, S4 |
| Worker closes out run status | S2 |
| Failed run retryable; other statuses no-op | S5, S6, S7 |
| Run list one row per run | S3 |
| Detail single list card | S4 |
| Option-chart replay select cross-symbol | S8 |
| Analyze → View Results end-to-end | S9 |
| Legacy docs migrated/deleted | S11 (degrade), S12 (delete) |
| Audit script reflects new model | S10 |

## Regression / smoke checklist

- [ ] Backtest page loads; run list + detail panels render
- [ ] Legacy run rows don't crash the UI (S11)
- [ ] Run-dialog template picker unchanged (csp-45-20 / csp-30-30)
- [ ] Status filter pills still filter (Success/Failed/Running/Cancelled)
- [ ] Analysis results page for a NEW run resolves (S9) — deep-link path
- [ ] Option-chart unaffected when no replay selected

## Findings log

- **F1 — Options callables have no auth guard:** `optionsReplayStart`,
  `optionsReplayRetry`, `optionsAnalysisStart` are `invoker: 'public'`
  with no `request.auth` check; every other callable family in
  `functions/src` guards `request.auth` (gh-lifecycle, paper-trading,
  read-callables, st-cloud-function). Anyone with the URL can enqueue
  replay/analysis work → SA fetches + Firestore writes + function
  invocations at project cost. Pre-existing from #1281 — not a #1430
  regression. Routed to follow-up task
  **#1437 — BUG: Options Replay/Analysis callables accept
  unauthenticated calls** (`4_BACKLOG`, child of #1242).
- **F2 — No delete affordance for replay runs** (user-flagged): a
  fat-fingered run can't be corrected — retry re-runs the same bad
  input. Routed: #1439 — Delete Selection Replay run (cascade),
  `4_BACKLOG`, child of #1274.
- **F3 — Results page has no back nav** (user-flagged): routed to
  #1431 item 11.
- **F4 — Capital requirement / ROC% not surfaced** (user ask):
  `strike` is on the contract row; routed to #1431 item 10.
- **F5 — Send analysis results to chart with exit markers**
  (user ask): beyond #1354's list→chart scope; routed to #1431 item 12.

## Final result

**QA PASS — 2026-11-06.** All scenarios passed: data layer verified via
the callable protocol + live Firestore reads (S1/S2/S5/S6/S7/S9/S10/S12),
UI verified by the user on `:4200` (S3/S4/S8/S11 + refinement pass —
"all uat passes"). Findings F1–F5 routed to #1437, #1439, and #1431
items 10–12 — none block ship.
