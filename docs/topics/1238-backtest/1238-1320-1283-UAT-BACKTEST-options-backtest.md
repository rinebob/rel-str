**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1283  
**QA Issue:** #1320  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — Task #1283 (Replay runs service + runs list)

## Verdict: PASS

Fresh evidence at gate: `npx jest` on the four new spec files — **21/21**;
`ng build --configuration development` clean (run at review); no `src/`
eslint config exists — FE verification is build + jest.

## Scenarios

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Runs list renders status icon, runId, created, template name, symbols, `completedLists/totalLists` progress | PASS | run-list spec — row content + progress text/percent |
| 2 | Template name resolves from `REPLAY_TEMPLATES`; unknown id falls back to `templateId` | PASS | template-name + fallback tests |
| 3 | Status→visual mapping (completed/failed/pending → icon) | PASS | status-mapping test |
| 4 | Failed-count badge renders only when `failedLists > 0`, shows count | PASS | badge test (1 badge for 2 rows) |
| 5 | Progress shows `—` when `totalLists` is 0 | PASS | zero-total test |
| 6 | Row click emits `selectRun` with runId | PASS | click-emission test |
| 7 | Empty state renders "No selection replay runs yet"; loading copy while `isLoading` | PASS | empty-state test |
| 8 | Store streams run docs into `runs` signal; live update on re-emission | PASS | store spec — stream + live-update tests |
| 9 | `loadRuns` idempotent (one service subscription) | PASS | idempotent test |
| 10 | `selectRun` swaps lists subscription; `selectRun(null)` clears lists | PASS | select-run tests |
| 11 | Stream error → snackBar + streaming flag cleared | PASS | error-path test |
| 12 | Detail shell: header (template, symbols, startDate, progress) + per-symbol status card; unwritten doc shows `pending`; failed doc shows error | PASS | detail spec — header, pending placeholder, failed error, card count |
| 13 | Sim runs list untouched | PASS | diff audit — dashboard changes are purely additive; zero sim-component changes |
| 14 | Converter handles sparse docs + success/failed list shapes | PASS | converter spec — defaults + failed-doc test |
| 15 | Read/write contract: every terminal list doc carries `runId`/`symbol` (query can't miss) | PASS | worker write-path trace (review pass 2) + merge semantics |

## Acceptance-criteria traceability (#1283)

- Runs list renders status + progress + failed badge → S1–S6
- Live updates as run/list docs change → S8–S10
- Sim runs list untouched → S13
- Tests per TEST-FE → S1–S14 (service mocked at the store seam per TEST-FE)

## Residual notes

- Runs list is capped at the 50 most recent (`watchRuns(50)`) — same as
  the sim runs service; deliberate parity.
- `pending`-window runs can briefly show `—` for Created until the
  serverTimestamp resolves — standard Firestore behavior, same as sim.
- No live-data verification possible until functions deploy + a real
  replay run writes docs — the FE surface is fully fixture-verified.
