# Zone Uptick Signals — Main Chart Signal Dots

## Concept

Plot signal dots on the **main price chart** when a zone value upticks for the first time during a long window open (or downticks during a short window open). These mark potential entry points where the lower-timeframe zone aligns with higher-timeframe direction.

Signals are plotted for both **Zone V1** and **Zone V2** readings.

---

## Signal Rules

### Long Signal (window open = HTF zone > 0)

1. Long window must be open (HTF zone > 0)
2. Zone value was falling or flat (going down or sideways)
3. Zone value upticks (rises by at least 1) for **one bar**
4. That first uptick bar is the signal
5. If zone continues rising or goes sideways on subsequent bars, **no additional signals** fire
6. A new signal can only fire after the zone falls or goes flat again, then upticks

### Short Signal (window open = HTF zone < 0)

1. Short window must be open (HTF zone < 0)
2. Zone value was rising or flat (going up or sideways)
3. Zone value downticks (falls by at least 1) for **one bar**
4. That first downtick bar is the signal
5. If zone continues falling or goes sideways on subsequent bars, **no additional signals** fire
6. A new signal can only fire after the zone rises or goes flat again, then downticks

### State Machine

```
For longs (HTF zone > 0):
  State: READY    — zone is falling or flat, eligible for next signal
  State: FIRED    — uptick detected, signal emitted, waiting for reset

  READY + zone uptick  → emit long signal, transition to FIRED
  READY + zone flat/down → stay READY
  FIRED + zone uptick   → stay FIRED (no signal)
  FIRED + zone flat     → stay FIRED (no signal)
  FIRED + zone down     → transition to READY

For shorts (HTF zone < 0):
  Same logic reversed (downtick triggers, uptick resets)
```

---

## Two Signal Sets

| ID | Zone Source | Plotted On | Color |
|----|-----------|------------|-------|
| `zone-v1-uptick` | ST-Zone V1 (range -3/+3) | Main price chart | Green (long) / Red (short) |
| `zone-v2-uptick` | ST-Zone V2 (range -4/+4) | Main price chart | Lime (long) / Orange (short) |

Using different colors for V1 vs V2 so they're visually distinguishable.

---

## Rendering

- **Pane:** Main price chart (overlay)
- **Series type:** Scatter (dots only, no connecting line)
- **Placement:**
  - Long signals: below the price bar's low, offset down to avoid trend band overlap
  - Short signals: above the price bar's high, offset up to avoid trend band overlap
  - Offset should be proportional to recent ATR or a fixed percentage of price range
- **Dot size:** 5-6px — slightly larger than histogram signal dots for visibility
- **Colors:**
  - V1 long: `#4caf50` (green), V1 short: `#f44336` (red)
  - V2 long: `#8bc34a` (lime), V2 short: `#ff9800` (orange)

---

## Chart Mode Behavior

| Mode | Daily Chart | Weekly Chart | Monthly Chart |
|------|------------|--------------|---------------|
| Triple | Weekly zone uptick signals (weekly window context) | Monthly zone uptick signals (monthly window context) | — |
| Single (D) | Weekly zone uptick signals | — | — |
| Single (W) | — | Monthly zone uptick signals | — |
| Single (M) | — | — | Nothing |

Same pattern as window dots: daily uses weekly HTF context, weekly uses monthly HTF context.

---

## Data Flow

1. HTF zone data already computed in signal-detail (monthly/weekly zone V2 — SOT)
2. LTF zone V1 and V2 already computed by indicator calculators on LTF bars
3. For each LTF bar, determine if HTF window is open (reuse window logic)
4. Run state machine on LTF zone V1 values → V1 uptick signals
5. Run state machine on LTF zone V2 values → V2 uptick signals
6. Map signal dates to price bar high/low ± offset for dot placement
7. Inject as pre-computed data on two scatter indicators on `main` pane

---

## Implementation Plan

1. **Create `zone-uptick.signals.ts`**
   - Pure function: `detectZoneUptickSignals(zoneData, htfZoneData, bars)` → scatter points
   - Implements the state machine above
   - Returns `{ x: Date, y: number, color: string }[]`

2. **Create `st-zone-uptick-dots.indicator.ts`**
   - Two indicator options: `ST_ZONE_V1_UPTICK_DOTS` and `ST_ZONE_V2_UPTICK_DOTS`
   - Type: `'st-zone-uptick-dots'`
   - Pane: `'overlay'` (renders on main chart)
   - Series: scatter, no connecting line

3. **Wire up in signal-detail**
   - Compute V1 and V2 zone data for LTF bars
   - Run `detectZoneUptickSignals` for each
   - Inject as pre-computed data into daily/weekly chart configs

4. **Register type and series mapping**
   - Add `'st-zone-uptick-dots'` to `IndicatorType`
   - Skip connecting line in flex-chart template

---

## Offset Strategy

To avoid dots overlapping trend bands, use a percentage of the visible price range:
- Compute ATR(14) or use a simple range measure
- Long dot Y = `bar.low - (offset * atrValue)` where offset ≈ 1.5
- Short dot Y = `bar.high + (offset * atrValue)` where offset ≈ 1.5

This keeps dots proportionally spaced regardless of price level.
