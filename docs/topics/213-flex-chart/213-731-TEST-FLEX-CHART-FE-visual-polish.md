**Topic:** Flex Chart Visual Polish  
**Topic Slug:** visual-polish  
**Issue:** #731  
**Topic Parent:** #213  
**Domain:** FLEX-CHART  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# Test Plan: Flex Chart Visual Polish (FE)

Source: [PRD](213-214-PRD-FLEX-CHART-visual-polish.md) · [IMPL](213-731-IMPL-FLEX-CHART-FE-visual-polish.md). All Jest + TestBed; no Cypress journeys — chart visuals are verified manually in the sandbox, not pixel-tested.

## E2E User Journeys (manual / sandbox)

- Sandbox loads → chart renders dark background, vibrant candles/indicators, ~60% main pane.
- Quick-charts panel (post-merge spot-check) → 3 stacked charts: D/W show ~30 bars, M ~100; dark cells at 560px height.
- Contracting-pattern symbol → visible bars fill most of the main pane vertically.
- Signal-detail + swing-analysis spot-check → dark theme, 60% main pane, no clipped labels.

## Integration Tests (TestBed)

- `FlexChartComponent`: `appearance` default `'dark'` → host class `.fc-dark`, `palette()` resolves dark slots; `'light'` → `.fc-light` + light palette; candle series binds `bullFillColor`/`bearFillColor` from palette (up=teal-family, down=red-family).
- `FlexChartComponent`: `mainPanePercent` default `60`; override honored.
- `FlexChartComponent` + adapter: `chartRows` — 3 active lowers → each ≈ `floor(40/3)%`, main = remainder; 1 active → `40%`/60% main; 0 active → lowers `0%`, main `100%`.
- `QuickChartsComponent`: passes `visibleBars` 30/30/100 into the three chart configs; `cellHeight` default 560 binds to `.qc-chart-cell` flex-basis; override respected.
- Indicator color resolution: indicator with no `options.color` gets palette slot for its id; explicit `options.color` wins over palette.

## Unit Tests

- `CHART_PALETTES` — both palettes define every required slot; `light` hexes equal today's current values (bit-identical regression guard).
- `chartRows` computed — `mainPanePercent` sanitization (clamps out-of-range), `Math.floor` remainder lands on main pane, inactive panes collapse to `0%`.
- `visibleBars` — `applyInitialZoom` slices the last N bars (existing behavior, renamed field).
- Log strip-line + axis label color read from palette (lifecycle facade effect).

## Test Seams

- **Highest seam:** TestBed component harness on `FlexChartComponent` / `QuickChartsComponent` — catches template + binding + config plumbing bugs.
- **Lower seams:** pure `chartRows` computed and palette module — fast unit coverage of the split math and slot completeness.
- No new seams needed; existing spec files (`flex-chart.component.spec.ts`, `chart-data-adapter` specs, `quick-charts.component.spec.ts`) extend in place.

## Existing Test Coverage

- `flex-chart.component.spec.ts` covers config computeds (zoomSettings, axes, rows) — extend for `mainPanePercent`/`appearance`/`visibleBars`.
- `chart-data-adapter` specs cover `chartRows` split logic — update baselines 55% → 60/40 split and add varying-pane-count cases.
- `quick-charts.component.spec.ts` covers config construction — update `QUICK_BARS` expectations to per-interval `visibleBars`.

## Edge Cases

- `mainPanePercent` out of range (0, 100, negative, >100) — clamped, no negative/zero row heights.
- `appearance` omitted → dark; unknown value → falls back to dark (or light — pick one, spec asserts it).
- Zero active lower panes → main 100%.
- Symbol switch mid-render — palette/class stable across `chartKey` reset.
- `appearance: 'light'` — renders the previous look bit-identically (regression escape hatch).
