# FlexChart Component Decomposition Plan

## Executive Summary

The current `FlexChartComponent` has grown into a 1,000+ line monolith that mixes chart rendering, crosshair synchronization, price-axis scaling, Y-axis zoom management, and Syncfusion lifecycle orchestration. It now contains unreachable log-scale logic, a small state-machine of boolean flags, and multiple overlapping effects that manually sequence refreshes. This is not a maintainable trajectory for a shared component used across the app.

This document proposes a decomposition that pushes each concern into a focused, testable unit: a chart-shell component, a data adapter, a crosshair coordinator, a Y-axis viewport controller, a dedicated logarithmic-scale strategy, and a central NgRx Signal Store for chart state. The goal is to keep `FlexChartComponent` under ~250 lines and remove the special-case branching that currently dominates the implementation.

---

## 1. Architectural Risk & Challenge

### Immediate Risk: Shared component becomes a coordination bottleneck
`FlexChartComponent` is a shared component in `src/app/features/shared/components/`. Every feature that needs a chart depends on it. When a single shared component absorbs chart rendering, crosshair sync, price overlays, axis scaling, and refresh orchestration, it becomes a coordination bottleneck. A change to any one of those concerns requires reasoning about the entire 1,000-line file. Worse, the component is now large enough that two developers working on different chart features will collide on the same file.

The deeper risk is that this component is silently accumulating stateful side effects. The recent log-scale work added `needsReapplyAfterRefresh`, `isHandlingLoaded`, and `lastLogScale` flags, plus a `setTimeout` fallback, all to paper over the fact that Syncfusion's `refresh()` does not always re-fire `loaded`. This is not a stable foundation for a shared chart primitive. The next feature—whether it is a new indicator pane, a drawing tool, or a synchronized multi-chart layout—will be built on top of a brittle lifecycle that is already hard to trace.

### The 'Why' Challenge

1. Why does a single chart component need to know about horizontal crosshair sync, price labels, and hover state? Those are cross-chart concerns. A chart should expose its current mouse/viewport state and let a parent coordinator decide how to synchronize other charts.
2. Why is the log-scale implementation still present if it does not snap to an arbitrary visible range? Incomplete-but-retained code is acceptable when it is clearly marked and isolated, but it becomes a liability when it leaks special-case branches into the default linear path. The log strategy should live behind the same `ScaleStrategy` interface as the linear strategy so the default chart path stays clean while the feature is finished.
3. Why is the Y-axis range logic split between a declarative `primaryYAxis` computed, a `yAxisRange` signal, and imperative `zoomFactor`/`zoomPosition` mutations? The current design has three different mechanisms for the same concept. That triples the testing surface and the probability of state drift.
4. Why is all this state held in private component signals instead of a single `ChartViewportStore`? Crosshair position, Y-axis viewport, and lifecycle flags are related state that should be observable, patchable, and testable from outside the component.

---

## 2. Technical Critique & Best Practice

### Technical Flaw: The component is a stateful god object with `any` casts and manual orchestration

The current component directly touches `chart.primaryXAxis`, `chart.primaryYAxis`, `chart.animateSeries`, `chart.dataBind()`, and `chart.refresh()` from multiple methods and effects. It also uses several `chart as any` casts to bypass the Syncfusion typings. This is a classic anti-pattern: the component has become intimate with a third-party library's internals rather than wrapping them.

The `onChartLoaded` method is a representative example. It now guards against recursion with `isHandlingLoaded`, checks `isInitialLoad` and `needsReapplyAfterRefresh`, sets `animateSeries = false`, and calls `dataBind()`. This method is doing lifecycle management, initial zoom, and axis refresh all at once. It is difficult to test and easy to break.

### Superior Alternative: A typed chart facade and explicit state machines

A cleaner architecture introduces a thin `ChartFacade` service that owns the Syncfusion instance and exposes a typed, read-only view of the axis state. The component does not call `chart.refresh()` directly; it emits commands to the facade. The facade handles the imperative details, and the component remains declarative.

For the refresh orchestration, replace the boolean flag zoo with a single explicit state machine: `ChartLifecycleState` can be `initializing`, `ready`, `refreshing`, or `zooming`. Effects react to state transitions rather than checking individual flags. This collapses `isInitialLoad`, `isHandlingLoaded`, and `needsReapplyAfterRefresh` into one coherent model.

For the chart state, move the relevant local signals into a `ChartViewportStore` built with NgRx Signals. The store owns the crosshair date, crosshair price, hovered state, and Y-axis viewport. The component and the services read from and patch the same store, eliminating the need to thread values through inputs/outputs for internal coordination. The store remains scoped to the chart instance (provided by the component) so multiple charts on the same page do not collide.

For the Y-axis viewport, introduce a single `ChartYAxisViewport` object:

```typescript
interface ChartYAxisViewport {
  mode: 'linear' | 'logarithmic';
  min: number;
  max: number;
  // For log scale where the underlying axis is auto-ranged and we use zoomFactor/zoomPosition.
  zoomFactor?: number;
  zoomPosition?: number;
}
```

One effect consumes the viewport and applies it, regardless of mode. Callers compute a viewport; they do not know whether `dataBind()` or `zoomFactor` mutations will be used internally.

For TypeScript discipline, replace the `any` casts with a small typed wrapper around the Syncfusion `Chart` instance. The wrapper exposes only the properties we need—`visibleRange`, `rect`, `zoomFactor`, `zoomPosition`, `minimum`, `maximum`—with proper types. This isolates the `any` to one place and makes the rest of the code honest.

---

## 3. Target Architecture

### 3.1 Component Layer: `FlexChartComponent`

`FlexChartComponent` becomes a thin shell:

- Inputs: `chartData`, `config`, `height`, `syncCrosshairDate`, `syncCrosshairPrice`.
- Outputs: `crosshairDateChange`, `crosshairPriceChange`.
- Template: binds to `primaryXAxis`, `primaryYAxis`, `zoomSettings`, `axes`, `rows`, `series`, and the standard event handlers.
- Logic: delegates everything to injected services. It does not compute ranges, manage refresh flags, or manipulate the DOM for sync overlays.

Target size: under 250 lines.

### 3.2 Services / Helpers

| Unit | Responsibility | Lives In |
| --- | --- | --- |
| `ChartDataAdapter` | Transforms `FlexChartDataset` into `categoryBars`, `computedSeries`, `trendBandSeries`, and lower-pane series. Keeps all x-axis index mapping in one place. | `features/shared/components/flex-chart/services/chart-data-adapter.service.ts` |
| `ChartYAxisViewportController` | Computes `ChartYAxisViewport` from visible bars and current config. Encapsulates linear padding and log-scale zoom math. | `features/shared/components/flex-chart/services/chart-y-axis-viewport-controller.service.ts` |
| `ChartCrosshairCoordinator` | Receives mouse/viewport events from one or more `FlexChartComponent` instances and emits synchronized crosshair state. Handles both date and price sync. | `features/shared/components/flex-chart/services/chart-crosshair-coordinator.service.ts` |
| `ChartSyncOverlayComponent` | Renders the horizontal and vertical CSS overlay lines and the hovered price label. | `features/shared/components/flex-chart/components/chart-sync-overlay.component.ts` |
| `ChartLifecycleFacade` | Wraps the Syncfusion `Chart` reference, exposes typed read-only axis state, and applies `dataBind()` / `refresh()` / `animateSeries` changes based on a state machine. | `features/shared/components/flex-chart/services/chart-lifecycle-facade.service.ts` |
| `ChartViewportStore` | NgRx Signal Store holding crosshair date/price, hovered state, Y-axis viewport, and chart lifecycle state. Provided by `FlexChartComponent` so each instance has its own store. | `features/shared/components/flex-chart/store/chart-viewport.store.ts` |
| `LogarithmicScaleStrategy` | Isolates all log-scale behavior: `valueType` config, `LogarithmicService`, and the visible-range-to-zoom math. Retained but disabled by default. | `features/shared/components/flex-chart/strategies/logarithmic-scale.strategy.ts` |
| `LinearScaleStrategy` | Encapsulates linear Y-axis min/max and padding. | `features/shared/components/flex-chart/strategies/linear-scale.strategy.ts` |

### 3.3 Data Flow

1. Parent sets `chartData` and `config`.
2. `ChartDataAdapter` computes chart-ready series.
3. `ChartYAxisViewportController` computes the initial Y-axis viewport from the visible slice and the active scale strategy.
4. `FlexChartComponent` binds the viewport into `primaryYAxis`.
5. On user zoom/scroll, the component tells `ChartYAxisViewportController` the new visible bar range; the controller emits a new viewport; the component binds it.
6. `ChartLifecycleFacade` detects meaningful viewport changes and applies the minimum imperative refresh (`dataBind()` or `refresh()`) exactly once.
7. Crosshair events from the component patch `ChartViewportStore`. The store is the single source of truth for the current crosshair date/price and hovered state on that chart instance.
8. The component also notifies the shared `ChartCrosshairCoordinator` (provided at the page level) that the crosshair has changed.
9. The coordinator broadcasts the synchronized `crosshairDate` / `crosshairPrice` to all registered chart instances.
10. Each component receives the sync values via its inputs and patches its own store. The overlay component renders the synced lines for every chart except the one currently under the mouse.

### 3.3.1 Cross-Chart Synchronization Design

The page that contains multiple charts (e.g., `signal-detail.component`) provides a single `ChartCrosshairCoordinator` at its level. Each `FlexChartComponent` receives that coordinator via `inject()` and registers itself on initialization. The coordinator does not own the charts' data or Y-axis state; it only owns the shared crosshair date/price and the list of registered chart stores.

```typescript
export interface ChartCrosshairCoordinator {
  /** Register a chart instance's store so it can receive sync updates */
  register(store: InstanceType<typeof ChartViewportStore>): void;

  /** Broadcast a new crosshair position from one chart to all others */
  broadcast(source: InstanceType<typeof ChartViewportStore>, date: Date | null, price: number | null): void;
}
```

When the user moves the mouse over chart A:
1. Chart A patches its own store with the new date/price and sets `hovered: true`.
2. Chart A calls `coordinator.broadcast(store, date, price)`.
3. The coordinator loops over every registered store except the source and calls `setCrosshair(date, price)` on each.
4. Each receiving chart has `syncCrosshairDate` / `syncCrosshairPrice` bound to its store-derived crosshair values, so its `ChartSyncOverlayComponent` renders the synced lines.
5. The overlay component hides the synced lines on the hovered chart because `hovered` is true there; that chart relies on the native Syncfusion crosshair instead.

This design keeps the cross-chart concern at the page level while preserving the per-chart store, and it does not require the `FlexChartComponent` to know how many sibling charts exist.

### 3.4 Log Scale Strategy (Extracted, Retained, Incomplete)

#### Why the Y-axis was stuck on 10 / 100 / 1000

Syncfusion's logarithmic axis renders major labels at powers of 10 (`10^0`, `10^1`, `10^2`, ...). Setting `interval: 1` locks that behavior. When `minimum`/`maximum` are set to a non-power-of-10 range such as 150–286, the chart does not draw intermediate labels such as 150, 200, 250; it either keeps the surrounding powers of 10 or ignores the custom range entirely. That is why the axis stayed visually anchored to 10, 100, and 1,000 regardless of how the visible range was configured.

The only built-in way to show a narrower log range is to keep the full auto-range and use `zoomFactor` / `zoomPosition` on the Y-axis. That approach was attempted but did not produce a usable chart because the resulting labels were still sparse powers of 10 and the zoom math did not align with user expectations.

A true "snap to visible range" log scale will require a manual implementation: transform the price data and indicator values to `log10` values, render the Y-axis as a linear `Double` axis, and format labels/ticks as actual prices. That is a larger change and should not be mixed into the default chart path.

#### Extraction plan

Move all log-scale code behind a `ScaleStrategy` interface:

```typescript
interface ScaleStrategy {
  readonly valueType: 'Logarithmic' | 'Double';
  readonly axisConfig: object;
  computeViewport(allBars: Bar[], visibleBars: Bar[]): ChartYAxisViewport;
  formatLabel(value: number): string;
  priceFromPixel(pixelY: number, rect: AxisRect, range: VisibleRange): number;
}
```

`LogarithmicScaleStrategy` implements the zoom-factor math and the `LogarithmicService` registration requirements. `LinearScaleStrategy` implements the min/max padding and plain formatting. The `ChartYAxisViewportController` picks the strategy from `config.logScale` and does not branch on the flag itself.

- The log toolbar button remains in `ChartToolbarComponent`; `config.logScale` is driven by the user toggle and can be `true` or `false`.
- The `LogarithmicScaleStrategy` is kept in the codebase and selected by `ChartYAxisViewportController` when `config.logScale` is `true`.
- `LogarithmicService` is registered in the component providers so the built-in log axis can be rendered when the toggle is on.
- The log-specific branches in `primaryYAxis`, zoom handling, and price/pixel conversion live in the strategy and the lifecycle facade, not scattered through the component. The built-in Syncfusion `Logarithmic` value type does **not** currently snap to an arbitrary visible price range, so the toggle is an experimental/retained feature and is documented as incomplete.

### 3.5 Chart State: NgRx Signal Store

Introduce a `ChartViewportStore` scoped to each `FlexChartComponent` instance:

```typescript
export interface ChartViewportState {
  hovered: boolean;
  crosshairDate: Date | null;
  crosshairPrice: number | null;
  yAxisViewport: ChartYAxisViewport | null;
  lifecycle: 'initializing' | 'ready' | 'refreshing' | 'zooming';
}

export const ChartViewportStore = signalStore(
  withState<ChartViewportState>({
    hovered: false,
    crosshairDate: null,
    crosshairPrice: null,
    yAxisViewport: null,
    lifecycle: 'initializing',
  }),
  withMethods(store => ({
    setHovered(hovered: boolean) {
      patchState(store, { hovered });
    },
    setCrosshair(date: Date | null, price: number | null) {
      patchState(store, { crosshairDate: date, crosshairPrice: price });
    },
    setYAxisViewport(viewport: ChartYAxisViewport) {
      patchState(store, { yAxisViewport: viewport });
    },
    setLifecycle(lifecycle: ChartViewportState['lifecycle']) {
      patchState(store, { lifecycle });
    },
  }))
);
```

Provided at the component level:

```typescript
@Component({
  ...
  providers: [ChartViewportStore, ChartYAxisViewportController, ...]
})
export class FlexChartComponent { ... }
```

Why a store is the right call here:
- The crosshair date, crosshair price, hovered state, and Y-axis viewport are related state that changes together.
- Services like `ChartYAxisViewportController` and `ChartLifecycleFacade` can patch the store without needing the component to wire inputs/outputs.
- Effects can react to `store.lifecycle()` or `store.yAxisViewport()` instead of a tangle of private signals and boolean flags.
- Unit tests can construct the store in isolation, patch state, and assert on derived values without rendering a chart.

### 3.6 Future: True Log-Scale Implementation (Deferred)

The built-in Syncfusion `Logarithmic` value type cannot snap to an arbitrary visible price range. It always renders major labels at powers of 10. The only way to get a log-scale chart with a Y-axis that snaps to the visible range and shows labels like $150, $200, $250 is a **manual implementation**.

#### What a manual implementation would require

1. **Transform main-pane data to log space.**
   - Price bars: `open`, `high`, `low`, `close` → `log10(...)`.
   - Trend-band candle series: `open`, `high`, `low`, `close` → `log10(...)`.
   - Price-based overlay indicators (SMA, EMA, Bollinger): `y` → `log10(...)`.
   - Volume, zone, and other non-price indicators stay on their own linear axes and are not transformed.

2. **Render the Y-axis as a linear `Double` axis.**
   - `minimum` = `log10(visibleMin)`.
   - `maximum` = `log10(visibleMax)`.
   - This gives the exact same snapping behavior as the current linear chart.

3. **Convert values back to prices for display and interaction.**
   - `onAxisLabelRender`: `10^value` → `$NNN`.
   - Crosshair and tooltip: `10^value` → price.
   - Hovered price label: `10^value` → `$NNN`.

4. **Keep the strategy abstraction.**
   - The manual implementation becomes a third strategy, e.g., `ManualLogarithmicScaleStrategy`, alongside `LinearScaleStrategy` and the built-in `LogarithmicScaleStrategy`.
   - This allows toggling between linear, built-in log, and manual log without touching the component.

#### Why this is deferred

A manual log scale is a medium-to-large feature, not a quick fix. It requires careful handling of every main-pane series and every price-based indicator. One missed transform makes the chart nonsensical. It should be implemented only after the chart component is decomposed and the `ScaleStrategy` abstraction is in place, so the change is isolated and testable.

Until then, the built-in `LogarithmicScaleStrategy` is retained and selectable, but the chart will not render a correctly-snapped log Y-axis. The default path remains linear and is unaffected by the retained log code.

---

## 4. Implementation Roadmap

### Phase 1: Extract template and styles, then introduce `ChartViewportStore`
- Move the inline template to `flex-chart.component.html` and the inline styles to `flex-chart.component.scss`. A significant portion of the current 1,000+ lines is inline markup and CSS, so this alone materially reduces the TypeScript file size.
- Create `ChartViewportStore` with `hovered`, `crosshairDate`, `crosshairPrice`, `yAxisViewport`, and `lifecycle` state.
- Provide the store at the `FlexChartComponent` level.
- Replace the component's private signals (`isHovered`, `hoveredDate`, `hoveredPrice`, `yAxisRange`, `isInitialLoad`, `needsReapplyAfterRefresh`) with store reads/patches.
- Verify that linear-mode behavior is unchanged before moving on.

### Phase 2: Extract the Y-axis viewport logic
- Create `ChartYAxisViewportController` and `ScaleStrategy` implementations (`LinearScaleStrategy`, `LogarithmicScaleStrategy`).
- Move `setPrimaryYAxisRange`, the Y-axis portion of `applyInitialZoom`, and `snapYAxisToVisibleRange` into the controller.
- The controller reads `config.logScale` and picks the strategy; the component only sees the resulting `ChartYAxisViewport`.
- Add unit tests for both strategies.

### Phase 3: Extract the crosshair and overlay logic
- Create `ChartSyncOverlayComponent` and move the overlay DOM/CSS into it.
- Create `ChartCrosshairCoordinator` and provide it at the page level (e.g., `signal-detail.component`) so all chart instances in the view share one coordinator.
- Register each chart instance's `ChartViewportStore` with the coordinator on init; broadcast crosshair changes to sibling stores.
- Move crosshair pixel/value conversion into the coordinator or the overlay component.
- `FlexChartComponent` emits crosshair changes and receives sync values; it does not compute overlay positions.

### Phase 4: Introduce the chart lifecycle facade
- Wrap the Syncfusion `Chart` reference in `ChartLifecycleFacade`.
- Replace boolean flags (`isHandlingLoaded`, `lastLogScale`, `lastSeriesKey`, `lastShowToolbar`) with `ChartLifecycleState` in the store.
- Move `dataBind()` / `refresh()` calls into the facade, driven by state transitions.

### Phase 5: Decompose the data adapter
- Move `categoryBars`, `computedSeries`, `trendBandSeries`, and lower-pane grouping into `ChartDataAdapter`.
- `FlexChartComponent` binds the adapter's output directly.

### Phase 6: Retain and isolate log scale
- Keep the `log` toolbar button in `ChartToolbarComponent`.
- Register `LogarithmicService` in `FlexChartComponent` providers so the built-in log axis can render.
- Keep `LogarithmicScaleStrategy` in the codebase and selectable via `config.logScale`.
- Move log-specific branches (`primaryYAxis` range application, zoom handling, and price/pixel conversion) into the strategy and the lifecycle facade. The log path is retained and reachable, but it is documented as an incomplete feature pending the future manual log implementation.

---

## 5. Third Code Review Findings (Critical — Must Fix Before Next Feature)

The previous two review passes did not fully complete the decomposition. The following items were left behind and must be remediated explicitly. Each item has a concrete instruction and a target file.

### 5.1 Crosshair performance is unacceptable
- **Problem:** `onChartMouseMove` fires a stream of store updates (`setHovered`, `setCrosshairDate`, `setCrosshairPrice`, `setHoveredPriceTop`, `broadcastCrosshair`) for every pixel of movement. The synced overlay (`ChartSyncOverlayComponent`) then runs an `effect()` that does DOM `querySelector` calls and an O(n) linear scan of the full bar array to find the closest date on every receiving chart. With multiple charts visible, a single mouse move triggers many O(n) scans and DOM writes.
- **Instruction:**
  1. Throttle or sample `chartMouseMove` so crosshair updates only happen when the bar index under the mouse changes (or at most once per animation frame).
  2. Replace the overlay's `effect()` + `querySelector` with direct `ViewChild` references to the line elements.
  3. Precompute a `date -> index` map once per dataset and pass it to the overlay, or use binary search, so price-to-pixel conversion is O(log n) or O(1), not O(n).
  4. Run overlay DOM writes outside Angular change detection (`NgZone.runOutsideAngular`) if they are not already.
  5. Ensure the coordinator only broadcasts crosshair changes when the date or price actually changes, not on every mouse event.
- **Target files:** `flex-chart.component.ts`, `chart-sync-overlay.component.ts`, `chart-crosshair-coordinator.service.ts`.

### 5.2 Component still reads chart internals directly
- **Problem:** `onChartMouseMove` reads `chartComp.axisCollections[0]` and `chartComp.primaryYAxis`; `onScrollEnd` reads `chart.primaryXAxis.visibleRange`. These are not mutations, but they still couple the component to Syncfusion internals and make unit testing impossible.
- **Instruction:** Move all chart-state reads into a small service or into the existing `ChartLifecycleFacade`. The component should receive `AxisRect` / `VisibleRange` snapshots as plain values, not reach into the chart object.
- **Target files:** `flex-chart.component.ts`, `chart-lifecycle-facade.service.ts`.

### 5.3 Lifecycle coordination is still too complex
- **Problem:** `onChartLoaded`, the data-change reset effect, and the keyed zoom effect interact in a way that is hard to reason about. `resetViewport` sets lifecycle to `initializing`; then the keyed zoom effect calls `applyInitialZoom`; then `onChartLoaded` may fire again depending on whether Syncfusion re-emits `loaded`. This works by coincidence.
- **Instruction:**
  1. Move the "initial zoom should be applied" decision entirely into `ChartLifecycleFacade`.
  2. The component should only tell the facade "data changed" or "chart loaded".
  3. Remove the component's `lastZoomKey` keyed effect and `onChartLoaded` zoom logic.
  4. Remove `isHandlingLoaded` from the store if it is no longer needed once the facade owns the lifecycle.
- **Target files:** `flex-chart.component.ts`, `chart-lifecycle-facade.service.ts`, `chart-viewport.store.ts`.

### 5.4 Overlay does not react to chart axis changes
- **Problem:** `ChartSyncOverlayComponent` reads `chart.axisCollections` and `chart.primaryYAxis` inside an effect, but those are not signals. The overlay line only moves when `crosshairDate`/`crosshairPrice` change, not when the user zooms or scrolls the receiving chart. A synced line can drift out of position.
- **Instruction:** Either (a) expose a signal from the facade that emits the current axis rects/ranges and have the overlay depend on it, or (b) re-broadcast the synced crosshair after every zoom/scroll so the overlay recomputes. The first option is preferred.
- **Target files:** `chart-lifecycle-facade.service.ts`, `chart-sync-overlay.component.ts`, `chart-viewport.store.ts`.

### 5.5 `resetViewport` leaves `hovered` stale
- **Problem:** When `chartData` changes, `resetViewport` resets crosshair, viewport, lifecycle, and `hoveredPriceTop`, but leaves `hovered` as `true` if the mouse was already over the chart.
- **Instruction:** Reset `hovered` to `false` inside `resetViewport`.
- **Target file:** `chart-viewport.store.ts`.

### 5.6 Manual key tracking in constructor effects
- **Problem:** `lastZoomKey`, `lastSeriesKey`, and `lastShowToolbar` are manual sentinels used to skip effect re-runs. This is a sign that the reactive model is not being expressed cleanly.
- **Instruction:**
  1. For series changes, use a computed signal that derives a stable key and have the facade react to it, or pass a "series fingerprint" signal directly to the facade.
  2. For toolbar visibility, the same.
  3. Remove the `lastZoomKey` effect once the facade owns initial zoom (see 5.3).
- **Target file:** `flex-chart.component.ts`.

### 5.7 Template interpolation inconsistency
- **Problem:** `width="{{ indicator.config.options.lineWidth || 2 }}"` uses string interpolation while other bindings use property binding (`[fill]`, `[width]` on other series).
- **Instruction:** Convert to `[width]="indicator.config.options.lineWidth || 2"` for consistency.
- **Target file:** `flex-chart.component.html`.

---

## 6. Mentorship Principle

**Single Responsibility at the Component Boundary**

A shared component should be a thin shell over focused, independently testable units. When a component starts managing third-party lifecycle state, coordinating cross-component hover overlays, and implementing scale-specific zoom math, it has absorbed too many responsibilities. The principle is not just about making files shorter; it is about making each unit's behavior predictable and each failure isolated. A bug in crosshair sync should not risk breaking Y-axis zooming, and a log-scale experiment should not complicate the default linear chart path. Decompose the component so that each concern owns its own state, its own tests, and its own failure domain.

---

## 7. Fourth Review — Fixes Applied and Remaining Findings

### 7.1 Fixes Applied

The third-review action items have now been addressed in the following way:

- **Crosshair performance (5.1)**
  - Disabled the Syncfusion built-in crosshair (`crosshair = { enable: false }`).
  - Added custom vertical/horizontal crosshair lines drawn in the component DOM and positioned with `requestAnimationFrame` outside Angular change detection.
  - Throttled crosshair updates by bar index and rounded price so the store only updates when the hovered bar or price changes.
  - Cached crosshair line and price-label DOM references after render using `afterNextRender` + `querySelector` so `onChartMouseMove` does not depend on Angular signal updates while running outside the zone.
  - `ChartSyncOverlayComponent` now uses precomputed sorted timestamps + binary search for O(log n) date-to-index lookup and caches its own line elements.

- **Direct chart state reads (5.2)**
  - `onChartMouseMove` and `onScrollEnd` no longer read `axisCollections[0]` or `primaryYAxis.visibleRange` directly.
  - `ChartLifecycleFacade` exposes a `chartState` signal that snapshots `rect` and `visibleRange` for the X and Y axes after every bind/zoom/scroll.
  - The component and overlay consume `chartState()` as plain values.

- **Lifecycle coordination (5.3)**
  - The keyed `lastZoomKey` effect and `onChartLoaded` zoom logic were removed from the component.
  - `ChartLifecycleFacade` now owns the initial-zoom decision, driven by an internal effect keyed on `initialZoomDays`, `interval`, and bar count.
  - `onChartLoaded` remains, but only refreshes `chartState` after the chart renders.

- **Overlay axis reactivity (5.4)**
  - `ChartLifecycleFacade.refreshChartState()` is called after every `dataBind()` (initial zoom, viewport change, series effect) so `chartState` is kept up to date.
  - `ChartSyncOverlayComponent` depends on `chartState()`, so its lines reposition when the chart is zoomed or scrolled.

- **`resetViewport` stale hover (5.5)**
  - `ChartViewportStore.resetViewport()` now resets `hovered` to `false`.

- **Template interpolation (5.7)**
  - The remaining `width="{{ ... }}"` interpolation was converted to `[width]="..."`.

### 7.2 New Findings from the Latest Review

The smaller issues identified in the latest review pass have been resolved:

1. **Crosshair lines stay visible when the cursor leaves the X-axis area.**
   - Added `else { this.hideHoverCrosshair(); this.hidePriceLabel(); }` in `onChartMouseMove`.

2. **Dead tooltip / crosshair code.**
   - Removed `TooltipService` and `CrosshairService` from imports and providers.
   - Removed `tooltip` config, `ITooltipRenderEventArgs` import, `_tooltipDateInjected`, and both tooltip methods.

3. **Unused template references.**
   - Removed `#dateLabel`, `#priceLabel`, `#hoverVLine`, and `#hoverHLine` template refs while keeping the elements.

4. **Resize observer calls `refresh()` on every resize event.**
   - Throttled the `ResizeObserver` callback with `requestAnimationFrame` and cancel any pending frame on destroy.

5. **Dead `coordinator.broadcast` call.**
   - Removed the `ChartCrosshairCoordinator` service file and all references from `FlexChartComponent`. Sibling sync is handled by the parent `signal-detail` input/output binding.

6. **Numeric attributes passed as string literals.**
   - Converted `opacity="0.7"`, `opacity="0.5"`, and `width="1"` to property bindings (`[opacity]`, `[width]`).
   - Also converted `width="100%"` to `[width]="'100%'"` for consistency.

7. **Minor surface cleanup.**
   - `crosshair`, `noAnimation`, and `computedSeries` remain public because they are read by the template; this is acceptable and keeps the template idiomatic.

### 7.3 Post-Review Fixes Applied

After the fifth review pass, the following items were fixed:

- **Stale price-label DOM cache**
  - The `crosshair-price-label` element was wrapped in `@if (hoveredPrice())`, so `afterNextRender` sometimes cached `null` and direct DOM hide/show became no-ops.
  - The label is now rendered unconditionally and hidden by default via `display: none` in the SCSS. `positionPriceLabel()` and `hidePriceLabel()` toggle `display` directly.

- **Redundant X-axis config**
  - Removed `crosshairTooltip: { enable: false }` from `primaryXAxis` because the Syncfusion crosshair itself is disabled.

- **Single-bar initial-zoom edge case**
  - `ChartLifecycleFacade.applyInitialZoom()` could compute `visibleCount = 0` for a one-bar dataset. It now uses `Math.max(1, ...)` so at least one bar is shown.

---

## 8. RH Agent Chart Indicators Module Split

### 8.1 Problem

`src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts` has grown into a 400+ line file that mixes four unrelated responsibilities:

1. **Base indicator configuration** (`INDICATORS_BY_INTERVAL`, `BASE_CONFIGS`, `buildBaseIndicators`).
2. **Indicator attachment helpers** (`addHtfZoneWindow`, `addSignalDots`, `addUptickDots`, `addRhAgentExtras`).
3. **Callable indicator data conversion** (`convertIntervalIndicators`, `zoneToChartData`, `trendStrengthToChartData`, `trendBandsToChartData`).
4. **Callable signal-marker conversion** (`convertTrendStrengthDotMarkers`, `convertZoneDotMarkers`, `convertHtfWindowData`, `uptickDotsFromHistory`).
5. **Derived extras signals** (`RhAgentExtrasSignals`, `createRhAgentExtrasSignals`), the only part that depends on Angular signals.

This makes the file a coordination bottleneck for any new indicator or signal type. It also makes unit testing difficult because conversion helpers cannot be imported without also pulling in the Angular-specific signal factory.

### 8.2 Target Layout

Keep `rh-agent-chart-indicators.ts` as a public barrel so existing callers (`signal-detail.component.ts` and `quick-charts.component.ts`) do not need import-path changes. Move the implementation into focused modules under `src/app/features/rh-agent/utils/chart-indicators/`:

```
chart-indicators/
├── base-indicators.ts            # ChartScatterPoint, base configs, buildBaseIndicators,
│                                 # addHtfZoneWindow, addSignalDots, addUptickDots,
│                                 # RhAgentChartExtras, addRhAgentExtras, UptickDotColors
├── indicator-converters.ts       # toDate, zoneColor, zoneToChartData,
│                                 # trendStrengthToChartData, trendBandsToChartData,
│                                 # convertIntervalIndicators, injectCallableIndicatorData
├── signal-marker-converters.ts   # uptickDotsFromHistory, convertTrendStrengthDotMarkers,
│                                 # convertZoneDotMarkers, convertHtfWindowData
└── extras-signals.ts             # RhAgentExtrasSignals, createRhAgentExtrasSignals
```

`rh-agent-chart-indicators.ts` becomes a re-export barrel:

```typescript
export type { ChartScatterPoint, RhAgentChartExtras, RhAgentExtrasSignals } from './chart-indicators/base-indicators';
export {
  buildBaseIndicators,
  addHtfZoneWindow,
  addSignalDots,
  addUptickDots,
  addRhAgentExtras,
  UptickDotColors,
} from './chart-indicators/base-indicators';
export {
  uptickDotsFromHistory,
  convertTrendStrengthDotMarkers,
  convertZoneDotMarkers,
  convertHtfWindowData,
} from './chart-indicators/signal-marker-converters';
export {
  convertIntervalIndicators,
  injectCallableIndicatorData,
} from './chart-indicators/indicator-converters';
export { createRhAgentExtrasSignals } from './chart-indicators/extras-signals';
export { ST_ZONE_WINDOW_MONTHLY_INDICATOR, ST_ZONE_WINDOW_WEEKLY_INDICATOR } from './chart-indicators/base-indicators';
export { ST_ZONE_V1_UPTICK_DOTS_INDICATOR, ST_ZONE_V2_UPTICK_DOTS_INDICATOR } from './chart-indicators/base-indicators';
```

### 8.3 Dependency Rules

- `base-indicators.ts` has no internal dependencies.
- `indicator-converters.ts` has no internal dependencies.
- `signal-marker-converters.ts` depends only on `base-indicators.ts` (for `ChartScatterPoint` and `UptickDotColors`).
- `extras-signals.ts` depends on `signal-marker-converters.ts` and `base-indicators.ts`.
- The barrel file depends on all four modules.

This DAG ensures that pure conversion code never accidentally depends on Angular signals and that each module has a single, obvious reason to change.

### 8.4 Benefits

- **Testability:** `indicator-converters.ts` and `signal-marker-converters.ts` can be unit-tested with plain Jest fixtures and no Angular `TestBed`.
- **Dependency clarity:** Only `extras-signals.ts` imports `@angular/core`. The framework boundary is explicit.
- **Incremental build isolation:** A change in one conversion helper only recompiles its direct consumers, not every file that imports the monolith.
- **Reduced merge conflicts:** Smaller, single-purpose files make overlapping edits less likely when multiple developers work on indicator-related features.

### 8.5 Out of Scope

This split does not change the public API or the behavior of any caller. It is purely a file-level decomposition.
