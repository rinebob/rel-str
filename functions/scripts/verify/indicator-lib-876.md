# Verification Guide: indicator-lib-876 - ST Trigger Bands Engine

## Scripts

### indicator-lib-876-engine.ts

Verifies `computeStTriggerBands` (`functions/src/indicators/st-trigger-bands.ts`) against real daily bars from Firestore.

**Command:**
```
cd functions
npx tsx scripts/verify/indicator-lib-876-engine.ts [SYMBOL] [LAST_N]
```

**Arguments:**
- `SYMBOL` (optional, default `SPY`): any symbol with daily bars in `symbol-data`.
- `LAST_N` (optional, default `15`): how many trailing bars to print for comparison with TradingView.

**Prerequisites:** Application Default Credentials with access to the rel-str Firestore `symbol-data` collection. IPv4-only Node preload (see `AGENTS.md`).

**What it does:**
1. Loads the symbol's daily bars via `loadAllDailyBars`.
2. Structure: one entry per bar, null bands for the first two bars, finite bands after, `upper >= lower`, bands enclose the current body.
3. Agreement: recomputes every flag with a naive reference written straight from the PRD definitions and requires identical arrays for all six flags.
4. Invariants: a breakout never coincides with a pullback, always follows an armed state, and leaves the state off.
5. Prints counts and a table of the last N bars (bands plus long/short pullback, state and breakout flags: LPB/LPS/LBK, SPB/SPS/SBK).

**Passing:** ends with `N/N checks passed` and exit code 0.
**Failing:** any `FAIL` line, a final count below N/N, exit code 1.

**Manual follow-up (Pine parity):** compare the printed last-N table with the TradingView chart (`rb-st-trigger-bands.pine`) on the same symbol; breakout (`x` under LBK/SBK) bars should coincide with the Pine breakout markers. This is tracked in #878.

### indicator-lib-876-tv-parity.ts

Compares the engine against the TradingView script using a TradingView "Export chart data" CSV (no Firestore needed).

**Command:**
```
cd functions
npx tsx scripts/verify/indicator-lib-876-tv-parity.ts "<path-to-csv>" [WARMUP_BARS]
```

**Arguments:**
- `<path-to-csv>` (required): export made with `rb-st-trigger-bands.pine` applied; needs the columns `time, open, high, low, close, Upper, Lower, longPullbackState, longBreakout, shortPullbackState, shortBreakout`.
- `WARMUP_BARS` (optional, default 30): leading bars skipped because the Pine state carries history before the export starts.

**What it does:** runs `computeStTriggerBands` on the CSV's own bars and compares `Upper`/`Lower` (tolerance 0.005) and the four plotted flags (a non-empty cell = true) on every bar after the warm-up.

**Passing:** `PASS: bands and all four plotted flags match on every compared bar`, exit 0. **Failing:** `FAIL: N mismatch(es)` with the first 40 listed, exit 1. A warning prints if either side has no breakouts (weak comparison).

Not part of `run-all.ts` because it needs a manually exported file.
