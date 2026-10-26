**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1249  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1255  
**Domain:** CHART-REVIEW  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-25  

# CODE-REVIEW — #1255 ChartToolbarStateService + SignalDetailComponent showToolbar input

## Verdict

**PASS** — three axes, one convergence round. Standards and Spec returned
minor/nit findings only; Thermo-nuclear returned no blockers and four cheap
fold-ins, all applied in-round (canonical homes for `chartIntervalKey` and
`ChartRange`, `INDICATOR_MENU_BY_INTERVAL` rename, delegate-method removal,
`chartConfig` dedupe) plus the Spec axis's missing re-instantiation test.
The one standards MAJOR (file over 400 lines) is a pre-existing condition
this task reduced from ~700 to 468 lines; full decomposition is deferred
to the chart-view/retirement tasks (#1256/#1260) where the component's
remaining surface is re-cut anyway — documented deferral, not a blocker.

## Scope

Reviewed working-tree changes for #1255 only (tree carries unrelated
changes from other workstreams):

- `services/chart-toolbar-state.service.ts` — NEW page-scoped injectable
- `services/chart-toolbar-state.service.spec.ts` — NEW (18 specs)
- `components/signal-detail/signal-detail.component.ts` — hoist + `showToolbar` input
- `components/signal-detail/signal-detail.component.html` — toolbar guard + direct service bindings
- `components/signal-detail/signal-detail.component.spec.ts` — provider + hoisted-state describe
- `pages/chart-review/chart-review.component.ts` — `providers: [ChartToolbarStateService]`
- `utils/chart-indicators/base-indicators.ts` + barrel — `chartIntervalKey` (canonical home)
- `components/chart-toolbar/chart-toolbar.component.ts` — `ChartRange` propagation
- `features/shared/components/flex-chart/flex-chart.types.ts` — `ChartRange` type

## Standards

- **MAJOR (documented deferral)** — `signal-detail.component.ts` still exceeds the 400-line
  guideline at 468 (was ~700; this task removed ~230). Remaining bulk is cohesive
  (per-interval config quartet + indicator injection); thermo-nuclear judged further
  decomposition optional. Documented reason: component is mid-migration — the merged
  toolbar task (#1256) and retirement task (#1260) re-cut this surface again.
- **MINOR (fixed)** — mixed delegation: four one-line pass-through methods alongside
  direct `toolbarState.*` template calls. Removed the delegates; template binds the
  service uniformly.
- **MINOR (fixed)** — `ChartRange` union duplicated at three sites; canonical type now
  in `flex-chart.types.ts`, applied to toolbar input/output and `rangeBarsFor`.
- **NIT (fixed)** — `chartIntervalKey` moved out of the service file to
  `chart-indicators/base-indicators.ts` (canonical interval-key home), barrel-exported.
- **NIT** — exported `ST_EXTRA_INDICATOR_OPTIONS`/`INDICATOR_MENU_BY_INTERVAL` have no
  external consumer yet; pre-positioned for #1256's merged toolbar. Accepted.
- **NIT** — `showToolbar` has no `false` consumer until #1256. Documented + tested.
- Tests: `jest.fn()` throughout, no type-erased fixtures, deterministic async. Clean.

## Spec

All four acceptance criteria MET:

1. Service owns all six signals + three computeds + setters — verbatim port,
   including opt-in Trigger Bands defaults and badge coupling.
2. `SignalDetailComponent` reads/writes the service; `showToolbar = input(true)`;
   chart rendering unchanged — existing specs still pass.
3. Page-scoped — `@Injectable()` without `providedIn`; provided on
   `ChartReviewComponent` (old page) pending #1256's page provider.
4. `applyIndicatorToggle` preserves `onToggleIndicator` semantics — in-scope
   intervals only, single atomic `.update()`.

- **MINOR (fixed)** — TEST:74 required a prefs-reset-on-revisit assertion; added the
  fresh-injector re-instantiation spec.
- **NIT** — single-emission atomicity isn't directly asserted (unobservable without
  a counter; signal semantics make it structurally atomic).
- **NIT** — public writable signals could be `asReadonly()`-hardened later; matches
  `UiStateService` convention today.

## Thermo-nuclear

No structural regression, no blocking findings. Folded in:

- **MINOR (fixed)** — `INDICATORS_BY_INTERVAL` name collision with
  `base-indicators.ts`'s default-on base set (different semantics) → renamed
  `INDICATOR_MENU_BY_INTERVAL`.
- **MINOR (fixed)** — `chartConfig` duplicated `tripleChartConfig`'s literal →
  now calls the static.
- **NIT (fixed)** — `IndicatorSeriesStore` mock lacked `loadIfNeeded` (footgun for
  future Trigger Bands tests) → stub added.
- **NIT (fixed)** — unknown-id no-op and multi-id batch semantics unpinned → two
  specs added.
- Verified not-findings: `indicatorScope` reading global `UiStateService.chartLayout()`
  is correct layering; `@if(showToolbar())` sweeping `app-symbol-list-actions` away
  is intentional (default true leaves chart-review identical); `app-signal-detail`
  has exactly one host, which provides the service — unconditional `inject()` is safe.
- **NIT (deferred)** — per-interval quartet (`rangeBars*`/`*Indicators`/`chartConfig*`)
  could collapse into a `Record<ChartIntervalKey, ...>` table (~50 lines); extras
  wiring differs per key, so it's an optional follow-up, not a blocker.

## Test results

Full suite green: **262 suites / 4,525 tests** (`npx jest --coverage=false`).
Focused re-run after convergence edits: 6 suites / 60 tests pass
(service, detail, toolbar, chart-indicators specs).
`tsc --noEmit -p tsconfig.app.json` clean.

Known unrelated build issue: `ng build` fails on `ds-gallery.component.scss`
exceeding its 25 kB style budget — pre-existing in the working tree from the
#1024 design-system workstream, untouched by this task.
