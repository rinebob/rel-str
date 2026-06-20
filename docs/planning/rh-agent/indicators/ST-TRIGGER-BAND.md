# ST-Trigger-Band Indicator

**Status**: ❌ Not yet implemented — PineScript source not yet reviewed

Target file: `src/app/features/shared/components/flex-chart/indicators/st-trigger-band.indicator.ts`
Backend math: `functions/src/indicators/st-trigger-band.ts` (TBD)

---

## PineScript Source

- TBD — need to identify the specific file in `rb-ps` repo

---

## File Structure (Planned)

| Export | Type | Purpose |
|--------|------|---------|
| `ST_TRIGGER_BAND_INDICATOR` | `IndicatorOption` | Chart UI config: overlay pane, price scale |
| `calculateStTriggerBand` | `IndicatorCalculator` | Pure function: PriceBar[] → data points |

---

## Theory

Short-term trigger band that provides entry/exit signals. Likely a faster-reacting overlay
that generates cross signals when price breaks above/below the band.

Details TBD once PineScript source is reviewed.

---

## Algorithm

TBD

---

## Parameters

TBD

---

## Chart Rendering (Planned)

- **Pane**: overlay (main price pane)
- **Series type**: Likely Candle or RangeArea (similar to trend bands but tighter)
- **Opacity**: TBD

---

## Conversion Notes

- Will follow the same pattern as ST-Trend-Bands (pre-smooth → HA → post-smooth → forced body)
- Likely uses shorter EMA lengths for faster reaction
- Need to identify which Pine file contains this indicator
