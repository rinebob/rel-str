# UAT — #919 BE: stats scope fan-out (QA #956)

**Topic:** Paper Trading Infra  
**Topic Slug:** 553-paper-trading  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #956  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #919  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Result: PASS

Executed 2026-10-11. Review doc:
`553-914-919-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md`.

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Paper-trading suite | `npm run test:paper-trading` | **PASS** — 200/200 |
| 2 | Typecheck, touched files | `tsc --noEmit` filtered | **PASS** — 0 errors |
| 3 | AC: fully-stamped auto trade → all six new scopes + existing | spec `fully-stamped auto-paper trade` asserts `sigtype-…-v1-long`, `dir-long`, `sector-technology`, `ind-software-application`, `captier-mega`, `sigstatus-confirmed` + `all`/`sym`/`var`/`sig` | **PASS** |
| 4 | AC: manual/unstamped trade scopes unchanged | existing specs (`only all + sym`, `emits all + every populated dimension`) | **PASS** |
| 5 | AC: nightly pass writes new docs, no scheduling changes | structural — `tradeScopes` is pure fan-out; `runPaperStatsPass` wiring untouched | **PASS** |
| 6 | Malformed stamp resilience | spec `un-sluggable stamp drops just that scope` | **PASS** |

## Notes

- `dir-*` emits only for signal trades (gated on `signalType`, keyed off
  `order.side`) — per IMPL §4.
- No stats docs exist for auto-paper yet — the feature stays inert until
  `trading-config/autoPaper` is written and trades flow.
- `stats-all` will be dominated by auto-paper volume once enabled — by
  design per the AC; the slice scopes are the answerable views.
