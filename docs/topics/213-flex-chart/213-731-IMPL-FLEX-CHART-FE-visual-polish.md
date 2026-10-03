**Topic:** Flex Chart Visual Polish  
**Topic Slug:** visual-polish  
**Issue:** #731  
**Topic Parent:** #213  
**Domain:** FLEX-CHART  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# Implementation Plan — FE: Flex Chart Visual Polish

Source: [PRD](213-214-PRD-FLEX-CHART-visual-polish.md). Single FE area; no BE or SHARED work. All changes live under `src/app/features/shared/components/flex-chart/` plus the quick-charts consumer.

## Decisions Recap (from grilling)

| Decision | Value |
|---|---|
| Theme mechanism | Palette module + `.fc-dark`/`.fc-light` host class driving CSS vars |
| Palette scope | Owns ALL colors — chrome (bg, axes, gridlines, candles, crosshair) AND per-indicator defaults. Light palette = today's exact hexes (bit-identical). Explicit `options.color` still overrides. |
| `mainPanePercent` | New `FlexChartConfig` input, default `60` |
| `appearance` | New `FlexChartConfig` input `'dark' \| 'light'`, default `'dark'` — global flip on merge |
| `initialZoomDays` | Renamed to `visibleBars` (it is a bar count, not days) |
| Quick-charts windows | D=30, W=30, M=100 |
| Quick-charts cell height | Configurable input on `QuickChartsComponent`, default `560`px |
| Candle colors | Bug fix — currently bull=red/up; correct to TV convention (up = teal/green, down = red) |
| Y-axis | No work — auto-fit to visible bars already exists |
| Staging | Sandbox eyeballs pre-merge; flags default to new look so prod flips on merge |

## Work Items

### 1. Chart palette module (`chart-theme.ts`, new)

- `ChartAppearance = 'dark' | 'light'`.
- `ChartPalette` interface with semantic slots:
  - **Chrome:** `background`, `axisText`, `axisLine`, `gridLine`, `logTickStripLine`, `crosshairLine`, `crosshairLabelBg`, `crosshairLabelText`, `logAxisLabel`, `noDataText`.
  - **Candles:** `candleUp`, `candleDown` (TV convention: up `#26a69a`-family, down `#ef5350`-family — brighter variants acceptable).
  - **Indicator defaults:** keyed slots for every registered indicator's `color`/`color2` defaults (trend-strength, zone V1, zone V2, zone-window, signal dots, uptick dots v1/v2, trend bands bull/bear pairs, zigzag, trigger band, std-dev lines, ema/macd/rsi, plus generic `seriesColor`/`seriesColor2` fallbacks replacing the template's hardcoded `#2196f3`/`#0d47a1`/`#e91e63`/`#9e9e9e`).
- `CHART_PALETTES: Record<ChartAppearance, ChartPalette>` — `light` must reproduce the exact current hex values so `appearance: 'light'` is visually unchanged.

### 2. Config plumbing

- `FlexChartConfig` gains `mainPanePercent?: number` (default `60`) and `appearance?: ChartAppearance` (default `'dark'`); `initialZoomDays` renamed `visibleBars`.
- Update every `initialZoomDays` consumer (quick-charts, swing-analysis `ALL_BARS_MAX` sentinel, signal-detail, sandbox, specs).
- `mainPanePercent` clamped/sanitized (e.g., 0–95) at the point of use, not at config construction.

### 3. Pane split (`chart-data-adapter.service.ts` `chartRows`)

- `lowerPct = activePaneCount > 0 ? floor((100 - mainPct) / activePaneCount) : 0`; main gets `100 - lowerPct * activePaneCount`.
- Adapter needs access to the effective config — it already receives config context; plumb `mainPanePercent` through (adapter is per-chart-instance).

### 4. Theme application

- `FlexChartComponent`: `appearance = computed(() => config().appearance ?? 'dark')`; `palette = computed(() => CHART_PALETTES[appearance()])`.
- Host class: `[class.fc-dark]`/`[class.fc-light]` on `.flex-chart-wrapper`; SCSS maps palette-driven CSS vars (`--fc-bg`, `--fc-crosshair-line`, `--fc-log-label`, …). Set vars via `[style.--fc-*]` bindings or a static per-theme var block in SCSS — pick whichever keeps the palette single-sourced (recommend: SCSS var blocks keyed by class, and the TS palette mirrors the same hexes for imperative surfaces; keep both sourced from the palette by setting vars inline from `palette()`).
- Template bindings: candle `bullFillColor`/`bearFillColor` → `palette().candleUp`/`candleDown`; all `|| '#hex'` fallbacks → palette slots; per-point `color` fields stay (dots already carry colors — those source values move into the palette slots).
- Axis/adapter: `lineStyle`, `majorGridLines`, label formats gain `labelStyle.color` from palette; log stripLines in `chart-lifecycle-facade` use `palette().logTickStripLine`.
- Indicator color resolution: where `options.color`/`color2` are undefined, resolve palette slot by indicator id (mapping table in the palette module or adapter). Explicit consumer colors keep winning.
- ejs-chart `background` → `palette().background` (no longer transparent) OR keep transparent and put `--fc-bg` on the wrapper — prefer explicit `background` so the chart itself owns its surface.
- Quick-charts SCSS: `.qc-chart-cell`/`qc-stack`/`.qc-tf-label` read chart-area vars or get dark-appropriate colors under the dark wrapper.

### 5. Quick-charts consumer

- `QuickChartsComponent`: new `cellHeight = input(560)` applied to `.qc-chart-cell` (replace `flex: 0 0 420px` with a bound flex-basis); `visibleBars` per interval — D=30, W=30, M=100 (constants or inputs).
- `QUICK_BARS` constant removed.

### 6. Sandbox + rollout spot-checks

- Sandbox renders defaults (dark, 60%) — eyeball palette, tune hexes.
- Spot-check signal-detail, swing-analysis post-merge (they inherit the new defaults).

## Risks / Watch-items

- **Inverted candles today** — verify Syncfusion `bullFillColor` semantics in the rendered chart before/after (bull = close ≥ open should be teal).
- **`options.color` overrides** — any consumer passing explicit colors keeps them; palette only fills undefined slots. Audit `base-indicators.ts` / `addChartExtras` for colors that should move to palette slots.
- **Per-point dot colors** (`pointColorMapping="color"`) are baked into data upstream (signal/uptick dot builders) — those builders take colors from the palette now, so the adapter stays dumb.
- **Log-scale stripLines/ticks** live in the lifecycle facade — the palette must reach it (inject or pass through).
- **CSS var vs. SCSS duplication** — keep one source of truth; SCSS reads vars, never hexes.
