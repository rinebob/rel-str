# UAT — ST Trigger Bands engine (#876)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #881  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #876  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Scope

Task #876 delivers only the pure backend engine `computeStTriggerBands` (`functions/src/indicators/st-trigger-bands.ts`): body-based length-3 Donchian bands plus long/short pullback, pullback-state and breakout flags per bar. It has no user-facing surface yet; callable wiring is #877, chart rendering #879/#880, the cleaned Pine script #878. Acceptance covered here: PRD #863 stories 1 and 4 (band values; per-bar flags matching Pine), at engine level.

## Prerequisites

- Repo `C:\aa\projects\rel-str`, dependencies installed in `functions/`.
- For scenarios 2-3: Application Default Credentials with read access to the rel-str Firestore `symbol-data` collection, and the IPv4-only Node preload (`AGENTS.md`).
- For scenario 3: a TradingView account with the original `rb-st-trigger-bands.pine` (repo copy: `rb-ps/rb-ta/ind/rb-st-trigger-bands.pine`) loaded on a daily chart.

## Scenarios

### 1. Unit tests (automated)

- **Steps:** `cd functions` then `npx tsx --test ../tests/functions/st-trigger-bands.test.ts`
- **Expected:** 21 tests, 21 pass, 0 fail. Covers golden bar sets, wick-vs-body, doji, flat market, re-arm after breakout, equal-to-band, no-prior-pullback and three mirror-symmetry sets.
- **Result:** PASS, 21/21 (2026-10-07).

### 2. Real-data engine verification (automated)

- **Steps:** from `functions/`: `npx tsx scripts/verify/indicator-lib-876-engine.ts SPY 12`, then the same with `AAPL`.
- **Expected:** ends with `18/18 checks passed`: structure checks, exact agreement of all six flag arrays with an independent reference, and breakout/state invariants. Exit code 0.
- **Result:** PASS. SPY 18/18 (1,823 bars; long breakouts 298 / short 237 per the first run), AAPL 18/18 (1,823 bars; long pullback 1,108, long breakout 283, short pullback 1,329, short breakout 238) (2026-10-07).

### 3. Parity with the TradingView script (manual export + script)

- **Steps:**
  1. In TradingView, on AAPL daily with `rb-st-trigger-bands.pine` applied (length 3, body mode), use **Export chart data** and save the CSV (the export carries the bars plus the script's plots `Upper`, `Lower`, `longPullbackState`, `longBreakout`, `shortPullbackState`, `shortBreakout`).
  2. From `functions/`: `npx tsx scripts/verify/indicator-lib-876-tv-parity.ts "<path-to-csv>" 30`
- **Expected:** `PASS: bands and all four plotted flags match on every compared bar`. The engine runs on the CSV's own bars, so a difference would be a logic difference, not a data-feed difference. The first 30 bars are skipped because the Pine state carries earlier history the export lacks. Exit code 0.
- **Result:** PASS (2026-10-07). `BATS_AAPL, 1D` export, 520 daily bars (2024-09-11 .. 2026-10-07), 490 compared: bands within 0.005 and all four flags identical on every bar. TV flag counts compared: longPullbackState 292, longBreakout 73, shortPullbackState 359, shortBreakout 57 (breakouts on both sides, so the comparison is not vacuous). Earlier spot checks of the last two bars via Pine logs also matched.
- **Not covered:** the raw `longPullback` / `shortPullback` flags are not plotted by the script, so they are checked only indirectly through the pullback states (a state turns on at its first pullback bar).
### 4. Build

- **Steps:** `cd functions` then `npm run build`
- **Expected:** esbuild completes without errors.
- **Result:** PASS (2026-10-07).

## Traceability

| Criterion | Scenario |
|---|---|
| Returns bands and all six flag arrays per bar (#876 AC 1) | 1, 2 |
| Body-based length-3 bands; null warm-up (AC 2) | 1, 2 |
| Crossover/state semantics match Pine (AC 3, 4) | 1, 2, 3 |
| Unit tests per test plan (AC 5) | 1 |
| Verification script on a real symbol (AC 6) | 2 |
| Build passes (AC 7) | 4 |
| PRD story 4: flags match Pine on the same bars | 3 |

## Regression / smoke

- `npx tsx --test ../tests/functions/std-dev-lines.test.ts ../tests/functions/signal-detection-zero-cross.test.ts` (neighbouring indicator and signal suites): 74/74 together with the new tests, 2026-10-07.
- No existing file changed behavior; the only edits to existing files are the verify README index row and the `run-all.ts` registration.
