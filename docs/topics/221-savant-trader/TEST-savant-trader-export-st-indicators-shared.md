**Topic:** Export ST indicators to PineScript for TradingView  
**Issue:** #224  
**Topic Parent:** #221  
**Domain:** SAVANT-TRADER  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-09-05  
**Last Updated:** 2026-09-05  

# Test Plan: ST PineScript Port

## E2E User Journeys

- Maintainer opens the standalone Pine file from `rb-ps`, copies it into TradingView, and adds it to an OHLC chart.
- User sees Trend Bands in the main price pane, Zone V1/V2 and Trend Strength in lower panes, and Zone V1/V2 event dots over price.
- User watches an active higher-timeframe candle and sees interim bars update using current developing values.
- Maintainer compares the Pine display against the existing TypeScript ST behavior and records any intentional differences.

## Integration Tests

- The single Pine file compiles in Pine v6 without imports that require the app or a local TypeScript runtime.
- The indicator renders all four ST families from one chart attachment.
- Main-pane Trend Bands and Zone V1/V2 event dots coexist with the lower-pane series.
- The script remains read-only: it does not place orders, call a broker, call the app, or persist data.
- Optional TradingView chart-data CSV export exposes enough named plots to investigate a visual discrepancy.

## Unit-level verification targets

- EMA seed and recursive update behavior.
- `na`/missing-value handling.
- CTF and HTF recursive Heikin-Ashi state.
- Trend Band OHLC, midpoint, direction, and crossover behavior.
- Zone V1 and Zone V2 values and transitions.
- Trend Strength values and thresholds.
- Zone V1/V2 event indexes, directions, and ATR marker coordinates.

## Test Seams

- Highest seam: one-file TradingView chart rendering and visual comparison against the existing ST chart behavior.
- Lower seam: named Pine plots and optional TradingView CSV values for the affected calculation.
- Reference seam: pure TypeScript indicator behavior in `rel-str` and the original Pine sources in `rb-ps`.

## Existing Test Coverage

- Existing pure TypeScript indicator modules and chart calculators provide the current behavior reference.
- Existing migration notes and original Pine scripts provide historical algorithm references.
- This plan verifies the standalone Pine view without modifying the current quick-charts implementation.

## Edge Cases

- Insufficient warm-up history and leading `NaN`/`na` values.
- Missing or irregular bars.
- Flat bars and equal band open/close values.
- Crossover on the first valid bar after warm-up.
- Zone-neutral bars.
- V1 and V2 events on the same bar.
- Long and short markers at identical or near-identical prices.
- Developing HTF values changing during an active HTF candle.
- Confirmed historical HTF values differing from developing realtime values.
- Different chart timeframe, symbol session, timezone, or available history.
- TradingView export omitting hidden plots or insufficiently loaded history.
- Pine library import/version differences; the final script must remain locally usable.

## Comparison policy

Visual parity is the primary v1 validation method. Numeric CSV comparison is optional and should be used when a visual discrepancy cannot be explained. Developing-HTF differences are expected when the active higher-timeframe candle changes. Every remaining difference is recorded as a defect or an explicitly accepted Pine/runtime limitation.
