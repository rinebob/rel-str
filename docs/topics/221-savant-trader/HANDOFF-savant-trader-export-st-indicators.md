- **Topic:** Export ST indicators to PineScript for TradingView
- **Issue:** #235
- **Topic Parent:** #221
- **Domain:** SAVANT-TRADER
- **Type:** Validation & Handoff
- **Status:** Validated — open for future iteration
- **Created:** 2026-09-07
- **Last Updated:** 2026-09-07

---

# Handoff: ST PineScript Port

## Deliverable

Three self-contained Pine v6 indicators are used because TradingView cannot place normal plots from one script into two separate lower panes. Together they provide a read-only second visual reference for the existing quick-chart implementation.

- **Trend Bands:** `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-trend-bands.pine`
- **Zones + event dots:** `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-zones.pine`
- **Trend Strength:** `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-trend-strength.pine`
- **Repository:** `rb-ps` (remote: `https://github.com/rinebob/rb-ps.git`, branch: `main`)
- **Current split changes:** uncommitted; base implementation is in `599e7ac`
- **Pine version:** v6
- **Indicator type:** `indicator()` (not `strategy()`)
- **Imports:** none
- **External dependencies:** none (no app, Firebase, broker, or TypeScript runtime)

## Commit history (rb-ps)

| Commit | Task | Description |
|---|---|---|
| `4435827` | #228 | Create standalone Pine v6 indicator foundation |
| `3f4ca23` | #229 | Translate shared ST math and state behavior |
| `cc962dc` | #231 | Port ST Trend Bands and zones |
| `0b90a3d` | #232 | Port ST Trend Strength |
| `599e7ac` | #233 | Add Zone V1/V2 price-pane event overlay |

## How to use

1. Open each of these files in a text editor:
   - `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-trend-bands.pine`
   - `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-zones.pine`
   - `C:\aa\projects\rb-ps\rb-ta\ind\rb-st-trend-strength.pine`
2. Select one file's contents and copy it.
3. In TradingView, open the Pine Editor (bottom panel).
4. Paste the contents and click "Add to chart".
5. Repeat for the other two files.
6. Keep all three indicators attached to the same chart. TradingView places Trend Bands on the main pane, Zones in one lower pane, and Trend Strength in a separate lower pane.

The three scripts are intentional: one Pine indicator cannot assign normal plots to two separate lower panes, so Trend Bands, Zones, and Trend Strength have separate ownership.

## What renders

### Main price pane (`rb-st-trend-bands.pine` + signal dots from `rb-st-zones.pine`)

- **Trend Bands**: 4 `plotcandle` bands (CTF fast, CTF slow, HTF fast, HTF slow) rendered as candles on the main chart.
- **V1 Long dots**: green circles below candle at `low - ATR*2.5` (on V1 zone uptick events).
- **V1 Short dots**: red circles above candle at `high + ATR*2.5` (on V1 zone downtick events).
- **V2 Long dots**: lime crosses below candle at `low - ATR*2.5` (on V2 zone uptick events).
- **V2 Short dots**: orange crosses above candle at `high + ATR*2.5` (on V2 zone downtick events).

### Zones pane (`rb-st-zones.pine`, `overlay=false`)

- **Zone V1 markers**: dot markers connected by a line at fixed y-levels (rows 0-5) for zones -3 to +3.
- **Zone V2 markers**: dot markers connected by a line at fixed y-levels (rows 7-14) for zones -4 to +4.
- **Zero lines**: V1 zero at row 2.5 and V2 zero at row 10.5, halfway between -1 and +1.
- Neutral bars remain blank because the row layout has no neutral row.

### Trend Strength pane (`rb-st-trend-strength.pine`, `overlay=false`)

- **DI Histogram**: true `DI+ - DI-` values centered around zero.
- **DI Zero**: zero line at 0.
- **DI thresholds**: upper at +10, lower at -10.
- **DI+/DI-/DX/ADX**: hidden from pane (`display=display.data_window`), available in Data Window and CSV export.

## Fixed v1 parameters

| Parameter | Value | Constant |
|---|---|---|
| CTF fast length | 5 | `CTF_FAST_LENGTH` |
| CTF slow length | 10 | `CTF_SLOW_LENGTH` |
| HTF multiplier for Bands/Zones | 3 | `HTF_MULTIPLIER` |
| DI lookback for Trend Strength | 1 bar | `DI_LOOKBACK` |
| DI length | 14 | `DI_LENGTH` |
| DI upper threshold | +10 | `DI_UPPER_THRESHOLD` |
| DI lower threshold | -10 | `DI_LOWER_THRESHOLD` |
| ATR length | 14 | `ATR_LENGTH` |
| Zone dot ATR multiplier | 2.5 | `ZONE_DOT_ATR_MULTIPLIER` |
| Zone marker style | dots + connected line | `plot.style_circles` + `plot.style_line` |
| DI histogram offset | 0 (no offset) | — |

## TypeScript reference

The Pine port was translated from the following TypeScript implementations in `rel-str`:

| Component | TypeScript reference |
|---|---|
| Trend Bands | `functions/src/indicators/st-trend-bands.ts` |
| Zone V1 | `functions/src/indicators/st-zone.ts` |
| Zone V2 | `functions/src/indicators/st-zone-v2.ts` |
| Trend Strength | `functions/src/indicators/st-trend-strength.ts` |
| V1/V2 event dots | `src/app/features/shared/components/flex-chart/indicators/st-trend-rider-dots.indicator.ts` |

## Intentional differences and accepted limitations

### Developing HTF values (Bands/Zones by design)

The Trend Bands and Zones scripts use current/developing higher-timeframe boundary values for interim bars. They do not wait for HTF candle confirmation before painting. This means:

- Unconfirmed HTF values may change as the HTF candle develops.
- This is required for timely display and is not treated as a defect.
- Confirmed historical values will match; only the active HTF candle may differ.

The separate Trend Strength script uses chart-timeframe OHLC and `DI_LOOKBACK=1`; it does not request higher-timeframe data.

### Wilder smoothing recurrence (intentional)

The Trend Strength smoothing uses `previous - previous/period + current` (not the "canonical" `previous - previous/period + current/period`). This matches the historical Pine library and the visible `rbDI` reference plot.

### Trend Strength source divergence

The TypeScript `st-trend-strength.ts` implementation uses the shared Bands/Zones `HTF_MULTIPLIER=3`. The historical visible `rb-DI-plus-minus-plot.pine` calls its chart-timeframe DI calculation with the chart timeframe itself, producing a one-bar lookback. The dedicated `rb-st-trend-strength.pine` intentionally uses `DI_LOOKBACK=1` to match the old visible plot and avoid the jagged 3-bar lookback behavior. This is an explicit visual-parity decision, not an accidental parameter mismatch.

### Warm-up behavior

- **Trend Bands**: EMA seeds after `length` valid values. HTF bands seed after `length * HTF_MULTIPLIER` values.
- **Zone V1/V2**: Guarded by `stV1Ready`/`stV2Ready` — zones are 0 until all band midpoints are valid.
- **Trend Strength**: Guarded by `stDiReady` — DI+/DI-/DX/diHist return `na` for the first bar. The dedicated script uses `DI_LOOKBACK=1` to match the visible historical `rb-DI-plus-minus-plot.pine` series.
- **Event dots**: Cannot fire during warm-up (zones are 0, delta is 0, ATR is `na`).

### `ta.atr` vs TypeScript `computeATR`

Pine's `ta.atr(14)` uses Wilder's RMA with an SMA seed. The TypeScript `computeATR` uses an SMA seed + EMA-style smoothing. Values are equivalent at and beyond the first event bar. Warm-up values differ (Pine returns `na`, TypeScript returns a seed value), but no dots are plotted during warm-up.

### `force_overlay` on `plot()` and `plotcandle()`

`rb-st-trend-bands.pine` uses `overlay=true` for the main-pane Trend Bands. `rb-st-zones.pine` uses `force_overlay=true` only for its main-pane event dots while its Zone markers remain in the lower pane. This layout compiled and rendered successfully in the user's TradingView validation.

### `display.data_window` for hidden plots

DI+/DI-/DX/ADX plots use `display=display.data_window` to keep them out of the pane but available in the Data Window and "Export chart data" CSV output. This enables numeric validation without visual clutter. Pine v6 behavior needs TradingView verification.

### Plot styles

Zone V1/V2 use `plot.style_line` plus `plot.style_circles` for connected lines with dot markers. V1 signal dots use `plot.style_circles`; V2 signal dots use `plot.style_cross`. These styles compiled and rendered successfully in the user's TradingView validation.

### Pane layout

The scripts intentionally use separate lower panes:
- `rb-st-zones.pine`: V1 zone dots + connected line for -3 to +3 at rows 0-5, blank separator at row 6, V2 zone dots + connected line for -4 to +4 at rows 7-14.
- `rb-st-trend-strength.pine`: true DI histogram centered at zero, with thresholds at +10 and -10.

This avoids the misleading visual effect where a true DI histogram value was shifted below zero merely to avoid overlapping the zone rows.

## TradingView validation result

**Validated by the user in TradingView:** all three indicators were attached to the chart and visually inspected. The current Bands, Zones + signal dots, and Trend Strength implementations look good. The Trend Strength histogram now matches the smoother historical DI behavior after switching to `DI_LOOKBACK=1`; the zero, `+10`, and `-10` lines are present.

Task #235 remains intentionally open for future indicator changes and follow-up validation. No final ship/closure is recorded yet.

## TradingView validation checklist

The following checklist records the current validation state; future changes should re-run the affected checks:

### Compile

- [x] `rb-st-trend-bands.pine` compiles without errors in Pine v6.
- [x] `rb-st-zones.pine` compiles without errors in Pine v6.
- [x] `rb-st-trend-strength.pine` compiles without errors in Pine v6.
- [x] No warnings about deprecated functions or syntax.
- [x] All three indicators attach to the same chart without error.

### Main pane

- [x] 4 Trend Band candle sets render on the main chart.
- [x] V1 Long dots (green circles) appear below candles on zone uptick events.
- [x] V1 Short dots (red circles) appear above candles on zone downtick events.
- [x] V2 Long dots (lime crosses) appear below candles on zone uptick events.
- [x] V2 Short dots (orange crosses) appear above candles on zone downtick events.
- [x] V1 and V2 dots are visually distinguishable (circle vs cross shape).
- [x] Long and short dots are visually distinguishable (above vs below candle, different colors).
- [x] Dots only appear on signal events, not on every bar.

### Zones pane

- [x] Zone V1 dot markers and connected line render at rows 0-5 for zones -3 to +3.
- [x] Zone V2 dot markers and connected line render at rows 7-14 for zones -4 to +4.
- [x] Blank separator at row 6 between V1 and V2.

### Trend Strength pane

- [x] DI histogram is centered around its true zero value.
- [x] Zero line is at 0 (dotted).
- [x] Upper threshold is at +10 (dashed).
- [x] Lower threshold is at -10 (dashed).
- [x] Positive values render above zero and negative values below zero.

### Data Window / CSV export

- [ ] DI+, DI-, DX, ADX appear in the Data Window.
- [ ] V1 Long, V1 Short, V2 Long, V2 Short appear in the Data Window.
- [ ] Zone V1/V2 marker/line plots appear in the Data Window.
- [ ] "Export chart data" CSV includes the hidden DI plots.

### Developing HTF behavior

- [ ] Interim bars paint immediately during an active HTF candle.
- [ ] HTF values change as the HTF candle develops (repainting is expected).
- [ ] Confirmed historical HTF values are stable.

### Warm-up

- [ ] No spurious Zone marker or DI histogram spikes during the first ~30 bars in the relevant scripts.
- [ ] No event dots during warm-up.
- [ ] Zone V1/V2 starts at 0 during warm-up.

### Theme visibility

- [ ] All colors are visible on dark theme.
- [ ] All colors are visible on light theme (especially `color.white` for V1 zoneMinusOne).

## Differences classification

After TradingView validation, classify each difference as:

- **Defect** — Pine behavior does not match TypeScript and is not an accepted limitation.
- **Expected repainting** — Developing HTF values changing during active HTF candle.
- **Accepted Pine/runtime limitation** — Documented difference that cannot be resolved without TradingView platform changes.

Record each difference in this document with:
1. Component affected.
2. Description of the difference.
3. Classification (defect / expected / accepted).
4. TradingView symbol, timeframe, and date range where observed.
5. Whether a fix is needed (defects only).

## Cross-repository links

- **PRD:** `docs/topics/221-savant-trader/PRD-savant-trader-export-st-indicators.md`
- **Implementation plan:** `docs/topics/221-savant-trader/IMPL-savant-trader-export-st-indicators-shared.md`
- **Test plan:** `docs/topics/221-savant-trader/TEST-savant-trader-export-st-indicators-shared.md`
- **Code review:** `docs/topics/221-savant-trader/CODE-REVIEW-savant-trader-export-st-indicators.md`
- **Pine files:**
  - `rb-ps/rb-ta/ind/rb-st-trend-bands.pine` (main-pane Trend Bands; currently uncommitted)
  - `rb-ps/rb-ta/ind/rb-st-zones.pine` (Zones + event dots; currently uncommitted)
  - `rb-ps/rb-ta/ind/rb-st-trend-strength.pine` (dedicated Trend Strength pane; currently uncommitted)
