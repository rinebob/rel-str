**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Fix Log Scale Y-Axis  
**Thread Slug:** fix-log-y-axis  
**Issue:** #476  
**Thread Parent:** #469  
**Topic Parent:** #468  
**Task:** #477  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

## Scope

Covers the interleaved diff for tasks **#477** (sandbox shell), **#479** (transform seam + strategy rewrite), **#480** (display inversion), and **#481** (log-sensible tick placement). #478 (synthetic data mode) and #482 (edge-case/acceptance pass) remain open and are not part of this review.

## Standards

- Dead `'Logarithmic'`/`zoomFactor`/`zoomPosition` contract left over from the abandoned native-axis approach — **fixed**: `ChartYAxisViewport` is now `{min, max}` only; the facade applies min/max unconditionally; `ScaleStrategy.valueType` removed.
- `as unknown as` cast on the tooltip point — **fixed**: `'high' in point` narrowing against the real `Points` type.
- `flex-chart.component.ts` exceeded the file-size guideline — **partially fixed**: axis-label, tooltip, and log-label logic extracted to `ChartAxisLabelService`; component reduced to ~440 lines (remainder is orchestration, noted).
- Duplicated transform maps in the adapter — **fixed**: `mapY`/`mapOhlc`/`mapFields` helpers.
- Duplicated `formatLabel` bodies — **fixed**: shared `formatPrice` helper in `strategies/price-format.ts`.
- Hand-rolled `10**`/`Math.pow(10, …)` inversions — **fixed**: `fromLogAxis` used at all sites.
- `axisConfig: Record<string, unknown>` + cast — **fixed**: typed `AxisStyleConfig`.
- Unused `allBars` param on `computeViewport` — **fixed**: removed.
- Inconsistent `delta <= 0` guards — **fixed**: parity across both strategies.
- `@for track l.top` — **fixed**: tracks `price`.
- Syncfusion contract verified against installed typings (stripLines fields, `ITooltipRenderEventArgs`, `Points`) — clean.

## Spec

- PRD US2/US9 (indicator overlays in log mode) — **deferred by user direction**: sandbox renders raw prices only (`indicators: []`); overlay-alignment verification belongs to #482's acceptance pass.
- `onTooltipRender` was unreachable — the chart never enabled the tooltip module — **fixed**: `config.showTooltips` → `[tooltip].enable` + `TooltipService` provider; enabled in the sandbox so inversion is verifiable.
- `initialZoomDays` sentinel exposed an off-by-one (`slice(1)` dropped bar 0) — **fixed**: `min(initialDays, bars.length)`.
- Candle tooltip branch lacked NaN guards — **fixed**.
- Symbol switch left the axis stale — **fixed during review**: dataset-identity tracking + `chartChanged` re-apply + `resetViewport` no longer clears `yAxisViewport`/`logTicks` (reset-vs-zoom effect race).
- StripLines imperative write confirmed working — verified in the sandbox UI.
- No scope creep beyond benign sandbox extras (D/W/M switcher, `SHOW_ALL_BARS` sentinel).

## Thermo-Nuclear

- **Dead contract deletion** — resolved (see Standards).
- Stale-viewport transient on chart recreation — **accepted**: self-correcting one-frame write; gate on `lifecycle` only if a visible flicker shows.
- Facade `lastX` sentinel-flag accumulation — **deferred**: pre-existing pattern predating this diff; unifying the imperative-sync effects into one diffed state is a separate refactor.
- Consumer trace clean: transformed values never leak as prices; `crosshairPrice` stays real for sibling charts; lower-pane axes untransformed; quick-charts/chart-review/signal-detail unaffected.
- Stale comments (`MIN_LOG_VALUE`, `allBars` doc, controller header) — **fixed**.

## Test results

`npx jest flex-chart --coverage=false` — **11 suites, 135 tests, all passing.** `tsc --noEmit` clean for all touched files (3 pre-existing errors in untouched files: `scripts/bulk-swing-sweep.ts`, `indicator-config-dialog.component.ts`).

## Verdict

**PASS** — after the fixes above. Core design (upstream log10 transform on a Double axis, shared `logTicks` single-source for lines + labels) is correct; remaining items are documented judgement calls.
