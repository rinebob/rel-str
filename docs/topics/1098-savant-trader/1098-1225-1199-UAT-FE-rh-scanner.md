**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1195  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Task:** #1199  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #1199 Page rebuild (auto-run overview)

QA issue: #1225. Review doc:
`1098-1195-1199-CODE-REVIEW-FE-rh-scanner.md` (PASS, 3 rounds —
converged. R1 reauth-banner MED → re-fire wave on reauth; R2 rail+detail
rework remediation; R3 hygiene: arm-time `errorKind` clear, `idleRun`
fallback, `ScanSort` reuse, 12-recipe doc counts).

## Rework re-QA (post-visual pass — rail + detail layout)

The first visual pass REJECTED the stacked-tables layout. The page was
reworked to a user-approved **scoreboard rail + detail** layout
(left rail = one scoreboard row per recipe with status dot / count /
top-4 baseline tickers; right pane = selected recipe's full table).
This section is the QA record for the reworked page.

### R1. Focused suites green — PASS

`npx jest pages/scanner utils/scanner-rows.util.spec
utils/scanner-sort.util.spec stores/scanner.store.spec
services/scanner.service.spec --coverage=false` (fresh run, post-R3):
**7/7 suites, 123/123 tests** — 14 page specs (rail entries, selection,
stale-count under refresh, detail-error + retry, truncation text) +
recipe-table, compare-panel, both utils, store (incl. the new
arm-clear spec), service. NG0914 zoneless warnings are known repo noise.

### R2. `tsc --noEmit` — PASS

Zero diagnostics post-R3.

### R3. Semantics vs. reworked surface — PASS

| Requirement | Evidence |
|---|---|
| Rail + detail: one table at a time, selection not stacking | Spec'd: one `app-scanner-recipe-table`, bound to `runs()[selectedId]`; click updates selection + `aria-current` |
| Sticky scan metadata (was: banner not sticky) | `.rail { position: sticky }`; each row shows status dot / `N / M` or `err` / top-4 tickers |
| Rail tickers = table's top rows | `baselineSortedRows` in `scanner-sort.util` is the single shared pipeline (same seed levels as the table's `seedSortLevels`) |
| Stale count under refresh | Spec'd: retained `N / M` while loading w/ prior result; `…` only when no result; `err` on failure |
| Single vertical page scroll | Spec'd: `.content-column` direct children, no `.table-scroll`; `.detail` allows `overflow-x` only |
| Full width | `.content-column { max-width: none }` — 1100px cap lifted |
| `filters_applied` rendered | `appliedFilterSummary` in `scanner-rows.util`; quiet line under recipe title, ellipsis + hover; guards drifted fields |
| Numeric formatting | `displayCell`: T/B/M abbrev ≥1e6, separators ≥1e3, 2dp ≥1, 4-sig-fig <1; non-numeric + declared `percentColumns` untouched; sorting still uses raw values |
| Truncation disclosure | Spec'd: header `first N of M` when wire page capped |
| Reauth arm-clear | Spec'd: `runAllRecipes` clears `errorKind` at arm — banner drops with zero timers elapsed |
| Silent-skip preserved; selected-failure surface | Spec'd: errored recipes red in rail; selecting one shows named "Scan failed" note + Retry (the table renders nothing on error) |
| Retired surface stays retired | `mat-select` / compare-panel / history / focus plumbing still absent |

### R4. Diff footprint — PASS

- MOD: `pages/scanner/scanner.component.{ts,html,scss,spec.ts}`,
  `pages/scanner/scanner-recipe-table.component.{ts,html,scss,spec.ts}`,
  `utils/scanner-rows.util.ts`, `utils/scanner-sort.util.ts`,
  `stores/scanner.store.ts`, `stores/scanner.store.spec.ts`
- DEL: `pages/scanner/proto/` (prototype scaffolding)
- DOC: IMPL/TEST as-built sync, CODE-REVIEW R2+R3, UAT (this doc)

Concurrent-session work (order/gallery/theme) excluded — untouched.

### R5. Visual pass — PASS (user-confirmed)

The first pass rejected stacked tables; the rail+detail rework plus
three live-fix rounds passed the user's browser checks:

1. Rail + detail layout — approved
2. Scroll region — moved from the page into the table: `.table-scroll`
   inside the recipe table is the bounded scroll container; `thead`
   sticks under `dense-table`'s `position: sticky`. The recipe head
   (title/count/refresh) and rail stay fixed. Three defects found and
   fixed along the way: `.scanner-main` flex-shrink trapped the scroll
   inside `.detail`; `.content-column` `content-box` sizing pushed the
   scrollbar 32px off-viewport; `color-scheme:dark` + OS overlay
   scrollbars hid the bar → `overflow-y: scroll` + `::-webkit-scrollbar`
   styling on `.table-scroll`.
3. Final user verdict: "ok wow thats so much better"

## Verdict: **PASS**

---

## Original run (superseded — stacked-tables layout)

QA issue: #1225. Review doc:
`1098-1195-1199-CODE-REVIEW-FE-rh-scanner.md` (PASS, 1 round — convergent
reauth-banner MEDIUM fixed by re-firing the wave on successful reauth;
LOWs all remediated or accepted).

## Scenario results

### 1. Focused suites green — PASS

`npx jest pages/scanner --coverage=false` (fresh run, post-review
remediation): **3/3 suites, 41/41 tests** — 13 page specs + 14
recipe-table + 14 compare-panel (the latter two unchanged from
#1197/#1141). NG0914 zoneless warnings are known repo noise; the
forced-exit worker message is the known teardown artifact — all tests
reported pass.

### 2. `tsc --noEmit` — PASS

Zero diagnostics on `tsconfig.app.json` post-remediation.

### 3. Semantics vs. checklist + IMPL §3/§4 + TEST plan — PASS

| Checklist | Evidence |
|---|---|
| `ngOnInit`: `runAllRecipes` + `loadTrackedSymbols` + 15-min interval; `ngOnDestroy` clears | Spec'd: init calls both; `advanceTimersByTime(15m)` re-fires (literal `REFRESH_MS` pins the PRD cadence — deliberately not the component const); destroy → 3×15min yields zero further calls |
| Header: Run all disabled while loading + last-refresh (max ranAt) | Spec'd: click delegates, `disabled` toggles on `runsLoading`, readout matches `DatePipe` oracle on the later of two ranAts, hidden pre-run |
| AUTH banner when `authFailed()` | Spec'd: banner absent → `authFailed.set(true)` → banner + Re-authorize → `reauthenticate` + `clearError` + **`runAllRecipes` re-fires** (review remediation — the wave's relaunch clears per-recipe `errorKind`, dismissing the banner and refilling tables) |
| One table per recipe, catalog order, `[run]` bound, `(refresh)`→`refreshRecipe`, single scrollbar | Spec'd: `recipe().id` order = catalog order; tables are direct `.content-column` children, no `.table-scroll`; a live `runs.set()` propagates to the table input; `refresh.emit()` carries the recipe id |
| Removed: picker, Run/Evaluate, compare, history, focus plumbing | Spec'd absent (mat-select / compare-panel / .history / button labels); members deleted from the component; compare-panel files remain on disk |
| Spec rewrite per TEST plan | All TEST-plan bullets map to specs (init/destroy, catalog order + scroll, gate + max-ranAt, banner + refresh wiring, retired surface); all-fail edge case spec'd (header + Run-all survive, zero `<table>`s) |

E2E journeys 1–4 (TEST doc): covered at spec level — stagger/fill
(journey 1) is store-spec'd (#1198 UAT); click-cycle sort is
recipe-table-spec'd (#1197 UAT); 15-min re-fire + per-table refresh
(journey 3) and auth banner + silent-skip (journey 4) are spec'd here.

### 4. Diff footprint — PASS

- MOD: `pages/scanner/scanner.component.{ts,html,scss,spec.ts}` (rewrite)
- DOC: IMPL §3/§4 as-built sync, CODE-REVIEW (this thread), UAT (this doc)

No other scanner files touched; concurrent-session work excluded.

### 5. Manual / visual verification — pending user confirmation

A live dev stack is already running (Angular :4200 + observation API
:3456 — both confirmed answering). A browser preview was opened for the
user to eyeball `/trading/scanner`: single vertical page scrollbar, no
inner scroll traps, and wide-table horizontal behavior (jsdom cannot
verify CSS overflow). Deferred to the user's pass; jsdom-level layout
(tables direct in `.content-column`, no inner scroll wrappers) is
spec'd.

## Verdict: **PASS** (visual pass pending user eyeball)

#1199 mounts the auto-run overview: init wave + 15-min cycle, per-recipe
stacked tables, Run-all gate, last-refresh readout, and the reauth
banner that re-fires the wave on success. The retired single-run
surface is gone from the page; machinery retained in the store.
