# Verification Guide: indicator-lib-877 - Trigger Bands in the indicator series

## Scripts

### indicator-lib-877-callable.ts

Verifies the Trigger Bands wiring in the indicator-series pipeline against real cached bars, loaded exactly as the callable loads them.

**Command:**
```
cd functions
npx tsx scripts/verify/indicator-lib-877-callable.ts [SYMBOL]
```

**Arguments:** `SYMBOL` (optional, default `AAPL`): any symbol with daily, weekly and monthly bars in `symbol-data`.

**Prerequisites:** Application Default Credentials with access to the rel-str Firestore `symbol-data` collection. IPv4-only Node preload (see `AGENTS.md`).

**What it does** (for daily, weekly and monthly):
1. Runs `computeSymbolIndicatorSeries` and checks `indicators.triggerBands` has one point per bar, aligned to the bar dates, equal to `computeStTriggerBands` (bands and all six flags), ending on the last bar.
2. Checks `dotMarkers.triggerBands`: one dot per pullback/breakout flag, tagged `TB`, long dots below the bar low, short dots above the bar high.
3. Runs `filterResponse`: the default request returns no Trigger Bands; a request that adds `IndicatorFamily.TRIGGER_BANDS` returns the series and dots for every interval.
4. Prints the payload size of the default response versus the opt-in response.

**Passing:** `N/N checks passed`, exit 0. **Failing:** any `FAIL` line, exit 1.