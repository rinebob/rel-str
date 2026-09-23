# IMPL — Roll log y-axis scale to all FlexChart consumers (FE)

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Roll log y-axis scale to all consumers  
**Thread Slug:** roll-out-log-y-axis  
**Issue:** #540  
**Thread Parent:** #538  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** IMPL  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

## Overview

This rollout is pure front-end wiring. The log-axis transform seam
(`log-transform.ts`, `LogarithmicScaleStrategy`, `ChartDataAdapter`,
`ChartAxisLabelService`) already works. We only need to:

1. Make `FlexChartComponent` default to `logScale: true` when the parent
   does not explicitly pass it.
2. Add a reusable log toggle to `ChartToolbarComponent`.
3. Wire a page-level `logScale` signal and a toggle into each consumer.

## Shared-layer changes

### `FlexChartComponent`

Current:

```ts
config = input<FlexChartConfig>({ indicators: [] });
```

Change to a computed effective config so `logScale: true` is the default
but a parent-supplied `logScale: false` still wins:

```ts
readonly effectiveConfig = computed<FlexChartConfig>(() => ({
  logScale: true,
  indicators: [],
  ...this.config(),
}));
```

Replace internal reads of `config()` with `effectiveConfig()` where the
default matters (axis builder, adapter, lifecycle facade, axis-label
service). Keep `config()` input for two-way/sync concerns only.

### `ChartToolbarComponent`

Add:

```ts
readonly logScale = input<boolean>(false);
readonly logScaleToggle = output<void>();
```

Template: a pill/button next to the fullscreen toggle labeled
"Log Y-axis" with a Yes/No state. Clicking emits `logScaleToggle()`.

### Tests

- `FlexChartComponent` — when `config` omits `logScale`, effective
  config has `logScale: true`; when parent passes `logScale: false`,
  effective config is false.
- `ChartToolbarComponent` — displays the current state; emits
  `logScaleToggle` on click.

## Consumer wiring

Each consumer adds a page-level signal:

```ts
readonly logScale = signal(true);
```

and binds it to every `app-flex-chart` on the page:

```html
<app-flex-chart [chartData]="..." [config]="{ ..., logScale: logScale() }" />
```

### quick-charts

- `quick-charts.component.ts`: add `logScale` signal.
- `quick-charts.component.html`: add a pill toggle in the page header
  (the component has a header) and bind `logScale()` into each chart card's
  `config`.

### swing-analysis-page

- `swing-analysis-page.component.ts`: add `logScale` signal.
- `swing-analysis-page.component.html`: add a pill toggle in the page header
  and bind `logScale()` to the single `<app-flex-chart>`.

### signal-detail

- `signal-detail.component.ts`: add a single `logScale` signal shared by
  all three timeframes.
- `signal-detail.component.html`: pass `logScale()` to each chart's
  `config` and to each `app-chart-toolbar` so the toolbar reflects the
  page state.

## Files touched

- `src/app/features/shared/components/flex-chart/flex-chart.component.ts`
- `src/app/features/shared/components/flex-chart/flex-chart.component.spec.ts`
- `src/app/features/savant-trader/components/chart-toolbar/chart-toolbar.component.ts`
- `src/app/features/savant-trader/components/chart-toolbar/chart-toolbar.component.html`
- `src/app/features/savant-trader/components/chart-toolbar/chart-toolbar.component.spec.ts`
- `src/app/features/savant-trader/components/quick-charts/quick-charts.component.ts`
- `src/app/features/savant-trader/components/quick-charts/quick-charts.component.html`
- `src/app/features/savant-trader/components/quick-charts/quick-charts.component.spec.ts`
- `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.ts`
- `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.html`
- `src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.spec.ts`
- `src/app/features/savant-trader/components/signal-detail/signal-detail.component.ts`
- `src/app/features/savant-trader/components/signal-detail/signal-detail.component.html`
- `src/app/features/savant-trader/components/signal-detail/signal-detail.component.spec.ts`

## Dependencies

None beyond the existing sandbox-proven log-axis seam.

## Risks

- A consumer building `FlexChartConfig` without spreading the signal will
  still compile but ignore the toggle. Each consumer task adds a spec to
  catch this.
- `FlexChartComponent` internal code currently reads `config()` in many
  places; missing one read would cause the default to be ignored in that
  path. The shared task includes a spec that asserts `effectiveConfig()`
  is used for axis/adapter initialization.
