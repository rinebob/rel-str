# UAT — #931 stSignalHistory flattened signals.* reader

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #975  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #931  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Result: PASS — verified live on the deployed callable

Code review PASS (`553-904-931-CODE-REVIEW-…`). Executed 2026-10-11;
deployed-callable leg confirmed post-deploy.

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | `stSignalHistory` returns prod's real signals | **Before (deployed callable):** `{signals:[]}` — bug confirmed live. **After (deployed callable, same call):** returns `D_ST_TREND_RIDER_V1_SHORT barDate=2026-08-28 runId=2026-08-28_fri_151511_nightly` + `2026-09-11` — matches prod docs exactly | **PASS live** |
| 2 | Ingest still resolves signals post-refactor | `auto-paper-ingest-pass` + #918 verify script call the same `signalEntriesFromDoc` (logic moved verbatim); `test:paper-trading` 197/197 green | PASS |
| 3 | Test suite + typecheck | `test:st-signals` 6/6 · `test:paper-trading` 197/197 · `tsc --noEmit` clean | PASS |
| 4 | Docblocks describe flattened reality | `StRunIdDoc`/`StSignalHistoryDoc` lead comments corrected + `signals?` optional | PASS |
| 5 | No stale `signalEntriesFromRunDoc` references | Repo-wide grep: zero (lib/ bundle excluded — stale build artifact) | PASS |

## Deploy confirmation

Deployed 2026-10-11; post-deploy curl on ACMR returns both signal-history
entries (`2026-08-28`, `2026-09-11`) — the callable now reads prod's
flattened `signals.*` fields through `signalEntriesFromDoc`.

## Findings

None raised during QA.
