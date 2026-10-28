**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1300  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1258  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1258 FE-IMPL: LatestRunStore + scan dropdown + New-only toggle

Acceptance guide for the scan-source feature on `/trading/chart-view`: the Scan dropdown populated from `st-scanner/latest-runs/items` cache docs, `scan:{recipeId}` pane sources resolving cached row tickers, and the New-only toggle filtering tracked symbols (default on, scan-only).

## Scope

- `LatestRunStore` — cache read into `Map<recipeId, ScanLatestRun>`, drift-tolerant
- Scan dropdown — one option per catalog recipe with a cache doc, `{title} · {ranAt}` + `{rows}/{total}` cap labels
- `scan:{recipeId}` viewport source — cached row tickers as pane symbols
- Scan↔list mutual exclusivity (single active-source slot)
- New-only toggle — default ON, filters tracked rows, scan sources only
- Selection recovery — escaped selection advances to dropped-index neighbor / clears

## Prerequisites

- Dev server running (`npm start` → app on `http://localhost:4200`, observation API on `:3456`)
- Authenticated session with access to the `rel-str` Firebase project
- At least one discovery scan has been run since #1257 deployed (writes a cache doc to `st-scanner/latest-runs/items/{recipeId}`). Confirmed present from earlier in this thread; verify in the Firebase console under `st-scanner` → `latest-runs` → `items` if the Scan dropdown is empty.
- Tracked symbols exist in the universe (needed to observe New-only filtering)

## Start instructions

1. `npm start` (or confirm the already-running server on `http://localhost:4200`)
2. Navigate to `http://localhost:4200/trading/chart-view`
3. The merged toolbar is at the top: **Scan** dropdown, **List** dropdown, indicator menu, chart controls, filing chips, right action group (`[ ] New only` pill, symbol input, Trade / Order / Add)

## Scenarios

### S1 — Automated: store + service cache read (jest)

- **Confirms:** AC1 (Map load + drift skip), part of AC2 (option derivation), cold cache
- **Steps:** `npx jest src/app/features/savant-trader/stores/latest-run.store.spec.ts src/app/features/savant-trader/services/scanner.service.spec.ts --coverage=false`
- **Expected:** all tests pass; specs pin `collection('st-scanner/latest-runs/items')`, per-doc `parseScanLatestRun` drift-skip, doc-id↔recipeId guard, failed-read keeps prior snapshot, unparseable-ranAt option skip
- **Result:** PASS — 2/2 suites, 23 tests (executed 2026-10-28)

### S2 — Automated: viewport scan source + New-only (jest)

- **Confirms:** AC3/AC4/AC5 (source resolution, filter on/off, list-source immunity), cold-cache pane, dedupe, lazy tracked load
- **Steps:** `npx jest src/app/features/savant-trader/services/chart-view-viewport.service.spec.ts --coverage=false`
- **Expected:** all pass — `scan:{id}` never masks to ALL, rows→tickers deduped, New-only default on removes tracked rows / off restores all in scan order, list sources unaffected, scan + NO_MEMBERSHIP lazily load the tracked universe
- **Result:** PASS — 1/1 suite, 13 tests (executed 2026-10-28)

### S3 — Automated: toolbar + page wiring (jest)

- **Confirms:** AC3 (mutual exclusivity), AC6 (neighbor-advance escape), dropdown states, clear sentinel
- **Steps:** `npx jest src/app/features/savant-trader/components/chart-view-toolbar src/app/features/savant-trader/pages/chart-view --coverage=false`
- **Expected:** all pass — `—` leads scan options and clears an active scan (no-op on list sources), ghost-scan keeps menu enabled + label, pill enabled only on scans, single source slot, escape guard advances to dropped-index neighbor and clears on empty viewport
- **Result:** PASS — 2/2 suites, 35 tests (executed 2026-10-28)

### S4 — Live: Scan dropdown populates from cache docs

- **Confirms:** AC2 (one option per catalog recipe with a doc, ranAt staleness)
- **Starting state:** dev server running, logged in, at least one cache doc exists
- **Steps:**
  1. Open `/trading/chart-view`
  2. Click the **Scan** dropdown (leftmost control in the toolbar)
- **Expected:** menu lists one item per recipe that has a cache doc — format `{Recipe Title} · {Mon D, H:MM AM/PM PT}` (e.g. `Quality Large · Oct 27, 5:30 PM`); a `—` entry leads the list; recipes with no cache doc are absent; if a run was truncated the label ends `· {rows}/{total}`
- **Negative:** with zero cache docs the Scan menu is disabled and the List menu still works (observable by temporarily having no docs — skip if cache is populated)
- **Result:** PASS (user-confirmed 2026-10-28) — menu populates with cached recipes. Defect found: default `mat-menu` 280px max-width clipped the `{title} · {ranAt}` labels → widened the shared panel to `min(480px, 90vw)` (`rh-select-menu-panel` class + `styles.scss` rule). Awaits visual re-confirm.

### S5 — Live: selecting a scan source swaps the pane

- **Confirms:** AC3 (scan source → cached symbols)
- **Steps:** from S4, pick a scan option whose cache doc has rows
- **Expected:** left symbol pane swaps to the scan's row tickers in scan order; the Scan trigger shows the picked label; the List trigger shows `All` (unchecked); first symbol auto-selects and its D/W/M charts load
- **Scope boundary:** untracked (new) symbols have no `symbol-data` docs — the chart area shows "no price data available" until **#1259 (RH equity historicals + ChartStore tracked/untracked fork)** lands. That is the next task in this blueprint, not a #1258 defect. Tracked rows chart normally. (#1308 covers overlapping untracked-chart work under SAVANT-TRADER — reconcile before implementation.)
- **Result:** pane-swap portion PASS (user-confirmed — scan rows populate the pane); chart-data portion N/A pending #1259.

### S6 — Live: scan↔list mutual exclusivity

- **Confirms:** AC3 (selecting a list clears the scan source)
- **Steps:** with a scan active (S5), open the **List** dropdown and pick a list (e.g. Primary or a user list)
- **Expected:** pane swaps to the list's members; the Scan trigger returns to `—`; list items show the picked list checked
- **Result:** PASS (user-confirmed 2026-10-28)

### S7 — Live: New-only toggle behavior

- **Confirms:** AC4/AC5 (default on filters tracked, off shows all, scan-only)
- **Steps:**
  1. With a scan active (S5): `[x] New only` is checked and enabled. If any scan tickers are tracked, they are absent from the pane
  2. Click the pill → `[ ] New only`: all cached rows appear including tracked ones, in original scan order; click again → tracked rows leave
  3. Switch to a list source: pill becomes disabled and unchecked; the list is never filtered by it
- **Expected:** as above — tracked symbols appear/disappear with the toggle, only on scan sources
- **Result:** PASS (user-confirmed 2026-10-28)

### S8 — Live: selection advances when the selected symbol leaves the filter

- **Confirms:** AC6 (dropped-index neighbor advance)
- **Steps:** scan active, New-only ON. Toggle OFF, select a tracked symbol mid-pane, toggle ON
- **Expected:** selection moves to the symbol that slid into the dropped slot (its former neighbor) — not the pane head, and selection is never left pointing at a hidden symbol
- **Boundary:** if the hidden symbol was last in the pane, selection moves to the new tail; if the pane empties entirely, selection clears and no auto-select fires
- **Result:** PASS (user-confirmed 2026-10-28)

### S9 — Live: nearby regression sweep

- **Confirms:** no regression to existing chart-view behavior (#1256)
- **Steps:**
  1. List source active — filing chips toggle list membership; symbol drops out of a NO_MEMBERSHIP/exclusive pane → selection advances (existing queue behavior)
  2. Type a symbol in the manual input → charts load; pill/dropdowns unaffected
  3. D/W/M pills, range pills, indicator menu, Trade/Add buttons — all still functional
- **Expected:** everything behaves exactly as before #1258
- **Result:** PASS (user-confirmed 2026-10-28)

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Map load + drift skip | S1 |
| Option per catalog recipe + ranAt staleness + cap | S1, S4 |
| Scan select swaps pane; list clears scan | S3, S5, S6 |
| New-only ON filters tracked / OFF all rows | S2, S7 |
| Toggle scan-only; lists unaffected | S2, S7 |
| Escape → dropped-index neighbor / clear | S3, S8 |
| Unit specs per TEST-FE | S1–S3 |
| Cold cache / ghost scan / edge cases (TEST-FE) | S1–S3, S4 negative |
| No regression to #1256 page | S9 |

## Refinement pass (manual, user-facing surface)

The Scan dropdown and `[x] New only` pill are new toolbar UI — check: menu alignment with the List dropdown, label truncation on long recipe titles, disabled state styling, pill affordance consistent with the D/W/M pill group, no layout shift when the Scan menu is disabled (cold cache).

## Results log

- 2026-10-28 — S1–S3 automated evidence collected: 5/5 suites, 71/71 tests pass on the final tree (typecheck clean; full suite 270/270, 4,678).
- 2026-10-28 — Live pass with user: S4 PASS (dropdown populates; width defect found → fixed in-tree, pending visual re-confirm). S5 pane-swap PASS; chart data for untracked symbols is scope-boundary → #1259. S6–S9 not yet exercised. Decisions: tri-state New/Tracked/All filter declined (binary New-only retained); company names + row data filed as CHORE #1313 (4_BACKLOG, blueprint #1249).
- 2026-10-28 — Refinement: `[x]`-bracket affordance rejected → New-only restyled as a real pill toggle (fiber_new icon, DS active state, aria-pressed), matching log-scale-pill/D-W-M conventions. Toolbar suite 18/18, typecheck clean.
- 2026-10-28 — Refinement: new scan rows were indistinguishable from tracked → untracked pane symbols now carry the existing `NEW` chip (page passes `untrackedPaneSymbols` into the list's `newSymbols` input; empty on list sources). Spec'd; page suite 18/18.
- 2026-10-28 — **All scenarios PASS** (user: "all uat passes — looks really good"). Refinement pass complete: scan menu, New-only pill, NEW chips all consistent with nearby UI. Gate resolved → QA PASS.
