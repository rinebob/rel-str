# Migration from rb-ps: Custom Indicator System → TypeScript

## Overview

Port the Savant Trader (ST) proprietary indicator system from PineScript (TradingView)
to TypeScript for server-side signal generation and client-side chart rendering.

**Public names** (never reference internal implementation details externally):
- **ST-Trend-Bands** — smoothed trend bands overlaid on price
- **ST-Zone** — zone classification (price position vs bands)
- **ST-Trend-Strength** — directional trend strength (DI+/- based)
- **ST-Trigger-Band** — (future, not yet migrated)

## Source Files (in `C:\aa\projects\rb-ps`)

| File | Maps To | Description |
|---|---|---|
| `rb-ta/lib/rb-smha-core.pine` | ST-Trend-Bands (CTF) | Chart-timeframe band engine |
| `rb-ta/lib/rb-smha-core-htf.pine` | ST-Trend-Bands (HTF) | Higher-timeframe band engine with jagged stepping |
| `rb-ta/lib/rb-DI-plus-minus-lib.pine` | ST-Trend-Strength | DI+/- compute module |
| `rb-ta/ind/rb-smha-four-band-plot.pine` | ST-Zone + composition | 4-band indicator with zones and categories |
| `exp/dev/AA_DEV_smHA.pine` | Reference | Dev sandbox with all engines inlined |

## System Constants (NON-NEGOTIABLE)

| Constant | Value | Notes |
|---|---|---|
| **HTF_MULTIPLIER** | **3** | Always 3 periods. Three days, three weeks, three months. Hardcoded. |
| CTF Fast length | 5 | Pre-smooth and post-smooth |
| CTF Slow length | 10 | Pre-smooth and post-smooth |
| HTF Fast effective length | 15 | 5 × HTF_MULTIPLIER |
| HTF Slow effective length | 30 | 10 × HTF_MULTIPLIER |
| DI period | 14 | Wilder smoothing length |
| DI upper threshold | +10 | Cross trigger level |
| DI lower threshold | -10 | Cross trigger level |

## Architecture

```
functions/src/indicators/           ← PURE MATH (no Angular, no Firebase)
├── primitives.ts                   ← emaSeries(), crossover(), crossunder(), nz()
├── st-trend-bands.ts               ← CTF + HTF band engine
├── st-zone.ts                      ← Zone classification (depends on bands)
├── st-trend-strength.ts            ← DI+/- engine
└── index.ts                        ← Barrel export

CONSUMERS:
├── functions/src/rh-agent-cloud-function/   ← Server: signal generation → Firestore
└── src/app/features/shared/.../flex-chart/  ← Client: chart rendering (display only)
```

The math is written ONCE. Consumers import it:
- **Cloud function worker**: calls compute → evaluates signal → writes opportunity to Firestore
- **Frontend flex-chart**: calls compute → maps output to `{x: Date, y: number}[]` for rendering

## Algorithm: ST-Trend-Bands

### CTF Engine (`smha_fast_slow_src`)

Per band (called with length 5 for fast, 10 for slow):

1. **Pre-smooth** raw OHLC with `EMA(length)` → smoothed O, H, L, C
2. **HA transform** on smoothed OHLC:
   - `haClose = (O + H + L + C) / 4`
   - `haOpen = isFirst ? (O + C) / 2 : (haOpen[i-1] + haClose[i-1]) / 2`
   - `haHigh = max(H, haOpen, haClose)`
   - `haLow = min(L, haOpen, haClose)`
3. **Post-smooth** HA OHLC with `EMA(length)` → final band O, H, L, C
4. **Force body**: `H = max(O, C)`, `L = min(O, C)`, `mid = L + |H-L|/2`
5. **Trend**: `up = C > O`, `dn = O > C`
6. **Cross triggers**: `crossover(rawClose, H)`, `crossunder(rawClose, L)`

**Output per band**: `{ o, h, l, c, m, up, dn, crossUp, crossDn }` (arrays, one value per bar)

### HTF Engine (`htf_smha_fast_slow`)

Same algorithm as CTF but with two differences:

1. **Scaled lengths**: `beforeLength = length × 3`, `afterLength = length × 3`
2. **Scaled recursive lookback**: `haOpen[i-3]` instead of `haOpen[i-1]`
3. **Jagged output**: values only update every 3 bars (on HTF bar close), otherwise carry forward

The jagged stepping produces the "stepped" visual appearance where HTF bands hold steady
for 3 bars then jump to the new value.

### Four Bands Produced

| Band | Engine | Lengths | Effective EMA |
|---|---|---|---|
| Band 1 (CTF fast) | CTF | 5/5 | 5 |
| Band 2 (CTF slow) | CTF | 10/10 | 10 |
| Band 3 (HTF fast) | HTF | 5/5 (×3) | 15 |
| Band 4 (HTF slow) | HTF | 10/10 (×3) | 30 |

## Algorithm: ST-Zone

### Composite Trend Categories (from band 1/2/3 up/dn flags)

```
threeUp   = (b1Up && b2Up && b3Up) || (b1Up && b2Dn && b3Up)
twoUp     = b1Dn && b2Up && b3Up
oneUp     = b1Dn && b2Dn && b3Up
oneDown   = b1Up && b2Up && b3Dn
twoDown   = b1Up && b2Dn && b3Dn
threeDown = (b3Dn && b2Dn && b1Dn) || (b3Dn && b2Up && b1Dn)
```

### Zone Classification (price midpoint vs band midpoints)

```
midpoint = (high + low) / 2

zonePlusThree  = (midpoint > b1m && (oneUp || twoUp || threeUp))
              || (midpoint > b3m && (threeDown || twoDown || oneDown))
zoneMinusThree = (midpoint < b1m && (oneDown || twoDown || threeDown))
              || (midpoint < b3m && (oneUp || twoUp || threeUp))

zonePlusTwo    = (midpoint > b2m && midpoint <= b1m) && (twoUp || threeUp)
zoneMinusTwo   = (midpoint < b2m && midpoint >= b1m) && (twoDown || threeDown)

zonePlusOne    = (midpoint > b3m && midpoint <= b2m) && (oneUp || twoUp || threeUp)
zoneMinusOne   = (midpoint < b3m && midpoint >= b2m) && (oneDown || twoDown || threeDown)
```

Output: integer -3 to +3 per bar.

## Algorithm: ST-Trend-Strength (DI+/-)

All lookbacks use `HTF_MULTIPLIER = 3` (i.e., `arr[i-3]` instead of `arr[i-1]`):

1. **True Range**: `TR = max(H-L, |H - close[i-3]|, |L - close[i-3]|)`
2. **Directional Movement**:
   - `+DM = (H - H[i-3]) > (L[i-3] - L) ? max(H - H[i-3], 0) : 0`
   - `-DM = (L[i-3] - L) > (H - H[i-3]) ? max(L[i-3] - L, 0) : 0`
3. **Wilder Smoothing** (period=14):
   - `smoothedTR[i] = smoothedTR[i-3] - (smoothedTR[i-3] / 14) + TR[i]`
   - `smoothed+DM[i] = smoothed+DM[i-3] - (smoothed+DM[i-3] / 14) + +DM[i]`
   - `smoothed-DM[i] = smoothed-DM[i-3] - (smoothed-DM[i-3] / 14) + -DM[i]`
4. **DI values**:
   - `DI+ = (smoothed+DM / smoothedTR) × 100`
   - `DI- = (smoothed-DM / smoothedTR) × 100`
   - `diHist = DI+ - DI-`
   - `DX = |DI+ - DI-| / (DI+ + DI-) × 100`
   - `ADX = SMA(DX, 14)`
5. **Signals**:
   - Cross triggers: diHist crosses zero, crosses ±10
   - Break patterns: `upBreak = diHist > 0 && diHist > prev && prev < prevPrev`

## Pine → TypeScript Translation

| Pine concept | TypeScript equivalent |
|---|---|
| `ta.ema(series, len)` | `emaSeries(arr, len)` → returns full number[] |
| `ta.crossover(a, b)` | `a[i] > b[i] && a[i-1] <= b[i-1]` |
| `ta.crossunder(a, b)` | `a[i] < b[i] && a[i-1] >= b[i-1]` |
| `na(x[1])` | `i < 1` (first bar check) |
| `nz(x[n])` | `i >= n ? arr[i-n] : 0` |
| `haopen[htf_multiplier]` | `haOpen[i - 3]` (HTF_MULTIPLIER = 3) |
| `series float x := cond ? val : x[1]` | Carry-forward: `x[i] = cond ? val : x[i-1]` |
| `closeTimeMatch` stepping | Every 3rd bar: update value; otherwise carry forward |

## Implementation Status

| Component | Backend Math | Frontend Calculator | Chart Rendering | Notes |
|---|---|---|---|---|
| ST-Trend-Bands | ✅ `functions/src/indicators/st-trend-bands.ts` | ✅ inline (frontend) | ✅ 4 Candle series overlay | Matches TradingView visual |
| ST-Zone | ✅ `functions/src/indicators/st-zone.ts` | ✅ inline (frontend) | ⚠️ Line (should be colored dots/step) | Values correct, rendering TBD |
| ST-Trend-Strength | ✅ `functions/src/indicators/st-trend-strength.ts` | ✅ inline (frontend) | ⚠️ Line (should be histogram bars) | Values correct, rendering TBD |
| ST-Trigger-Band | ❌ | ❌ | ❌ | PineScript not yet reviewed |

### Frontend Indicator Registry

All indicators are registered in `src/app/.../flex-chart/indicators/indicator-registry.ts` and appear in the "Add Indicator" dropdown in the signal-detail component.

### Key Bug Fix: EMA NaN Propagation

The `emaSeries()` function was updated to **skip leading NaN values** before computing the SMA seed. Without this, any cascaded EMA (e.g., post-smooth of HA data where first N values are NaN) would produce all-NaN output.

### Rendering Architecture

- **ST-Trend-Bands**: Bypasses normal `IndicatorCalculator` rendering. Uses `computeAllBands()` which returns 4 `BandSeriesData` arrays. The flex-chart renders these as 4 Candle series (`type="Candle"`) with `enableSolidCandles=true` and custom bull/bear fill colors at 70% opacity.
- **ST-Zone / ST-Trend-Strength**: Use standard `IndicatorCalculator` → `ComputedIndicatorSeries` → Line series pipeline. Future: upgrade to column/step series with per-bar coloring.

## Key Implementation Notes

- **EMA needs full-series output** — the HA transform and post-smooth depend on all intermediate values
- **EMA must handle leading NaN** — skip to first valid index before SMA seed computation
- **Sequential iteration required** — recursive `haOpen` state means no `Array.map` shortcuts
- **HTF jagged output** — values update every 3 bars, hold steady in between
- **No external dependencies** — pure math on number arrays, zero npm packages
- **DI+/- uses HTF lookback natively** — the `htf_multiplier=3` is baked into all lookbacks in the source
