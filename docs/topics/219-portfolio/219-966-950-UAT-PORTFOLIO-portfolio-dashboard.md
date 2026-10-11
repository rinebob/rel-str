**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio-dashboard  
**Thread:** Extend Gallery UI to Portfolio Page  
**Thread Slug:** portfolio-gallery-view  
**Issue:** #966  
**Thread Parent:** #926  
**Topic Parent:** #219  
**Task:** #950  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# UAT — portfolio-v2 page shell + facade + UI store (#950)

Manual acceptance pass against `http://localhost:4200/portfolio-v2`
(logged-in dev session, live agentic account). Executed by the user;
results confirmed in-session 2026-10-11.

## Scenarios

| # | Scenario | Result |
|---|----------|--------|
| S1 | Navigate to `/portfolio-v2` — page loads behind auth, lazy-loads; `portfolio/v2` and unregistered paths fall through to `/portfolio` | PASS |
| S2 | Summary strip shows real account values — total value, equity, cash, buying power, day P&L, unrealized P&L, unprotected count | PASS |
| S3 | One stub card per held position — symbol, LONG/SHORT, `qty @ avg cost`, mark, P&L at 2 decimals | PASS |
| S4 | Closed / zero-quantity records never render (the `0 @ —` entries seen on first pass are gone after the `closed` filter) | PASS |
| S5 | All / Long / Short side pills filter the grid; card count shows `N / M` | PASS |
| S6 | Group dropdown lists Bucket → Sector → Industry → Market Cap → None (selection inert until #951 — expected) | PASS |
| S7 | List dropdown populates from the symbol-list catalog on a cold load | PASS |
| S8 | Chart D/W pill toggles interval + resyncs | PASS |
| S9 | Refresh reloads the pipeline and re-renders positions | PASS |
| S10 | Page states render distinctly — loading spinner, error + retry, no-agentic-account, no-positions, filtered-empty, per-slice warn banner | PASS |
| S11 | Summary strip + cards legible at a glance; tabular-nums consistent with v1 account summary | PASS |

## Notes

- Day-P&L short sign, closed-position filter, per-slice warn banner,
  zero-account state, and list-catalog loading were all found by code
  review and remediated before this pass — spec-pinned in the unit
  suite (57 gallery specs + 70 route specs green).
- The stub grid is intentional — the real `PositionCard` component,
  grouped expandos, card charts, and action buttons land in #951–#953.

## Result

**PASS** — user-confirmed 2026-10-11 ("looks good qa passes").
No open findings; deferred items are all #951+ scope.
