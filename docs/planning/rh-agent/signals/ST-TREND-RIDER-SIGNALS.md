# ST Trend Rider Signals

## Summary

The **ST Trend Rider** is a long/short entry signal based on **Zone V2 acting as the directional filter** and **Zone V1 + Zone V2 upticks as the trigger**. The logic is intentionally minimal: the window is open whenever Zone V2 is on the right side of zero, and a zone uptick from that side is the signal.

---

## Visual Reference

The screenshot shows the daily chart for GOOG with three lower panes:

- **Pane 1 (top lower pane)**: ST-Zone V2 — the red box highlights V2 holding **above zero**. This is the long window-open condition for the ST Trend Rider.
- **Pane 2 (middle lower pane)**: ST-Zone V1 — the arrows mark **V1 upticks from above zero** while the V2 window is open.
- **Pane 3 (bottom lower pane)**: ST-Zone V2 — the arrows mark **V2 upticks from above zero** while the V2 window is open.

> Long signals = V2 above zero + zone uptick from above zero.  
> Short signals = the inverse: V2 below zero + zone downtick from below zero.

---

## Long Signal Rules

1. **Window open**: Zone V2 value **> 0** on the current bar.
2. **Zone V1 signal**: Zone V1 was **> 0** on the previous bar and **upticks** (rises by ≥ 1) on the current bar.
3. **Zone V2 signal**: Zone V2 was **> 0** on the previous bar and **upticks** (rises by ≥ 1) on the current bar.

A signal fires the moment the uptick occurs. No additional signal fires until the zone falls or flattens and then upticks again.

### Long State Machine

```
State: READY   — zone value is falling or flat, eligible for next signal
State: FIRED   — uptick detected, signal emitted, waiting for reset

READY + zone > 0 and zone uptick  → emit ST Trend Rider long signal, transition to FIRED
READY + zone > 0 and flat/down    → stay READY
FIRED + zone > 0 and uptick       → stay FIRED (no signal)
FIRED + zone > 0 and flat         → stay FIRED (no signal)
FIRED + zone > 0 and down         → transition to READY
```

---

## Short Signal Rules (Reversed)

1. **Window open**: Zone V2 value **< 0** on the current bar.
2. **Zone V1 signal**: Zone V1 was **< 0** on the previous bar and **downticks** (falls by ≥ 1) on the current bar.
3. **Zone V2 signal**: Zone V2 was **< 0** on the previous bar and **downticks** (falls by ≥ 1) on the current bar.

### Short State Machine

```
State: READY   — zone value is rising or flat, eligible for next signal
State: FIRED   — downtick detected, signal emitted, waiting for reset

READY + zone < 0 and downtick  → emit ST Trend Rider short signal, transition to FIRED
READY + zone < 0 and flat/up   → stay READY
FIRED + zone < 0 and downtick  → stay FIRED (no signal)
FIRED + zone < 0 and flat      → stay FIRED (no signal)
FIRED + zone < 0 and up        → transition to READY
```

---

## Signal Variants

| Signal | Window Source | Trigger Source | Signal Type Prefix | Direction |
|--------|--------------|----------------|-------------------|-----------|
| Zone V1 Long | Zone V2 > 0 | Zone V1 uptick from > 0 | `D_ZONE_V1_UPTICK` / `W_ZONE_V1_UPTICK` | Long |
| Zone V2 Long | Zone V2 > 0 | Zone V2 uptick from > 0 | `D_ZONE_V2_UPTICK` / `W_ZONE_V2_UPTICK` | Long |
| Zone V1 Short | Zone V2 < 0 | Zone V1 downtick from < 0 | `D_ZONE_V1_DOWNTICK` / `W_ZONE_V1_DOWNTICK` | Short |
| Zone V2 Short | Zone V2 < 0 | Zone V2 downtick from < 0 | `D_ZONE_V2_DOWNTICK` / `W_ZONE_V2_DOWNTICK` | Short |

---

## Counter-Trend Variant

In markets with strong mean-reversion, the same rule can be flipped for counter-trend ST Trend Rider long signals:

- **Window open**: Zone V2 **< 0** (opposite of with-trend long).
- **Trigger**: Zone V1 or V2 **upticks from below zero**.

These are emitted as `*_CT_UPTICK` signal types and kept visually distinct from the primary with-trend signals.

---

## Rendering

| Element | Pane | Series Type | Color |
|---------|------|-------------|-------|
| Zone V1 long | Main price overlay | Scatter dot | `#4caf50` (green) |
| Zone V1 short | Main price overlay | Scatter dot | `#f44336` (red) |
| Zone V2 long | Main price overlay | Scatter dot | `#8bc34a` (lime) |
| Zone V2 short | Main price overlay | Scatter dot | `#ff9800` (orange) |

---

## Data Flow

1. Callable computes **Zone V1**, **Zone V2**, and **ST-Trend-Strength** for D/W/M intervals.
2. ST Trend Rider signal detection runs on the **Zone V1** and **Zone V2** arrays using the rules above.
3. Signals are returned as `SignalMarker[]` under `signals.zoneV1` and `signals.zoneV2`.
4. Frontend converts each marker into a scatter dot placed at the corresponding bar's close price.
5. Dots are injected as pre-computed data on the overlay pane.

---

## Implementation Notes

- The **Zone V2 > 0 / < 0 window** replaces the previous HTF-zone-based window. There is no separate window series; the V2 value itself is the filter.
- Both V1 and V2 signals share the same window condition, but they are detected and rendered independently.
- The state machine is applied per-bar in chronological order. Once a signal fires on a bar, the same zone cannot fire again until it resets.
- For weekly charts, the same ST Trend Rider rules apply on weekly zone values; daily charts use daily zone values.

---

## Backtest Results

Early backtest (50 symbols, 10-bar forward):

- Counter-trend long signals performed roughly equal to with-trend longs, so the HTF-gate for longs was relaxed.
- Counter-trend shorts underperformed due to market upward bias; the HTF gate for shorts remains.
- All worst false positives traced to NaN ADX warm-up bars, which are now suppressed.

---

## Related Files

- Backend signal detection: `functions/src/rh-agent-cloud-function/strategies/signal-detection.ts`
- ST Trend Rider strategy: `functions/src/rh-agent-cloud-function/strategies/st-zone-uptick/st-zone-uptick.strategy.ts`
- Zone V1/V2 computation: `functions/src/rh-agent-cloud-function/strategies/st-zone-uptick/st-zone-uptick.strategy.ts`
- Frontend signal conversion: `src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts`
- Signal rendering: `src/app/features/rh-agent/components/signal-detail/signal-detail.component.ts`
