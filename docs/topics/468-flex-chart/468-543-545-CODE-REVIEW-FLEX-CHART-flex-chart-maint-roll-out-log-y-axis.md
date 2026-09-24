# CODE REVIEW — Task #545: Wire log Y-axis toggle into quick-charts

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Roll log y-axis scale to all consumers  
**Thread Slug:** roll-out-log-y-axis  
**Issue:** #543 (FE Blueprint)  
**Task:** #545  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-24  

## Summary

Wired the quick-charts surface into the shared log-scale rollout. The
`QuickChartsPanelComponent` now owns a page-level `logScale` signal and a
"Log Y-axis Yes/No" pill in the symbol meta header. `QuickChartsComponent`
exposes a `logScale` input and threads it into all three chart configs.

## Standards axis

- Page-level signal + child input seam matches the established
  `signal-detail` → `chart-toolbar` → `flex-chart` pattern.
- No duplication of the shared transform — the page only flips a boolean.
- Specs use `overrideComponent` to mock the child chart component and assert
  the bound `config` input, following project conventions.
- Toggle uses the idiomatic `signal.update(v => !v)`.

## Spec axis

| Criterion | Status |
|---|---|
| Page-level `logScale` signal | Met: `quick-charts-panel.component.ts` |
| Visible Yes/No pill toggle | Met: `quick-charts-panel.component.html` |
| Propagates to every chart in the panel | Met: `quick-charts.component.ts` reads `logScale()` inside each config computed; spec asserts all three configs flip |
| Shared transform untouched | Met: no changes to `FlexChartComponent` internals |
| Default-on behavior | Met: panel signal defaults `true`, component input defaults `true` |

## Thermo-nuclear axis

- Seam placement is correct — one signal in the panel, one input on
  `QuickChartsComponent`, all three configs read it reactively.
- Specs now assert the actual `[config]` binding on the mocked
  `app-flex-chart`, not just the internal `dailyConfig` computed.
- No NgRx or persistence risks; the state is purely local and session-only.

## Findings

### Resolved during review

| Severity | Finding | Resolution |
|---|---|---|
| Minor | Spec asserted only internal `dailyConfig()` computed, not the actual child input binding. | Added a mocked `FlexChartComponent` and assert `config().logScale` on all three chart instances. |
| Nit | `set(!this.logScale())` vs established `update` idiom. | Changed to `this.logScale.update(v => !v)`. |

### Advisory (non-blocking)

| Severity | Finding | Notes |
|---|---|---|
| Minor | The panel pill duplicates the Yes/No label logic from `ChartToolbarComponent`. | If `swing-analysis-page` needs the same pill, consider extracting a shared `LogAxisToggleComponent` to avoid a third copy. |
| Nit | `chart-toolbar.component.ts` still defaults `logScale` to `false`, unlike the `true` default everywhere else. | Out of this task's scope; the toolbar's value is always bound by consumers, so it is a consistency nit rather than a bug. |
| Nit | The panel pill could use `aria-pressed` for accessibility. | Same gap exists on the toolbar button; worth fixing together later. |

## Test results

- `npx jest src/app/features/savant-trader/components/quick-charts` + `quick-charts-panel` — **5 tests passed**
- `npx jest --coverage=false` (full suite) — **131 suites, 1768 tests passed**
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `ng build --configuration development` — clean

## Verdict

**PASS**

Ready for QA. Run `/proj qa 468 545` to perform the manual checklist before
shipping.
