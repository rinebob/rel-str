# ST-Zone Signal Scanner — RH Agent Strategy

## Overview

Replace the current RSI-based signal scanner with the **zone uptick signal** strategy. The worker scans all enabled symbols on **both daily and weekly timeframes**, detecting V1 and V2 zone uptick signals for both long and short directions.

- **Daily signals**: daily bars + weekly HTF context (weekly zone V2 > 0 = long window)
- **Weekly signals**: weekly bars + monthly HTF context (monthly zone V2 > 0 = long window)

This is the same signal logic used on the frontend charts (`detectZoneUptickDots`), now running server-side in the Cloud Function worker.

---

## Signal Logic (same as frontend)

### Long Signal
1. Weekly zone V2 > 0 (long window open)
2. Daily zone (V1 or V2) was falling or flat
3. Daily zone upticks for one bar → **signal**
4. No repeat until zone falls again

### Short Signal
1. Weekly zone V2 < 0 (short window open)
2. Daily zone (V1 or V2) was rising or flat
3. Daily zone downticks for one bar → **signal**
4. No repeat until zone rises again

### Output
- V1 uptick signals (zone range -3/+3)
- V2 uptick signals (zone range -4/+4)
- Both emitted independently per symbol

---

## Data Requirements

| Data | Source | Path |
|------|--------|------|
| Daily bars | `rs-symbol-cache/{marketDate}/symbols/{symbol}` → `dailyBars` | Already used |
| Weekly bars | Same cache doc → `weeklyBars` | **New**: worker needs to read this too |
| Monthly bars | Same cache doc → `monthlyBars` | **New**: worker needs to read this too |

- Daily bars: minimum ~45 bars needed (30 for indicator warm-up + lookback)
- Weekly bars: minimum ~30 bars for weekly zone computation + HTF context for daily
- Monthly bars: minimum ~30 bars for monthly zone V2 (HTF context for weekly signals)

---

## Architecture Changes

### 1. Remove non-ST strategies
- Delete `strategies/rsi-oversold-bounce/`
- Delete `strategies/macd-crossover/`
- Simplify `StrategyId` enum to just `ST_ZONE_UPTICK`
- Remove RSI/MACD-related `IndicatorId` entries
- Clean up `base-strategy.ts` types

### 2. New strategy: `st-zone-uptick`

**File:** `strategies/st-zone-uptick/st-zone-uptick.strategy.ts`

**Inputs:**
- `bars` (daily OHLCV[]) — already provided by worker
- `weeklyBars` (weekly OHLCV[]) — needs to be added to `StrategyInput`
- `monthlyBars` (monthly OHLCV[]) — needs to be added to `StrategyInput`

**Algorithm (daily signals):**
1. Compute weekly zone V2 from `weeklyBars` → HTF context for daily
2. Compute daily zone V1 from `bars` → LTF zone data
3. Compute daily zone V2 from `bars` → LTF zone data
4. Run state machine, check if LAST bar fires a signal

**Algorithm (weekly signals):**
1. Compute monthly zone V2 from `monthlyBars` → HTF context for weekly
2. Compute weekly zone V1 from `weeklyBars` → LTF zone data
3. Compute weekly zone V2 from `weeklyBars` → LTF zone data
4. Run state machine, check if LAST bar fires a signal

**Output (array — multiple signals per bar allowed):**
- `action`: 'OPEN_LONG' | 'OPEN_SHORT' | null
- `signalType`: 'ZONE_V1_UPTICK' | 'ZONE_V1_DOWNTICK' | 'ZONE_V2_UPTICK' | 'ZONE_V2_DOWNTICK'
- `reason`: descriptive string
- `indicators`: { zoneV1, zoneV2, weeklyZone, delta }

If both V1 and V2 fire on the same bar, both are emitted as separate opportunities.

### 3. Worker changes
- Add `weeklyBars` to `StrategyInput` interface
- Fetch `weeklyBars` from cache alongside `dailyBars`
- Change `DEFAULT_STRATEGY` to `'st-zone-uptick'`
- Remove stale RSI/MACD references

### 4. Backend indicator math
- Already exists: `functions/src/indicators/st-zone.ts` → `computeStZone()`
- **Needed**: `st-zone-v2.ts` (4-band version) — port from frontend `st-zone-v2.indicator.ts`
- Reuse existing `computeStTrendBands()` for both

---

## Strategy Output → Opportunity Mapping

| Signal | Timeframe | Action | SignalType | Strategy |
|--------|-----------|--------|-----------|----------|
| V1 zone uptick (weekly HTF > 0) | Daily | OPEN_LONG | D_ZONE_V1_UPTICK | st-zone-uptick |
| V1 zone downtick (weekly HTF < 0) | Daily | OPEN_SHORT | D_ZONE_V1_DOWNTICK | st-zone-uptick |
| V2 zone uptick (weekly HTF > 0) | Daily | OPEN_LONG | D_ZONE_V2_UPTICK | st-zone-uptick |
| V2 zone downtick (weekly HTF < 0) | Daily | OPEN_SHORT | D_ZONE_V2_DOWNTICK | st-zone-uptick |
| V1 zone uptick (monthly HTF > 0) | Weekly | OPEN_LONG | W_ZONE_V1_UPTICK | st-zone-uptick |
| V1 zone downtick (monthly HTF < 0) | Weekly | OPEN_SHORT | W_ZONE_V1_DOWNTICK | st-zone-uptick |
| V2 zone uptick (monthly HTF > 0) | Weekly | OPEN_LONG | W_ZONE_V2_UPTICK | st-zone-uptick |
| V2 zone downtick (monthly HTF < 0) | Weekly | OPEN_SHORT | W_ZONE_V2_DOWNTICK | st-zone-uptick |

A single symbol can produce up to 8 opportunities per run (4 daily + 4 weekly) — though in practice only 1-2 will fire per timeframe since the window can only be one direction at a time. If V1 and V2 both fire on the same bar, both are listed.

---

## Implementation Plan

### Phase 1: Backend indicator math
1. Create `functions/src/indicators/st-zone-v2.ts` — port V2 logic from frontend
2. Export `computeStZoneV2(bars)` returning zone array

### Phase 2: New strategy
3. Create `strategies/st-zone-uptick/st-zone-uptick.strategy.ts`
4. Implements the state machine for V1 + V2 signals
5. Only fires if signal is on the **last bar** (today's bar)

### Phase 3: Worker updates
6. Extend `StrategyInput` to include `weeklyBars?: OHLCV[]` and `monthlyBars?: OHLCV[]`
7. Update `getCachedBars` → fetch `dailyBars`, `weeklyBars`, and `monthlyBars` from cache
8. Change `DEFAULT_STRATEGY` to `StrategyId.ST_ZONE_UPTICK`
9. Remove RSI/MACD from registry

### Phase 4: Cleanup
10. Delete `strategies/rsi-oversold-bounce/`
11. Delete `strategies/macd-crossover/`
12. Simplify `base-strategy.ts` — remove unused IndicatorId/MaType enums
13. Update `RhTradeOpportunity.strategy` type

---

## Multiple Signals Per Symbol

The strategy returns an **array** of signals. If V1 and V2 both fire on the same bar, both are stored as separate opportunities. The opportunity ID encodes signal type so there's no collision: `2026-06-20_fri_AAPL_OPEN_LONG_D_ZONE_V1_UPTICK` vs `2026-06-20_fri_AAPL_OPEN_LONG_D_ZONE_V2_UPTICK`.

Change `StrategyOutput` → `StrategyOutput[]` (or rename to `execute() → StrategySignal[]`).

---

## File Changes Summary

| Action | File |
|--------|------|
| Create | `functions/src/indicators/st-zone-v2.ts` |
| Create | `functions/src/rh-agent-cloud-function/strategies/st-zone-uptick/st-zone-uptick.strategy.ts` |
| Modify | `functions/src/rh-agent-cloud-function/strategies/base-strategy.ts` |
| Modify | `functions/src/rh-agent-cloud-function/strategies/strategy-registry.ts` |
| Modify | `functions/src/rh-agent-cloud-function/rh-agent-worker.ts` |
| Delete | `functions/src/rh-agent-cloud-function/strategies/rsi-oversold-bounce/` |
| Delete | `functions/src/rh-agent-cloud-function/strategies/macd-crossover/` |
