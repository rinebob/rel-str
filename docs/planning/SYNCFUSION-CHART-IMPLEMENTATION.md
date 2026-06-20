# Syncfusion Chart Implementation Guide

## Overview

The flex-chart component (`src/app/features/shared/components/flex-chart/`) renders a multi-pane
financial chart using **Syncfusion EJ2 Angular Charts**. It supports candlestick price data,
overlay indicators on the main pane, and multiple lower indicator panes — all with synchronized
X-axis zoom/scroll.

---

## Package & Module Setup

```typescript
// Angular imports
import { ChartModule } from '@syncfusion/ej2-angular-charts';

// Services (provide in component)
providers: [
  CandleSeriesService,   // Candlestick rendering
  LineSeriesService,     // Line overlays
  AreaSeriesService,     // Area fills
  ColumnSeriesService,   // Histograms
  RangeAreaSeriesService,// Band fills (high/low range)
  DateTimeService,       // DateTime axis
  CategoryService,       // Category axis (gap-free)
  ZoomService,           // Zoom (selection, mousewheel, pinch)
  ScrollBarService,      // Scrollbar
  TooltipService,        // Hover tooltips
  CrosshairService,      // Crosshair lines
  LegendService,         // Legend
  StripLineService,      // Reference lines (0-line, thresholds)
]
```

---

## Axis Strategy: Category (Gap-Free)

We use `valueType: 'Category'` on the X-axis to eliminate weekend/holiday gaps.
Each bar is assigned an integer `index` and the axis labels are custom-formatted via
`axisLabelRender` callback to show dates.

```typescript
primaryXAxis = {
  valueType: 'Category',
  majorGridLines: { width: 0 },
  edgeLabelPlacement: 'Shift',
  axisLabelRender: (args) => {
    // Look up date from bars[args.value] and format
    const date = data.bars[args.value]?.x;
    args.text = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
};
```

**Key insight**: All series use `xName="index"` (not dates). This means indicator data must be
mapped from `{ x: Date, y: number }` to `{ index: number, y: number }` via a date→index lookup.

---

## Multi-Pane Architecture (rows + axes)

Syncfusion supports multiple panes via `rows` and `rowIndex` on Y-axes.

### Row Layout

Rows are defined bottom-to-top (index 0 = bottommost):

```typescript
chartRows = computed(() => {
  const lowerCount = lowerPanes.length;
  if (lowerCount === 0) return [{ height: '100%' }];
  
  const lowerPct = Math.floor(40 / lowerCount); // Lower panes share 40%
  const rows = [];
  for (let i = 0; i < lowerCount; i++) {
    rows.push({ height: `${lowerPct}%` });
  }
  rows.push({ height: `${100 - lowerCount * lowerPct}%` }); // Main pane (top)
  return rows;
});
```

### Y-Axis per Pane

Each lower pane gets its own Y-axis with `rowIndex` matching its row:

```typescript
chartAxes = computed(() => {
  return lowerPanes.map((pane, index) => ({
    name: pane.axisName,          // e.g. 'lowerYAxis1'
    valueType: 'Double',
    opposedPosition: true,        // Right side
    rowIndex: index,              // Matches row array position
    stripLines: [...],            // Reference lines (0, ±10, etc.)
  }));
});
```

The main price Y-axis uses `rowIndex: lowerPanes.length` (topmost row).

### Series → Pane Routing

Series reference their pane axis via `[yAxisName]="pane.axisName"`:

```html
<e-series [yAxisName]="pane.axisName" ...></e-series>
```

Series without `yAxisName` default to the primaryYAxis (main price pane).

---

## Rendering Patterns

### 1. Price Candles (Main Pane)

```html
<e-series
  [dataSource]="categoryBars()"
  type="Candle"
  xName="index"
  high="high" low="low" open="open" close="close"
  bearFillColor="#ef5350"
  bullFillColor="#26a69a"
  [enableTooltip]="true">
</e-series>
```

### 2. Indicator Overlay — Candle Bodies (ST-Trend-Bands)

Each band is rendered as a separate Candle series with solid fills and opacity:

```html
@for (band of trendBandSeries(); track band.bandIndex) {
  <e-series
    [dataSource]="band.data"
    type="Candle"
    xName="index"
    high="high" low="low" open="open" close="close"
    [bullFillColor]="band.bullColor"
    [bearFillColor]="band.bearColor"
    [enableSolidCandles]="true"
    opacity="0.7"
    [enableTooltip]="false">
  </e-series>
}
```

The `computeAllBands()` function returns 4 arrays, each with `{ index, open, high, low, close }`
per bar. The candle body represents the band range (H/L) with direction-based coloring.

**Important**: `enableSolidCandles=true` makes both bull and bear candles solid (no hollow bodies).

### 3. Indicator Overlay — Line (EMA, MA)

```html
<e-series
  [dataSource]="indicator.data"
  type="Line"
  xName="index" yName="y"
  [fill]="indicator.config.options.color"
  width="2"
  [enableTooltip]="true">
</e-series>
```

### 4. Lower Pane — Line (RSI, Zone, Trend Strength)

```html
<e-series
  [dataSource]="indicator.data"
  type="Line"
  xName="index" yName="y"
  [yAxisName]="pane.axisName"
  [fill]="indicator.config.options.color">
</e-series>
```

### 5. Lower Pane — Histogram (MACD, future Trend Strength)

```html
<e-series
  [dataSource]="indicator.data"
  type="Column"
  xName="index" yName="y3"
  [yAxisName]="pane.axisName"
  [columnWidth]="0.6"
  opacity="0.5">
</e-series>
```

### 6. Reference Lines (Strip Lines)

Applied to Y-axis as `stripLines`:

```typescript
stripLines: [{
  start: 0,
  sizeType: 'Pixel',
  size: 0,
  dashArray: '4,3',
  color: '#9e9e9e',
  visible: true,
  text: 'Zero',
  textStyle: { color: '#9e9e9e', size: '10px' },
}]
```

---

## Data Flow

```
PriceBar[] (from Firestore/API)
    │
    ├─→ categoryBars()           → { index, open, high, low, close, date }[]
    │                               (price candles)
    │
    ├─→ computeIndicators()      → ComputedIndicatorSeries[]
    │       │                       (generic: { x: Date, y, y2?, y3? })
    │       │
    │       └─→ date→index map   → { index, y, y2?, y3? }[]
    │                               (ready for chart rendering)
    │
    ├─→ groupIndicatorsByPane()  → { main: [...], 'lower-1': [...], ... }
    │
    └─→ computeAllBands()        → BandSeriesData[] (4 bands × OHLC)
                                    (dedicated candle series for ST-Trend-Bands)
```

---

## Indicator Calculator Contract

```typescript
type IndicatorCalculator = (
  bars: PriceBar[],
  params: Record<string, number | string | boolean>
) => { x: Date; y: number; y2?: number; y3?: number }[];
```

- `y` — primary value (line or histogram)
- `y2` — secondary value (signal line)
- `y3` — tertiary value (MACD histogram)
- Return empty array if insufficient data

Calculators are registered in `indicator-registry.ts` with a string key matching `IndicatorType`.

---

## Zoom & Scroll

```typescript
zoomSettings = {
  enableSelectionZooming: true,
  enableScrollbar: true,
  enableMouseWheelZooming: false,
  mode: 'X',
  enablePan: true,
  toolbarItems: ['Zoom', 'ZoomIn', 'ZoomOut', 'Pan', 'Reset'],
};
```

On zoom/scroll events, `autoscaleYAxisForRange()` is called to auto-fit the Y-axis to the
visible price range. This keeps the chart dynamically scaled as the user pans.

---

## Key Syncfusion Gotchas

1. **Category axis uses index values** — all data must include an `index` field, not Date
2. **Row order is bottom-to-top** — index 0 = bottommost pane
3. **`rowIndex` must match** — Y-axis rowIndex must match the row array position
4. **enableSolidCandles** — needed for band overlay (otherwise bull candles are hollow)
5. **opacity on series** — use `opacity="0.7"` for overlays to avoid obscuring price
6. **stripLines on axis, not series** — reference lines attach to the Y-axis definition
7. **Series order matters** — earlier series render behind later ones (put bands before price)
8. **axisLabelRender fires for ALL axes** — check `args.axis.name === 'primaryXAxis'` before formatting

---

## File Structure

```
src/app/features/shared/components/flex-chart/
├── flex-chart.component.ts          ← Main component (template + class)
├── flex-chart.types.ts              ← All interfaces (PriceBar, IndicatorConfig, etc.)
├── flex-chart-calculations.ts       ← Dispatcher: routes to indicator calculators
└── indicators/
    ├── indicator-registry.ts        ← Registry: INDICATOR_OPTIONS + calculatorMap
    ├── ema.indicator.ts             ← EMA
    ├── rsi.indicator.ts             ← RSI
    ├── macd.indicator.ts            ← MACD
    ├── st-trend-bands.indicator.ts  ← ST-Trend-Bands (+ computeAllBands export)
    ├── st-zone.indicator.ts         ← ST-Zone
    └── st-trend-strength.indicator.ts ← ST-Trend-Strength
```
