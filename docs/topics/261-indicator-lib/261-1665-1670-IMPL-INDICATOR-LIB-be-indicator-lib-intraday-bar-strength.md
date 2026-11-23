**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1670  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-21  
**Last Updated:** 2026-11-21  

# Implementation Plan — BE: IBS gate in ST Trend Rider signal detection

## Architecture overview

The IBS gate lives inside `detectAllStTrendRiderSignals` — the single backend detection function consumed by both the strategy path (`st-trend-rider.strategy.ts` → `detectLastBarSignals`) and the per-interval signal pipeline (`indicator-computation.ts`). One insertion point gates every `D_`/`W_`, `V1`/`V2` LONG/SHORT emission.

Gate config arrives via the existing `StrategyConfig` heterogeneous bag (currently unused by this strategy); `computeIbs` comes from `@st/ibs` (SHARED Blueprint).

## Boundary

Covers: the gate inside `detectAllStTrendRiderSignals`, config plumbing from `StrategyConfig` through `detectLastBarSignals`, the `ibs` value in emitted signals' `indicators` payload, unit specs, and a verify script.

Does **not** cover: `computeIbs` itself (SHARED), suppressed-signal visibility (FE-only), FE dots detection, Pine. Suppressed signals are dropped silently — no persistence, no diagnostic channel beyond what spec output and the verify script print.

## Files

```
functions/src/st-cloud-function/strategies/signal-detection.ts      — modified: IBS gate inside detectAllStTrendRiderSignals; new optional gate-config param threaded through detectLastBarSignals
functions/src/st-cloud-function/strategies/st-trend-rider/st-trend-rider.strategy.ts — modified: read ibs config from StrategyConfig, pass through to both daily + weekly calls
functions/src/st-cloud-function/indicator-computation.ts            — modified: pass default gate config into its detectAllStTrendRiderSignals call sites (if any explicit ctx needed; else no change beyond signature compat)
functions/scripts/verify/ibs-trend-rider-filter-{task#}.ts          — NEW: replay a real symbol's bars; print emitted vs suppressed counts per V1/V2/timeframe
functions/scripts/verify/run-all.ts                                 — modified: register verify script
tests/functions/st-signal-detection-ibs-{task#}.test.ts             — NEW (or extend existing signal-detection suite): gate specs
```

## Modules

### 1. `signal-detection.ts` — `IbsGateConfig` + gate (modified)

```typescript
export interface IbsGateConfig {
  threshold?: number;        // default 0.5; long bound = T, short bound = 1 − T
  activateAtEtMin?: number;  // passthrough to computeIbs
  activateAtWeekday?: number;
  now?: Date;                // injectable for tests/replay; default wall clock
}

export function detectAllStTrendRiderSignals(
  ltfZone: number[],
  windowV2: number[],
  ltfBars: OHLCV[],
  version: 'V1' | 'V2',
  timeframe: 'D' | 'W',
  ibs?: IbsGateConfig,            // new optional trailing param — backward compatible
): ZoneSignal[]
```

At each point the state machine would `signals.push(...)`:

```typescript
const ibs = computeIbs(
  { high: ltfBars[i].high, low: ltfBars[i].low, close: ltfBars[i].close, date: barDate(ltfBars[i]) },
  timeframe,
  { now: ibsCfg?.now, activateAtEtMin: ibsCfg?.activateAtEtMin, activateAtWeekday: ibsCfg?.activateAtWeekday },
);
const T = ibsCfg?.threshold ?? 0.5;
const suppressed =
  (isLong  && ibs !== undefined && ibs < T) ||
  (isShort && ibs !== undefined && ibs > 1 - T);
if (suppressed) continue;   // state machine still transitions — suppression is emission-only
```

Key detail: suppression skips **emission**, not the state transition — `longState`/`shortState` still move to `FIRED`, preserving the "no repeat until re-arm" semantics. The candidate simply never enters `signals`.

- `detectLastBarSignals` gains the same trailing optional param and passes it through.
- `barDate()` — reuse the existing bar-date extraction (`d`/`date`/`t` aliases already normalized in `normalizeBars`).

### 2. `st-trend-rider.strategy.ts` — config plumbing (modified)

`execute(input, config)` currently ignores `config` (`_config`). Read `config['ibsThreshold']`, `config['ibsActivateAtEtMin']`, `config['ibsActivateAtWeekday']` (numeric, defaults handled downstream) into an `IbsGateConfig`, pass to all four `detectLastBarSignals` calls (V1/V2 × D/W). `now` is never set here — wall clock is the run's truth.

Emitted `indicators` payload: add `ibs` alongside the existing `zone*` entries — `indicators: { ..., ibs: <computed value | null> }`.

### 3. `indicator-computation.ts` — call-site compatibility (modified)

Its `detectAllStTrendRiderSignals` call sites get the default gate config — verify at impl whether the per-interval pipeline wants `now` injected from the run context or wall clock; default is wall clock.

### 4. Verify script — `ibs-trend-rider-filter-{task#}.ts` (new)

Loads a real symbol's stored daily + weekly bars (same path the run uses), runs `detectAllStTrendRiderSignals` twice — once unfiltered (`ibs` omitted), once gated — and prints per V1/V2 × D/W: total candidates, emitted, suppressed, suppression %. This is the empirical check on the "~10–25% of signals" estimate.

### 5. Specs — `st-signal-detection-ibs-{task#}.test.ts` (new)

Synthetic zone arrays + synthetic `OHLCV` bars with hand-computed IBS at/around the boundaries; `now` injected for availability cases. See TEST doc.

## Contracts

- `ZoneSignal.indicators` gains an `ibs` key (`number | null`) — additive, no schema migration; consumers reading unknown keys unaffected.
- `detectAllStTrendRiderSignals` / `detectLastBarSignals` signature extension is **optional-trailing-param** — all existing call sites compile unchanged.
- `StrategyConfig` keys: `ibsThreshold`, `ibsActivateAtEtMin`, `ibsActivateAtWeekday` — documented for `configSchema` if the strategy declares one (check `configSchema` field at impl).

## Decisions

- Gate inside `detectAllStTrendRiderSignals`, not at the strategy call sites — one insertion point covers strategy path AND `indicator-computation.ts`; call-site filtering would fork the rule.
- Suppression = `continue` before `signals.push` — preserves re-arm semantics; a suppressed uptick doesn't allow a second signal on the same swing.
- `ibs` recorded on emitted signals — auditable "why did this pass" without persisting suppressed candidates (PRD: suppressed never persist).
- Wall-clock `now` in production paths — runs are real-time by definition; historical bars always return defined IBS regardless.

## Sequence / phases

1. `IbsGateConfig` + gate + `detectLastBarSignals` pass-through + specs — one task.
2. `st-trend-rider.strategy.ts` config plumbing + `indicators.ibs` + `indicator-computation.ts` compat — same task or fast-follow.
3. Verify script + `run-all.ts` registration — separate task (manual-execution deliverable).

## Prior art / regression

- `detectAllStTrendRiderSignals` state machine — the READY/FIRED logic must produce identical candidate signals when `ibs` is omitted/undefined on every bar (regression-identical unfiltered behavior).
- Existing `tests/functions/` signal-detection specs — extend rather than duplicate the suite scaffolding.
- Verify-script conventions: `functions/scripts/verify/` + `run-all.ts` registry (see README there for the entry format).

## Verify relay

- `cd functions && npm run test:sds`-adjacent — actually the relevant `tests/functions` jest suite: `npx jest tests/functions` (or the suite's package script).
- Verify script: `npx tsx functions/scripts/verify/ibs-trend-rider-filter-{task#}.ts` — prints suppression table vs unfiltered baseline.
- `npx tsc --noEmit -p functions` — `@st/ibs` resolution + signature compat.

## Risks / open seams

- **Config reach:** strategy config comes from Firestore strategy docs — confirm at impl that `StrategyConfig` actually flows the new keys (it's a heterogeneous bag; but if `configSchema` whitelists keys, add them).
- **`indicator-computation.ts` `now`:** its call sites may run during backfill — if backfill replays a historical "today", wall-clock `now` could mislabel a past developing bar as current. Edge case: bar.date == today is only true for genuinely current bars; historical backfill bars predate today → always defined → filtered. Safe.
- **Double gating in the same process:** if a caller filters upstream AND the function gates, suppression compounds — flag in code comments: `ibs` param is the single gate.
