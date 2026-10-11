# UAT — #921 FE: auto-paper group-by dims on trading/paper (QA #967)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #967  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #921  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

## Result: PASS

Executed 2026-10-11. Review doc:
`553-915-921-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md`.

## Scenarios

| # | Scenario | Evidence | Result |
|---|---|---|---|
| 1 | Paper-trading specs | `npx jest` store + component specs | **PASS** — 48/48 |
| 2 | Typecheck, touched files | `tsc --noEmit -p tsconfig.app.json` filtered | **PASS** — 0 errors |
| 3 | AC: each new dim groups + repivots via scope | `it.each` specs: all six dims repivot; scope mapping `sigtype-/dir-/sector-/ind-/captier-/sigstatus-` | **PASS** |
| 4 | AC: '—' group doesn't corrupt scope | spec: '—' leaves statsScope, no jump button; '!!!' un-sluggable same | **PASS** |
| 5 | AC: existing group-bys unchanged; 'all' fallback preserved | pre-existing specs all green; `groupedTrades` 'all' fallback + `effectiveScope` untouched | **PASS** |
| 6 | Manual UI check | user eyeballed `trading/paper` on dev server 4210 | **PASS** |

## Notes

- Page now sends `includeAutoPaper: true` — auto-paper trades will appear
  in the trade list once the pipeline is enabled (config still unwritten).
- `tradesByDirection` buckets non-signal trades under '—' so group
  membership matches the `dir-*` stats docs (signal trades only).
- Deferred (recorded in review doc): `effectiveScope` silently falls back
  to `all` when a scope doc is missing — indistinguishable from "all has
  no data". Candidate for the forensics follow-up.
- Equity curve showing nothing for `all` is expected while `stats-all`
  has no `equityCurve` points — orthogonal to this task.
