# ST-Zone Indicator

**Status**: ✅ Implemented (rendering as line — colored dots/step TBD)

Target file: `src/app/features/shared/components/flex-chart/indicators/st-zone.indicator.ts`
Backend math: `functions/src/indicators/st-zone.ts`

---

## PineScript Source

- `rb-ta/ind/rb-smha-four-band-plot.pine` — zone classification logic (composite categories + zone assignment)

---

## File Structure

| Export | Type | Purpose |
|--------|------|---------|
| `ST_ZONE_INDICATOR` | `IndicatorOption` | Chart UI config: pane lower-1, auto scale |
| `calculateStZone` | `IndicatorCalculator` | Pure function: PriceBar[] → `{ x, y: zone }[]` |

---

## Theory

Classifies each bar's position relative to the 3 trend bands into a zone value from -3 to +3.
Uses composite trend categories (how many bands agree on direction) combined with price midpoint
position vs band midpoints to determine how strongly the bar is in a trend.

- **+3**: Strong bullish (price above fastest band midpoint in uptrend, or above HTF in downtrend)
- **+2**: Moderate bullish
- **+1**: Mild bullish
- **0**: Neutral (no clear category or position)
- **-1**: Mild bearish
- **-2**: Moderate bearish
- **-3**: Strong bearish

---

## Algorithm

### Composite Trend Categories (from bands 1/2/3 up/dn flags)

```
threeUp   = (b1Up && b2Up && b3Up) || (b1Up && b2Dn && b3Up)
twoUp     = b1Dn && b2Up && b3Up
oneUp     = b1Dn && b2Dn && b3Up
oneDown   = b1Up && b2Up && b3Dn
twoDown   = b1Up && b2Dn && b3Dn
threeDown = (b3Dn && b2Dn && b1Dn) || (b3Dn && b2Up && b1Dn)
```

### Zone Classification

```
midpoint = (high + low) / 2

zonePlusThree  = (midpoint > b1m && isUpCat) || (midpoint > b3m && isDownCat)
zoneMinusThree = (midpoint < b1m && isDownCat) || (midpoint < b3m && isUpCat)
zonePlusTwo    = (midpoint > b2m && midpoint <= b1m) && (twoUp || threeUp)
zoneMinusTwo   = (midpoint < b2m && midpoint >= b1m) && (twoDown || threeDown)
zonePlusOne    = (midpoint > b3m && midpoint <= b2m) && isUpCat
zoneMinusOne   = (midpoint < b3m && midpoint >= b2m) && isDownCat
```

---

## Parameters

No user-configurable parameters. All band lengths and HTF multiplier are fixed:
- Band 1: CTF fast (5, mult=1)
- Band 2: CTF slow (10, mult=1)
- Band 3: HTF fast (5, mult=3)

---

## Chart Rendering

- **Pane**: lower-1 (separate from price)
- **Axis**: auto (-3 to +3 range)
- **Reference line**: zero (neutral)
- **Current**: Line series stepping between integer values
- **Target (TBD)**: Colored step/dot chart — each zone level gets a distinct color

### TradingView Appearance

In TradingView, zone renders as colored cross markers at each level:
- Blue (+3), Teal (+2), Silver (+1), White (0), Fuchsia (-1), Yellow (-2), Red? (-3)

---

## Conversion Notes

- Zone computation depends on all 3 bands being valid (not NaN) — first ~30 bars return null
- Uses same `computeBandMid()` helper as the bands indicator (duplicated inline for frontend)
- The `up` boolean array from each band drives the category logic
