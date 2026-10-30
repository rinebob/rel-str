**Topic:** Scanner Chart View  
**Topic Slug:** chart-review  
**Thread:** Chart View Extension  
**Thread Slug:** scanner-chart-view  
**Issue:** #1342  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1260  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# UAT — #1260 Retire chart-review (redirect + dead-code removal)

## Scope

Retire the legacy chart-review surface after the chart-view page
(#1256–#1259) became canonical:

- `signals/charts` redirects to `trading/chart-view`.
- `AppRoutes.CHART_REVIEW` enum + `PAGE_INFO` entry removed.
- `chart-review` page, `review-header`, `new-symbols-dialog` components and
  sole-consumer services deleted.
- TriageStore viewport state removed; live `reviewFlags` surface retained.
- Shared consumers (`RunMetricsStripComponent`, `SignalReviewFacade`)
  retained.
- Verify scripts updated so deleted files don't crash the relay chain.

## Prerequisites

- Repo at the #1260 changeset (uncommitted at QA time — worktree state).
- `npm install` done; jest/tsx available via `npx`.
- For runtime scenarios: `npx ng serve` running on `http://localhost:4200`
  and a signed-in session (chart-view sits behind `authGuard`).

## Scenarios

### S1 — Route redirect (automated)

- **Confirms:** `signals/charts` → `trading/chart-view` redirect registered.
- **Steps:** `npx jest --coverage=false core-routes`
- **Expected:** suite passes; the redirect table entry
  `{ from: 'signals/charts', to: 'trading/chart-view' }` asserts green, and
  the leaf table no longer contains `signals/charts` as a component route.
- **Result:** PASS — core-routes spec green in full-suite run

### S2 — `AppRoutes.CHART_REVIEW` removed (automated)

- **Confirms:** enum member + `PAGE_INFO` entry deleted; no survivors.
- **Steps:** `grep -rn "CHART_REVIEW" src/` → expect **zero** hits;
  `npx tsc --noEmit` → no new errors beyond the 3 pre-existing
  (`scripts/bulk-swing-sweep.ts` ×2, `indicator-config-dialog.component.ts`).
- **Expected:** `Record<AppRoutes, PageInfo>` exhaustiveness makes removal
  compile-enforced.
- **Result:** PASS — zero `CHART_REVIEW` hits in src/scripts/functions; `tsc` clean except 3 pre-existing

### S3 — Deleted files absent (automated)

- **Confirms:** page/components/services/specs removed from disk.
- **Steps:**
  `ls src/app/features/savant-trader/pages/chart-review src/app/features/savant-trader/components/review-header src/app/features/savant-trader/components/new-symbols-dialog src/app/features/savant-trader/services/chart-review-viewport.service.ts src/app/features/savant-trader/services/new-symbols-dialog.service.ts`
- **Expected:** every path reports "No such file or directory".
- **Result:** PASS — all five paths report "No such file or directory"

### S4 — Verify relays don't crash on deleted files (automated)

- **Confirms:** `scripts/verify` scripts no longer read deleted artifacts.
- **Steps:**
  `npx tsx scripts/verify/design-system-widget-migration-1114.ts` and
  `npx tsx scripts/verify/design-system-foundation-migration-1171.ts`
- **Expected:** 1114 → `33/33 checks passed`; 1171 → `104/104 checks passed`.
  No `ENOENT` on `review-header`/`chart-review` paths.
- **Result:** PASS — 1114: 33/33; 1171: 104/104

### S5 — Full regression suite (automated)

- **Confirms:** no spec referenced deleted modules; shared behavior intact.
- **Steps:** `npx jest --coverage=false`
- **Expected:** all suites pass (baseline at implement time: 281/281,
  4845/4845).
- **Result:** PASS — 281/281 suites, 4850/4850 tests

### S6 — Old URL lands on chart-view (manual)

- **Confirms:** real runtime redirect; bookmarks/deep links keep working.
- **Steps:** `npx ng serve`; sign in; navigate the address bar to
  `http://localhost:4200/signals/charts`.
- **Expected:** URL rewrites to `/trading/chart-view`; the Chart View page
  renders with the scan/list dropdowns in the toolbar and the symbol pane.
- **Result:** PASS — user confirmed `/signals/charts` rewrites to `/trading/chart-view` and renders

### S7 — Deep-link boundary cases (manual)

- **Confirms:** unknown sub-paths don't resurrect the old page.
- **Steps:** visit `http://localhost:4200/signals/charts/xyz`
- **Expected:** wildcard route sends user to `/` (not a blank page, not the
  old review UI).
- **Result:** PASS — user confirmed bad sub-path lands on `/` → login page (authGuard chain); wildcard `**` → `/` verified in core-routes.ts:284

### S8 — Signal-review page still works (manual)

- **Confirms:** retained `SignalReviewFacade`/`SignalReviewHeader` consumers
  unaffected by the deletion.
- **Steps:** navigate to `/signals/review` (signal-review page); confirm the
  header renders with the disabled Review pill and Order pill.
- **Expected:** page loads, no console errors about missing components/stores.
- **Result:** PASS — user confirmed signal-review page renders clean ("looks fine")

### S9 — Dashboard still renders run-metrics strip (manual)

- **Confirms:** retained `RunMetricsStripComponent` consumer unaffected.
- **Steps:** open the runs dashboard; confirm the metrics strip renders.
- **Expected:** strip present with data; no console errors.
- **Result:** PASS — user confirmed runs dashboard metrics strip renders, no console output

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `signals/charts` → `trading/chart-view`; `CHART_REVIEW` removed | S1, S2, S6, S7 |
| `ChartReviewComponent`/`ReviewHeaderComponent`/spec deleted | S3, S5 |
| Sole-consumer services deleted; shared consumers kept | S3, S5, S8, S9 |
| Nav renamed "Chart View" | S6 (nav entry visible on landing) |
| Full jest + build | S5 (+ `ng build` — pre-existing ds-gallery budget error noted) |
| Verify scripts don't crash | S4 |

## Regression / smoke

- Signal-review page loads (S8).
- Dashboard metrics strip renders (S9).
- `ng build` compiles — exits non-zero only on the pre-existing
  `ds-gallery.component.scss` 28.76 kB vs 25 kB style budget from #1217
  (unrelated; tracked separately).
- TriageStore `reviewFlags`/`reviewCount` still feed the signal-review
  header pill (S8 — pill renders, disabled by design since #1016).

## Results log

- S1 route redirect spec — PASS (core-routes suite in full run)
- S2 CHART_REVIEW removed — PASS (zero hits; tsc clean but for 3 pre-existing)
- S3 deleted files absent — PASS (5/5 paths ENOENT)
- S4 verify relays — PASS (1114: 33/33; 1171: 104/104)
- S5 full jest — PASS (281/281, 4850/4850)
- S6 runtime redirect — PASS (user: "navs to trading/chart-view no prob")
- S7 deep-link boundary — PASS (user: "lands on login page" = `**`→`/`→authGuard)
- S8 signal-review page — PASS (user: "looks fine")
- S9 dashboard metrics strip — PASS (user: "lgtm, nothing in console")

**QA verdict: PASS — all scenarios green, no findings.**
