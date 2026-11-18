**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1331  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1305  
**Domain:** SAVANT-TRADER  
**Area:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-11-17  

# UAT — #1305: Scanner page filter — All/New/Tracked header control

## Scope

Acceptance criteria from #1305 and PRD §4 (filter behavior), plus the
review-remediation surfaces (tracked-universe readiness gate):

- Tri-state `All | New | Tracked` pill control in the scanner header;
  `All` is the default; `aria-pressed` on the active segment.
- `New` shows only rows whose symbol is NOT in the tracked universe;
  `Tracked` shows only members; `All` restores everything.
- Filtering applies to BOTH the scoreboard rail (counts + top tickers)
  and the detail table, through the shared `scanRunRows` pipeline.
- `0 / M` for a recipe whose filtered set is empty; the detail table
  shows the 'No matching symbols' empty state, not a crash.
- The filter survives switching the rail selection; the `first N of M`
  capped-page disclosure is preserved.
- New/Tracked pills stay **disabled** until the tracked universe
  resolves; on a load failure they remain disabled and a snackbar
  reports the failure; a later successful load enables them.
- Filtered rail counts carry a `countTitle` tooltip
  ("N of M scan hits match the {filter} filter"); the detail-table
  header count carries the equivalent qualifier.

## Prerequisites

- Angular dev server: `npm start` (serves `http://localhost:4200`).
- RH MCP observation API reachable (`127.0.0.1:3456`) and an
  authenticated Robinhood session — required for real scan results.
  If the session is expired the reauth banner is the expected behavior.
- Alternatively, the jest specs at
  `src/app/features/savant-trader/pages/scanner/scanner.component.filter.spec.ts`
  and `.../stores/symbol-list.store.spec.ts` pin the same behavior at
  the component/store boundary (executed fresh below as evidence).

## Start

1. `npm start`, open `http://localhost:4200/trading/scanner`.
2. Wait for the initial scan wave to complete (rail rows populate with
   counts/tickers; this can take ~30-60s on a cold session).

## Scenarios

### S1 — Control renders, default = All

- **Steps:** Load the page. Inspect the header pill group
  (`[data-testid="symbol-filter"]`) next to Run all.
- **Expect:** three segments `All · New · Tracked` in that order; `All`
  is active (`aria-pressed="true"`); the pill styling matches the
  chart-toolbar toggle idiom.
- **Evidence:**

### S2 — New filters rail + table

- **Steps:** With the universe resolved (New/Tracked enabled), click
  `New`. Read the rail counts and the selected recipe's table.
- **Expect:** rail counts drop to the untracked-only totals (`N / M`
  where N ≤ the All count); rail top tickers list only symbols without
  tracked badges; the table shows only rows whose badge reads `new`.
- **Evidence:**

### S3 — Tracked inverts; All restores

- **Steps:** Click `Tracked`, then `All`.
- **Expect:** under `Tracked` the rail/table show only tracked-badge
  rows; under `All` the original unfiltered counts and rows return.
- **Evidence:**

### S4 — Empty filtered set

- **Steps:** Under `New`, find (or wait for) a recipe whose hits are
  all tracked; if none exists, trust spec coverage
  (`scanner.component.filter.spec.ts` "zero untracked hits").
- **Expect:** rail count `0 / M`; table renders 'No matching symbols',
  not a crash or stale rows.
- **Evidence:**

### S5 — Filter survives rail switching + applies page-wide

- **Steps:** Select `New`, then click a different rail recipe.
- **Expect:** the newly selected table is already filtered; every rail
  row's count reflects the filter simultaneously.
- **Evidence:**

### S6 — Readiness gate (loading window)

- **Steps:** Hard-reload the page and observe the pills during the
  first moments (before `loadTrackedSymbols` resolves). On a warm
  session this window may be too fast to see — the jest specs pin it.
- **Expect:** New/Tracked disabled (greyed); `All` usable; hovering the
  group shows the "needs the tracked-symbol universe" tooltip; pills
  enable when the universe resolves.
- **Evidence:**

### S7 — Failure surface

- **Steps:** (Optional, needs DevTools) block/throttle the
  `getTrackedSymbols` callable in the Network panel and reload.
- **Expect:** snackbar 'Failed to load tracked symbols — list filters
  and badges may be stale'; New/Tracked stay disabled; the scoreboard
  under `All` still works.
- **Evidence:**

### S8 — Count tooltips

- **Steps:** With a filter active, hover a rail count; hover the
  detail-table header count on a capped result.
- **Expect:** rail tooltip "N of M scan hits match the {filter}
  filter"; table header tooltip carries the same qualifier plus the
  capped-page note when applicable.
- **Evidence:**

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Tri-state control, All default, aria-pressed | S1 |
| New/Tracked/all semantics on rail + table | S2, S3 |
| `0 / M` + empty state | S4 |
| Survives rail switching; page-wide | S5 |
| `first N of M` preserved | S2 (visual), S8 |
| Readiness gate (disabled until ready, error stays disabled) | S6, S7 |
| `countTitle` qualifiers | S8 |
| Sort seed preserved | S2 (rows remain baseline-sorted) |

## Regression smoke

- Refresh button per-recipe still re-runs and re-renders under the
  active filter.
- Run all + 15-min refresh interval unaffected (covered by main spec).
- Reauth banner path unaffected (spec-pinned).

## Results log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| S1 | Control renders, All default | PASS | User visual confirmation 2026-11-17 (`/trading/scanner` dev server); spec pins tri-state + `aria-pressed` |
| S2 | New filters rail + table | PASS | User visual confirmation; spec `new filters rail counts + tickers` |
| S3 | Tracked inverts; All restores | PASS | User visual confirmation; spec `tracked inverts; all restores` |
| S4 | `0 / M` + empty state | PASS | Spec `zero untracked hits shows the empty state` — `0 / 2` + 'No matching symbols' |
| S5 | Survives rail switching | PASS | User visual confirmation; spec `filter survives switching the rail selection` |
| S6 | Readiness gate (loading) | PASS | Spec `pills stay disabled while the tracked universe is loading` — All usable, New/Tracked gated until `ready` |
| S7 | Failure → snackbar + disabled + retry | PASS | Store spec `observable failure → error status + snackbar, and a later call retries` (live error channel — `getTrackedSymbols$` propagates after the pass-2 fix) |
| S8 | Count tooltips | PASS | User visual confirmation; spec `filtered rail count carries a title` + `headCountTitle` on the table header |

Fresh targeted run at QA time: **57/57 green**
(`scanner.component.filter` + `scanner-rows.util` + `symbol-list.store`).

## Findings

None — all scenarios pass; no BUG/CHORE items filed.
