**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1670  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-21  
**Last Updated:** 2026-11-21  

# Test Plan — BE: IBS gate in ST Trend Rider signal detection

## Scope

The IBS gate inside `detectAllStTrendRiderSignals`, `StrategyConfig` plumbing through `st-trend-rider.strategy.ts`, the `ibs` key on emitted `indicators`, and the verify script. Coverage targets `D`/`W` × `V1`/`V2` × LONG/SHORT.

## E2E User Journeys

- Verify script on a real stored symbol (e.g., SPY daily + weekly bars): run `ibs-trend-rider-filter-{task#}.ts` → prints per-version/timeframe candidates vs emitted vs suppressed — confirms the gate fires in the real pipeline and quantifies suppression vs the ~10–25% estimate.

## Integration Tests

- `st-trend-rider.strategy.ts` `execute()`: synthetic `StrategyInput` (daily + weekly bars) + `StrategyConfig` carrying `ibsThreshold` → outputs contain only IBS-passing signals; emitted `indicators.ibs` present and correct.
- `indicator-computation.ts` path: its `detectAllStTrendRiderSignals` call sites produce gated markers with default config.

## Unit Tests

New spec `tests/functions/st-signal-detection-ibs-{task#}.test.ts` (or extend the existing detection suite):

- **Long gate:** uptick candidate on a bar with IBS `0.8` → emitted; IBS `0.4` → suppressed; IBS exactly `0.5` → emitted (inclusive).
- **Short gate:** downtick candidate IBS `0.2` → emitted; `0.6` → suppressed; `0.5` → emitted.
- **Availability pass-through:** `now` injected pre-activation + last bar dated today → candidate emits unfiltered.
- **Threshold override:** `threshold: 0.6` → IBS `0.55` long suppressed, `0.65` emitted.
- **State-machine integrity:** a suppressed uptick still transitions state (READY→FIRED) — a later re-arm does NOT re-fire a phantom signal; identical candidate list vs unfiltered when `ibs` param omitted (regression-identical path).
- **V1/V2 + D/W matrix:** at minimum V1-D, V2-D, V2-W covered — weekly uses weekly bars and the weekday availability rule.

## Test Seams

- Highest seam: `detectAllStTrendRiderSignals` called directly with synthetic arrays — no Firestore, no orchestrator. `now` injected through `IbsGateConfig`; no fake timers.
- Lower seam: `computeIbs` unit specs (SHARED TEST) cover the function itself — BE specs stub realistic bars, they do NOT re-test the formula.

## Test data / fixtures

- Synthetic `OHLCV[]` bar runs producing a known zone uptick/downtick sequence (imitate existing detection-spec fixtures), with hand-computed IBS values at `0.2 / 0.4 / 0.5 / 0.6 / 0.8` on the signal bar.
- `IbsGateConfig` fixtures: `{}` (defaults), `{threshold: 0.6}`, `{now: <fixed pre/post-activation dates>}`.

## Existing Test Coverage

- Existing `tests/functions/` trend-rider / signal-detection suites — the state-machine fixtures and assertion style to imitate; existing specs must stay green unmodified (backward-compat trailing param).

## Edge Cases

- Signal bar with zero range (H==L → IBS 0.5): at default threshold, 0.5 passes BOTH bounds — a flat bar can signal (inclusive semantics, pinned).
- Bar with missing/null H-L-C fields → `computeIbs` guard; behavior pinned (either `undefined` → pass, or documented throw).
- Suppressed candidate mid-array followed by a valid uptick later — only the valid one emits.

## Verify relay

- `npx jest tests/functions` (or the functions jest suite script) — new + existing specs green.
- `npx tsx functions/scripts/verify/ibs-trend-rider-filter-{task#}.ts` — suppression table printed.
- `npx tsc --noEmit -p functions`.
