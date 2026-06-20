# ST-Zone V2 — 4-Band Zone Classification

## Summary

Version 2 of the ST-Zone indicator incorporates **all 4 trend bands** into zone classification, adding HTF-2 (slow higher-timeframe band) to the existing CTF-1, CTF-2, and HTF-1. This expands the zone range from -3/+3 to **-4/+4**, providing finer granularity on trend positioning.

---

## Current V1 (3 bands, range -3 to +3)

| Band | Smoothing Length | Mult | Role |
|------|-----------------|------|------|
| B1 (CTF-1) | 5 | 1 | Fast current-timeframe |
| B2 (CTF-2) | 10 | 1 | Slow current-timeframe |
| B3 (HTF-1) | 5 | 3 | Fast higher-timeframe |

V1 classification uses band `up/dn` booleans to determine categories (threeUp, twoUp, oneUp, etc.) then checks bar midpoint vs band midpoints.

---

## V2 Design (4 bands, range -4 to +4)

### Band Inputs

| Band | Smoothing Length | Mult | Role |
|------|-----------------|------|------|
| B1 (CTF-1) | 5 | 1 | Fast current-timeframe |
| B2 (CTF-2) | 10 | 1 | Slow current-timeframe |
| B3 (HTF-1) | 5 | 3 | Fast higher-timeframe |
| B4 (HTF-2) | 10 | 3 | Slow higher-timeframe |

### Zone Classification Logic

Each band contributes +1 (bullish) or -1 (bearish) based on its `up` boolean:
- `up[i] === true` → band is bullish (+1)
- `up[i] === false` → band is bearish (-1)

**Raw zone = sum of all 4 band states** → range [-4, +4]

| Zone | Meaning | Band States |
|------|---------|-------------|
| +4 | Strongest bull | All 4 bands bullish |
| +3 | Strong bull | 3 bands bullish, 1 bearish |
| +2 | Moderate bull | 2 bands bullish, 2 bearish |
| +1 | Weak bull | 1 band bullish, 3 bearish (specific combo) |
| 0 | Neutral | Transition / conflicting |
| -1 | Weak bear | 1 band bearish specific combo |
| -2 | Moderate bear | 2 bands bearish, 2 bullish |
| -3 | Strong bear | 3 bands bearish, 1 bullish |
| -4 | Strongest bear | All 4 bands bearish |

### Approach A: Simple Additive (recommended to try first)

```
zone = (b1Up ? +1 : -1) + (b2Up ? +1 : -1) + (b3Up ? +1 : -1) + (b4Up ? +1 : -1)
```

This gives values: -4, -2, 0, +2, +4 (always even). To get all integers -4 to +4, apply **bar midpoint positioning** as a tiebreaker:

```
baseZone = sum of band states  // -4, -2, 0, +2, +4

// Refine with midpoint vs band midpoints
if baseZone == 0:
  if barMid > average(b1m, b2m, b3m, b4m): zone = +1
  else: zone = -1
elif baseZone == +2:
  if barMid > max(band midpoints where band is bearish): zone = +3
  else: zone = +2
elif baseZone == -2:
  if barMid < min(band midpoints where band is bullish): zone = -3
  else: zone = -2
elif baseZone == +4: zone = +4
elif baseZone == -4: zone = -4
```

### Approach B: Hierarchical (closer to V1 logic)

Weight bands by timeframe importance:
- B4 (HTF-2, slowest) = most significant
- B1 (CTF-1, fastest) = least significant

```
Priority order: B4 > B3 > B2 > B1

If all same direction → ±4
If B4+B3+B2 agree, B1 differs → ±3
If B4+B3 agree, B2+B1 may differ → ±2
If only B4 agrees with direction → ±1
Conflicting HTF vs CTF → 0
```

### Approach C: Weighted Sum

```
zone = round((b4Up ? 1.5 : -1.5) + (b3Up ? 1.2 : -1.2) + (b2Up ? 0.8 : -0.8) + (b1Up ? 0.5 : -0.5))
```

Weights: HTF-2=1.5, HTF-1=1.2, CTF-2=0.8, CTF-1=0.5 (sum = 4.0 → max ±4)

---

## Signal Rules (same pattern as V1)

### Long Entry
Zone value increases from one bar to the next (any upward transition from -4 to +4)

### Short Entry
Zone value decreases from one bar to the next (any downward transition from +4 to -4)

### Additional Signal Context (new in V2)
- Transitions involving ±4 are highest conviction (all bands aligned)
- Zone crossing zero (negative → positive or vice versa) is a key directional shift
- HTF-2 flip events can be tracked separately as rare, high-significance signals

---

## Implementation Plan

1. Create `st-zone-v2.indicator.ts` as a new calculator (not modifying V1)
2. Register in `indicator-registry.ts` as separate indicator option
3. Create corresponding `st-zone-v2.signals.ts` detector (same transition logic, wider range)
4. Compare V1 vs V2 output side-by-side on the chart to validate

---

## Open Questions

1. **Which approach?** Simple Additive (A) is cleanest and most transparent. Hierarchical (B) is closest to V1 thinking. Weighted (C) gives HTF more say.
2. **Keep -3/+3 range or expand to -4/+4?** Expanding gives more granularity but changes signal density.
3. **Midpoint comparison needed?** V1 uses bar midpoint vs band midpoints for zone assignment. V2 could be purely band-state driven (simpler) or keep midpoint refinement (more precise).
4. **Display:** Same lower pane as V1 or separate? Probably same pane with axis adjusted to -4/+4.

---

## File Location

```
src/app/features/shared/components/flex-chart/indicators/st-zone-v2.indicator.ts
src/app/features/shared/components/flex-chart/signals/st-zone-v2.signals.ts
```
