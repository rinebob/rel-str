# ST-Zone Window — HTF Long/Short Window Open Indicator

## Concept

A visual indicator showing when the higher-timeframe zone context is bullish or bearish. "Window open" means the HTF zone is above or below zero, indicating favorable conditions for trades in that direction on the lower timeframe.

- **Long window open**: HTF zone > 0 → green dot at +6
- **Short window open**: HTF zone < 0 → red dot at -6
- **Neutral (HTF zone == 0)**: Plot BOTH +6 and -6 dots (overlapping = no clear direction)

**Always has a value on every bar** — there is no "no data" state.

---

## Two Variants

| Indicator | HTF Source | Plotted On | Use Case |
|-----------|-----------|------------|----------|
| ST-Zone-Window-Monthly | Monthly zone V2 data | Weekly chart | Weekly signal context |
| ST-Zone-Window-Weekly | Weekly zone V2 data | Daily chart | Daily signal context |

---

## Rendering

- **Pane:** Same pane as ST-Zone V2
- **Series type:** Scatter (dots only, no connecting line)
- **Y values:** +6 (long window) / -6 (short window)
  - Gap from zone V2 range (-4/+4) to avoid overlap
- **Colors:**
  - Long window open: green dot (`#4caf50`)
  - Short window open: red dot (`#f44336`)
  - Neutral (zone == 0): both green +6 and red -6 dots plotted
- **Dot size:** Small (3-4px), visually distinct from zone scatter dots
- **Axis:** Zone V2 pane needs `axisMin: -7, axisMax: +7` to accommodate window dots

---

## Data Flow (Option B — Pre-computed HTF Zone Data as SOT)

The indicator receives **pre-computed HTF zone data** from the chart store as its source of truth.
Using LTF data to compute HTF introduces subtle errors — the pre-computed HTF zone is the SOT.

### Input
- `htfZoneData`: Pre-computed HTF zone V2 output (`{ x: Date, y: number }[]`) — monthly or weekly
- `ltfBars`: LTF price bars (`{ x: Date }[]`) — weekly or daily, used for x-axis mapping

### Process
1. Sort HTF zone data by date
2. For each LTF bar, binary-search for the most recent HTF zone value at or before that bar's date
3. If HTF zone > 0 → emit `{ x: ltfBar.x, y: +6, color: green }`
4. If HTF zone < 0 → emit `{ x: ltfBar.x, y: -6, color: red }`
5. If HTF zone == 0 → emit TWO points: `{ x, y: +6, color: green }` AND `{ x, y: -6, color: red }`

### How HTF zone data gets to the indicator
- The chart store already loads D/W/M data in triple mode (`loadTripleData`)
- Zone V2 calculator runs on each timeframe's bars independently
- The window indicator needs the **result** of zone V2 on the HTF bars
- Pass HTF zone data via the `params` config object or extend the calculator signature

---

## Implementation Plan

1. **Create `st-zone-window.indicator.ts`**
   - New indicator type: `'st-zone-window'`
   - Two registered options: `ST_ZONE_WINDOW_MONTHLY` and `ST_ZONE_WINDOW_WEEKLY`
   - Calculator takes LTF bars + needs HTF zone data as input

2. **Extend indicator data flow**
   - Current `IndicatorCalculator` signature: `(bars, params) => data[]`
   - Need to pass HTF zone data in — either via `params.htfZoneData` or extend the signature
   - The flex-chart component's `computeIndicators` logic needs to supply this data

3. **Register in indicator-registry.ts**
   - Add `'st-zone-window'` to `IndicatorType` union
   - Add calculator mapping
   - Series type: `'scatter'` (dots only)
   - Default pane: same as Zone V2

4. **Axis adjustment**
   - Set `axisMin: -7, axisMax: +7` on Zone V2 pane config to fit ±6 window dots

5. **Add to DEFAULT_ST_INDICATORS**
   - Monthly window → on weekly chart (triple mode)
   - Weekly window → on daily chart (triple mode)
   - Single-chart mode: weekly-window on D chart, monthly-window on W chart, nothing on M chart

---

## Chart Mode Behavior

| Mode | Daily Chart | Weekly Chart | Monthly Chart |
|------|------------|--------------|---------------|
| Triple | Weekly window dots | Monthly window dots | — |
| Single (D) | Weekly window dots | — | — |
| Single (W) | — | Monthly window dots | — |
| Single (M) | — | — | Nothing to plot |

---

## Relationship to MTF Signals

The window indicator is the **visual representation** of the HTF context used by `st-zone-mtf.signals.ts`:
- MTF signal rules check HTF zone ≥ +3 for signal triggers
- Window indicator shows the broader context (HTF > 0 = favorable direction)
- Window open is necessary but not sufficient for signals (signals also need pullback + uptick + zone ≥ +3)

This gives the trader a quick visual read: "Is the window even open for longs/shorts right now?"
