**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1406  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1376  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #1376: Analyze / View Results entry point

## Scope

The Analysis entry point on each Selection Replay contract-list card: an **Analyze** action (enabled iff the list doc is `status: 'success'`) that calls `optionsAnalysisStart({contractListDocId})`, flipping to **View Results** → `/options/strategy/backtest/analysis/:listDocId` once success result docs exist for that list.

## Prerequisites

- Dev server running at `http://localhost:4200` (`npm start`), logged in.
- A Selection Replay run with ≥1 `success` contract list and (for the disable checks) one pending or failed symbol. The run used for #1375 QA (AMAT/QQQ/SPY all `success` after rerun) works for S1–S4.
- `optionsAnalysisStart` + `optionsReplayAnalysis` deployed (done 2026-11-05).

## Getting to the feature (from app root)

1. Open `http://localhost:4200` and sign in.
2. In the left sidenav, open the **Options** section and click **Backtest** — navigates to `/options/strategy/backtest` (page title "Strategy Backtest").
3. The page shows the **Selection Replay** section (below the legacy sim-runs section, which is currently hidden). Its run list is on the left.
4. Click a run row (e.g. the run containing AMAT/QQQ/SPY). The run detail panel opens on the right with one card per symbol.
5. The feature under test is the **action button in each contract-list card's header row** — far right of the status chip (**Analyze** / **Analyzing…** / **View Results**).
6. **View Results** navigates to `/options/strategy/backtest/analysis/{listDocId}` where `listDocId` = `{runId}_{symbol}` (e.g. `…/analysis/abc123_SPY`). This route has no sidenav entry — the card link is the only UI way in; the URL also resolves directly.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Analyze enabled on success card | Follow "Getting to the feature" steps 1–4 with the completed AMAT/QQQ/SPY run | Every `success` symbol card header shows an enabled **Analyze** button (far right of the status chip) | PASS — 2026-11-05, user observed Analyze on success cards |
| S2 | Analyze click → lifecycle | Click Analyze on the SPY card | Toast `Analysis started: {runId}_SPY`; button becomes disabled **Analyzing…**; when `optionsReplayAnalysis` writes docs (seconds–a few min) it flips to **View Results** | PASS — 2026-11-05, user: button flipped to View Results (success result doc landed). First attempt failed `internal` — root cause was `optionsAnalysisStart` not yet deployed; deployed 2026-11-05 and retried OK |
| S3 | View Results navigation | Click View Results on the SPY card | Route `/options/strategy/backtest/analysis/{runId}_SPY` resolves; shell page shows `Analysis Results` + the listDocId | PASS — 2026-11-05, user reached the Analysis Results shell page (stub content is expected — real surface is #1377) |
| S4 | Disabled/absent states | Check a run with a pending or failed symbol | Pending/failed cards show a **disabled** Analyze (`title` explains why); a symbol with no list doc yet shows no action at all | N/A — 2026-11-05: no pending/failed list docs available for live check (all symbols success after #1375 rerun); disabled/absent matrix spec-pinned in component specs |
| S5 | Failed-doc edge (automated) | `optionsReplayAnalysis` writes `status:'failed'` docs on final failure | Card keeps showing enabled **Analyze** (re-clickable re-run); does NOT flip to View Results. Verified by spec `marks ready only on SUCCESS docs`; live reproduction optional | PASS — spec-verified (`analysisReadyListIds` success-only) |
| S6 | Callable failure path | (Hard to force live — spec coverage) | `failed-precondition` (list regressed) → toast `Analysis failed to start: …`; button re-enables | PASS — 2026-11-05, user observed live: callable failure (missing deployment → `internal`) produced `Analysis failed to start: internal` toast and the button re-enabled for the successful retry |
| R1 | Regression: contract table | Expand a success card's row toggle | `app-options-replay-contract-list-table` renders rows; row inspect still opens the contract-series dialog | PASS — closed on user authorization 2026-11-05; path unchanged by this diff (specs + prior QA #1363/#1399) |
| R2 | Regression: rerun button | A run with a failed symbol | Rerun icon on failed rows still works (run-scoped disable semantics unchanged) | N/A — 2026-11-05: no failed rows currently (all success after #1375 rerun QA #1398, which verified rerun live) |
| R3 | Regression: run/symbol selection | Switch between two runs | Cards for the new run show correct Analyze/View Results state — no stale ready-flags from the prior run | PASS — closed on user authorization 2026-11-05; run-switch reset spec-pinned in store specs |

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Button enabled iff list `status === 'success'` | S1, S4 |
| Analyze calls callable with `contractListDocId` | S2 (+ service spec pins name/payload) |
| View Results routes to `/options/strategy/backtest/analysis/:listDocId` | S3 |
| Review finding: failed docs must not flip to View Results | S5 |
| Error lifecycle (toast + re-enable) | S6 |

## Automated evidence

- Task suites: **209/209** (`src/app/features/savant-trader/backtest` + `core-routes.spec.ts`), `tsc --noEmit` clean — run 2026-11-05 post-review-remediation.
- Service spec pins `httpsCallable('optionsAnalysisStart')({contractListDocId})` and `where('runId','==')` query shape.
- Store specs cover: stream start/clear/restart, ready-set success-only, flag hold→prune→retention→clear, guard double-click, error toast.
- Component specs cover: enabled/disabled/absent matrix, emit value, analyzing label, link href.

## Refinement pass

- Button placement/sizing in card header, Analyzing… state, toast copy, shell-page legibility — accepted on user authorization 2026-11-05 (user drove the live flow; no UI nits reported).
- One real-world incident surfaced and resolved during QA: the `optionsAnalysisStart` callable had not been deployed (click → `Analysis failed to start: internal`). Deployed 2026-11-05; the failure toast + re-enable behavior was live-verified by the same incident (S6).

## Result

**PASS** — S1–S3, S5, S6, R1, R3 PASS (live + spec-pinned); S4, R2 N/A (no pending/failed list docs exist to exercise; spec-pinned). Closed on user authorization 2026-11-05.
