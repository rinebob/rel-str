**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1398  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1375  
**Domain:** BACKTEST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — #1375 rerun button wiring (`optionsReplayRetry`)

## Scope

Failed-symbol rows in the Selection Replay run list gain a run-scoped
rerun action: clicking it calls the `optionsReplayRetry` callable, which
re-queues all of the run's failed symbol list docs. The button is
disabled while the run is pending/running/cancelled or a retry is already
in flight; post-retry state arrives via the existing `watchRuns` stream
(failed `listOutcomes` entries deleted → row flips pending → button
hides). An in-flight `retryingRunIds` set guards the double-click window
*and* the callable-response→snapshot lag; it prunes when a snapshot
proves the retry landed (status `'running'`, failed outcomes gone, or
run absent).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, branch `prod`.
- `optionsReplayRetry` callable deployed (shipped in #1369 — verify
  `firebase functions:list` includes it before the live click test).
- For the live check: `npx ng serve`, an authenticated session (route is
  behind `authGuard`), and a replay run in `st-options-replay-runs` with
  at least one failed symbol outcome.

## How to reach the feature

- UI: `/options/strategy/backtest` (`AppRoutes.STRATEGY_BACKTEST`,
  auth-guarded, left-nav "Strategy Backtest") → the **Selection Replay**
  section → failed rows show a replay icon next to the failed badge.
- Specs: `npx jest options-replay-run-list options-replay.store
  --coverage=false`.

## Automated results (executed 2026-11-05)

| Check | Command | Result | Evidence |
|---|---|---|---|
| Full backtest sweep | `npx jest savant-trader/backtest --coverage=false` | **PASS** | 9/9 suites, **115/115** — includes the previously-foreign dialog suites (de-materify spec debt resolved) |
| Task-scoped suites | `npx jest options-replay-run-list options-replay.store` | **PASS** | **54/54** (run-list 25, store 29) |
| Service/converter | `npx jest options-replay-runs options-replay-firestore-converter` | **PASS** | part of the 61/61 replay-service sweep |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | **PASS** | clean |

## Scenario results

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Rerun button renders only on `symbolStatus === 'failed'` rows | PASS | run-list spec status matrix (failed shows, success/pending don't) |
| 2 | Click emits `runId` via `rerun` without selecting the row | PASS | run-list spec asserts emit + empty selections |
| 3 | Disabled while run pending/running/cancelled | PASS | run-list spec disable matrix (all three assert `disabled`) |
| 4 | `completed`+failed rows stay enabled — dominant partial-failure path | PASS | run-list spec (R2 addition) |
| 5 | One in-flight flag disables every failed row of the run | PASS | run-list spec multi-row same-run disable |
| 6 | Store `retryRun` calls service; second click is a no-op | PASS | store spec in-flight guard (1 call) |
| 7 | Guard is per-run — `run-2` retries while `run-1` is in flight | PASS | store spec (2 calls, last called with `run-2`) |
| 8 | Flag holds after a real retry until the snapshot proves it landed | PASS | store spec hold-while-stale |
| 9 | `status:'running'` snapshot clears the flag even with a coalesced re-failed outcome | PASS | store spec (R2 Major fix) |
| 10 | Run absent from snapshot → flag pruned | PASS | store spec (R2) |
| 11 | Error path toasts and clears; empty `retriedSymbols` toasts "Nothing to retry" and clears | PASS | store specs |
| 12 | Post-retry row flips failed→pending via `watchRuns` only — no manual run patching | PASS | store spec snapshot transition; `retryRun` only patches `retryingRunIds` |
| 13 | Dashboard wires `[retryingRunIds]` + `(rerun)` → `replayStore.retryRun` | PASS | `backtest-dashboard.component.html:83-85` verified in review |
| 14 | a11y: `type="button"`, `title`, `aria-label`, `aria-hidden` icon | PASS | markup verified in 2 review rounds |

## Traceability

| AC | Scenarios |
|---|---|
| Rerun action visible only on failed rows | 1 |
| Click → `optionsReplayRetry(runId)`; no second click while in flight | 2, 5, 6, 7 |
| Post-retry transitions via run listener | 8, 9, 10, 12 |

## Refinement pass (manual, live app)

Executed 2026-11-05 against prod on
`http://localhost:4200/options/strategy/backtest` — user drove the live
check and the full retry path verified end-to-end **against real data**.

- Failed rows (QQQ/SPY/AMAT) showed the replay icon next to the failed
  badge; click fired `optionsReplayRetry` and the rows flipped
  pending → **success** as the permutation worker re-fetched the pick
  docs. The button disappeared on its own via `watchRuns`.

### Incident uncovered during QA (resolved, not a #1375 defect)

The original failures — `pick doc fetch failed … no year shard found in
[2026, 2026]` — were a red herring with two stacked causes:

1. **Stale artifacts of an SA deploy window.** The run executed before
   `partnerOptionsDeltaPicksV1` existed (first deployed 17:58 UTC
   2026-11-01). SA-side log evidence: ST calls at 18:55–18:57 UTC
   succeeded on exactly those cells (200s); no ST request has hit the
   endpoint since. The Google-infra 404s were mislabeled "no year
   shard" because our skip predicate treats every
   non-`OPTIONS_NOT_ENABLED` 404 as a coverage gap — infra 404s carry no
   `partnerCode`. Filed as a follow-on task (404 classification).
2. **`optionsReplayRetry` + `optionsReplayAnalysis` were never deployed.**
   `firebase functions:list` showed only `optionsReplayStart` +
   `optionsReplayPermutation`. Deployed 2026-11-05; rerun then worked
   first try.

## Regression / smoke

- `optionsReplayRetry` callable unchanged (shipped #1369); FE only wires it.
- Toolbar (#1374), row selection → detail expand, `optionsReplayStart`
  flow unchanged — full backtest sweep 115/115.
- Store changes are additive: `retryingRunIds` field + `retryRun` method +
  prune block inside `loadRuns`' stream patch — no existing method
  signatures touched.
