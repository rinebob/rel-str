**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1670  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-11-21  
**Last Updated:** 2026-11-21  

# Test Plan — SHARED: IBS computation + Pine port

## Scope

`shared/st-ibs.ts` (`computeIbs` + availability rule) and the `rb-st-zones.pine` gate. BE/FE *consumption* of the function is covered by their own TEST plans; this plan covers the function itself and the Pine parity.

## E2E User Journeys

- Pine manual check: paste `rb-st-zones.pine` into TradingView on a daily chart (e.g., SPY) → confirm signal markers vanish on bars whose IBS contradicts the direction at `ibsThreshold 0.5`; enable `showSuppressedSignals` → hollow markers appear at those bars. Compare against the web flex-chart for the same symbol — suppressed sets match modulo Pine availability approximation.

## Integration Tests

- `computeIbs` imported via the `@st/ibs` alias from BOTH a functions-side spec and an app-side spec — proves the dual tsconfig/jest alias wiring, not just the function.

## Unit Tests

`shared/st-ibs.spec.ts`, table-driven:

- **Formula:** close at high → 1.0; close at low → 0.0; close at midpoint → 0.5; arbitrary interior point → correct fraction.
- **Zero-range:** `high === low` → 0.5 (never `NaN`/`Infinity`), regardless of availability.
- **Daily availability** (`now` injected):
  - bar.date == today, `now` = 11:59 ET → `undefined`; `now` = 12:00 ET → defined (boundary inclusive).
  - bar.date == today, `now` = 08:00 ET → `undefined` (early-run pass-through).
  - bar.date == yesterday → defined at ANY `now`.
  - `activateAtEtMin` override (e.g., 600) respected.
- **Weekly availability:**
  - bar.date in current ET week, `now` weekday < Wednesday → `undefined`; Wednesday onward → defined.
  - bar.date in a prior week → defined.
  - `activateAtWeekday` override respected.
- **`ctx` omitted** → wall-clock path executes without throwing.

## Test Seams

- Highest seam: the pure function call itself — no Firebase, no Angular, no chart. All availability cases via injected `now` — **never** `jest.useFakeTimers` (AGENTS.md: the `setTimeout` flush hangs under fake timers).

## Test data / fixtures

- Synthetic bars: `{high: 110, low: 100, close: 108}` → IBS `0.8`; `{high: 100, low: 100, close: 100}` → `0.5`; `{high: 110, low: 100, close: 102}` → `0.2`.
- Fixed `now` values: `new Date('2026-11-24T12:00:00-05:00')` (Tuesday 12:00 ET) and a Wednesday-morning `now` for weekly boundary cases; bar dates as `YYYY-MM-DD` market dates matching the pipeline's `d` field.

## Existing Test Coverage

- `shared/*.spec.ts` suites (e.g., `st-signals`, `flex-chart-indicator-visuals`) — pattern for pure shared-module specs; imitate structure, `jest.fn()`/`expect.*` directly.

## Edge Cases

- `high < low` (malformed bar) — treated same as zero-range (range ≤ 0 → 0.5); pinned by spec.
- Bar date exactly at period boundary (Friday vs Monday for weekly membership) — ISO-week math must not leak Friday's bar into the next week.
- `now` in a non-ET timezone host — conversion uses `America/New_York` explicitly; a UTC `now` at 12:00Z must NOT read as 12:00 ET.

## Verify relay

- `npx jest shared/st-ibs.spec.ts`
- `npx tsc --noEmit -p functions` + `npx tsc --noEmit` (app) — alias compiles both sides.
- Pine: manual TradingView UAT (journey above).
