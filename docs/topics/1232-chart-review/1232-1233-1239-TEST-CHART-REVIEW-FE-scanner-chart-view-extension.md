**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1239  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Domain:** CHART-REVIEW  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-01-30  
**Last Updated:** 2026-01-30  

# Test Plan (FE): Chart View page

## E2E User Journeys

Manual/UAT-verified (no Cypress in this stack):

1. **Browse a list** — open `trading/chart-view` → list dropdown → pick PRIMARY → pane shows members → selecting a symbol renders three D/W/M charts with the full current indicator display (zones, trend-rider dots).
2. **Browse a scan** — after a scanner run, open the page → scan dropdown shows recipes with `· {ranAt}` → pick one → pane shows the scan's symbols (non-tracked only with "New only" on) → select a symbol → charts render from RH bars, no ST indicators, filing chips hidden.
3. **Toggle tracked visibility** — with a scan source active, flip "New only" off → tracked symbols from the scan appear; flip on → they disappear. List sources are unaffected.
4. **Trade from the page** — select any symbol → Trade → the manual order dialog opens seeded with the symbol; order count pill reflects staged tickets; Order pill navigates to the order page.
5. **Add to tracked** — click Add → "coming soon" snackbar; no writes.
6. **Triage session** — select several symbols → previously viewed symbols render dimmed in the pane; refresh the page → dimming resets.
7. **Legacy route** — `signals/charts` redirects to `trading/chart-view`.

## Integration Tests

Jest + TestBed (the repo's component-spec conventions; Firebase tokens stubbed per AGENTS.md):

- `ChartViewComponent` + stubbed stores:
  - source switching — picking `scan:{id}` populates pane symbols from the mocked `LatestRunStore`; picking a list clears the scan source (one active source)
  - pane renders scan-row tickers; selecting a symbol drives `SignalDetailComponent`
  - Trade button enabled with a symbol selected; calls `manualOrderService.open(symbol)`
  - Add-to-tracked → snackbar; no service call
  - viewed-dim: selecting symbols adds them to the dim set and re-renders
  - scan dropdown options carry `{title} · {ranAt}` labels
- `ChartViewToolbarComponent` — control ordering per spec (scan dropdown, list dropdown, indicators | symbol+name | chart controls | right group); dead review-header elements absent; emits/writes the correct `ChartToolbarStateService` mutations
- `ChartToolbarStateService` ↔ `SignalDetailComponent` — service state drives charts (interval change re-renders); `showToolbar=false` hides the in-template toolbar; `showToolbar=true` default keeps the standalone path working
- `ChartStore` fork — tracked symbol → `ChartService.loadBars$` called, indicator load triggered on version; untracked → `RhChartService.loadBars$` called, `symbolDataVersion` stays `''`, `indicatorStore.loadIfNeeded` NOT called
- `LatestRunStore` — `load()` maps docs → `latestRuns` map; `scanOptions` yields an option per cached recipe; drifted doc skipped

## Unit Tests

- `ChartViewViewportService.viewportSymbols`: `ALL` union, list-key members, `NO_MEMBERSHIP` untriaged, `scan:{id}` rows → tickers; New-only filter on/off against the tracked set; scan + list source exclusivity
- `isScanSource`/`scan:` key parse — `scan:quality-large` → `quality-large`; list keys never collide (list keys can't contain `:` by construction — assert the convention or guard)
- `ScannerService.saveLatestRun` — `setDoc` called at `st-scanner/latest-runs/items/{recipeId}` with serialized doc; failure → warn only, never rejects the run
- `ScannerStore` call sites — `launchRecipe` success and `runScan` success each invoke `saveLatestRun` once; `evaluateTracked` never does
- `RobinhoodMcpClient.getEquityHistoricals` — tool name/args mapping (`symbols`, `start_time`, `interval`, `bounds`, `adjustment_type`); bars → `OhlcBar` mapping; `interpolated` handling; error propagation
- `RhChartService` — three interval calls assembled into the `{daily, weekly, monthly, version: ''}` shape
- `ChartToolbarStateService` — `applyIndicatorSelection` semantics ported from `onToggleIndicator` (in-scope intervals only, all-or-nothing checked state, atomic write); scope follows layout (triple → D/W/M, single → active)

## Test Seams

- Highest: `ChartViewComponent` TestBed with stubbed `SymbolListStore`/`LatestRunStore`/`ChartStore`/`OrderTicketStore`/`ManualOrderService` — covers source switching, toolbar wiring, and action plumbing without touching Firestore or RH.
- Lower: `ChartViewViewportService` + `LatestRunStore` as plain computed-graph tests (signal stores are directly instantiable); `ScannerService`/`RhChartService` with mocked Firestore/client.

## Existing Test Coverage

- `symbol-list.store.spec.ts` (`filterOptionGroups`, membership moves) — list-source behavior is inherited, not retested.
- `scanner.store.spec.ts` / `scanner.service.spec.ts` — extend with the new write-seam assertions rather than duplicating run-path coverage.
- `signal-detail.component.spec.ts` — extend for `showToolbar` + service-driven state; the existing chart-rendering assertions should keep passing (they pin the refactor).
- `chart-review.component.spec.ts` — deleted with the page (F6); any still-relevant assertions (queue advance on membership drop, manual symbol load) get ported to the chart-view spec first.

## Edge Cases

- Cold cache — no latest-run docs: scan dropdown renders empty/disabled; no crash, list sources still work.
- Cache doc for an unknown/removed recipe id — dropdown only offers catalog recipes; a `scan:` key for a non-catalog id resolves to an empty pane, not a crash.
- Selected symbol drops out of the filter (New-only flipped on while a tracked symbol is selected) — selection advances/clears like `advanceReviewQueue` did.
- Symbol typed in the manual input that's neither tracked nor in any list — RH path charts it; no membership UI.
- Scan with `truncated: true` — pane shows returned rows; the option label/count communicates the cap (assert label format, not a specific count).
- Rapid symbol switching — the existing `barsSub` cancellation in `ChartStore` covers the RH path too (spec: second `loadCharts` call unsubscribes the first).
- `ChartToolbarStateService` destroyed with the page — prefs reset on revisit (assert by re-instantiation, not leakage).
