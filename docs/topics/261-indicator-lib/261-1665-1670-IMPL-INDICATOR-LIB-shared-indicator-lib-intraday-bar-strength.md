**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1670  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-11-21  
**Last Updated:** 2026-11-21  

# Implementation Plan — SHARED: IBS computation + Pine port

## Architecture overview

One shared pure module — `shared/st-ibs.ts` — owns the IBS formula *and* the availability rule, consumed by both the FE (`src/app` via `@st/` alias) and the BE (`functions/` via `@st/` alias). This deviates deliberately from the port-per-side convention used for chart-coupled indicators: `computeIbs` has zero Angular/chart dependencies, so a single source prevents the ET/availability logic from forking.

A second work item in this area keeps `rb-st-zones.pine` in parity: same gate, same inputs, Pine-native availability approximation.

## Boundary

Covers: the IBS function, its spec, the alias wiring that makes it importable from both runtimes, and the Pine port.

Does **not** cover: where the gate is applied (BE `signal-detection.ts` / FE `detectZoneUptickDots` — those are the BE/FE areas), the `showSuppressedSignals` rendering (FE), or config plumbing through `StrategyConfig` (BE). The SHARED surface ends at the function signature below.

## Files

```
shared/st-ibs.ts                  — NEW: computeIbs + availability rule
shared/st-ibs.spec.ts             — NEW: table-driven unit specs
tsconfig.json                     — modified: add "@st/ibs" path → ./shared/st-ibs.ts
functions/tsconfig.json           — modified: add "@st/ibs" path → ../shared/st-ibs.ts
jest.config.js                    — modified: moduleNameMapper '^@st/ibs$'
rb-ps/rb-ta/ind/rb-st-zones.pine  — modified: IBS gate + inputs + suppressed-marker toggle
```

## Modules

### 1. `shared/st-ibs.ts` — `computeIbs` (new)

```typescript
export type IbsTimeframe = 'D' | 'W';

export interface IbsAvailabilityContext {
  now?: Date;              // injectable; default wall clock
  activateAtEtMin?: number; // daily activation, minutes after ET midnight; default 720 (12:00)
  activateAtWeekday?: number; // weekly activation weekday (Sun=0); default 3 (Wednesday)
}

export function computeIbs(
  bar: { high: number; low: number; close: number; date?: string },
  timeframe: IbsTimeframe,
  ctx?: IbsAvailabilityContext,
): number | undefined
```

- **Formula:** `(close − low) / (high − low)`; `high − low <= 0` → `0.5`.
- **Availability:** returns `undefined` iff `bar` belongs to the *current, still-developing* ET period AND `now` is before that period's activation point:
  - `D`: `bar.date` equals today's ET date AND ET minutes-since-midnight `< activateAtEtMin`.
  - `W`: `bar.date` falls inside the current ET trading week (Mon–Sun ISO week containing `now`) AND ET weekday `< activateAtWeekday`.
  - Every other case (completed bars, bars for past periods) → defined.
- **ET conversion:** `Intl.DateTimeFormat` with `timeZone: 'America/New_York'` — no tz dependency; `etParts(now)` internal helper extracting `{ dateStr, weekday, minutes }`.
- Callers that omit `ctx` get wall-clock semantics — correct for real runs and charts; tests inject `now`.

### 2. `shared/st-ibs.spec.ts` — spec (new)

Table-driven: formula at high/low/mid; zero-range → `0.5`; D availability pre/post activation boundary; W availability across weekday boundary; completed bars always defined; `ctx` overrides honored.

### 3. `rb-ps/rb-ta/ind/rb-st-zones.pine` — gate + inputs (modified)

- New inputs: `ibsThreshold` (float, default `0.5`, step `0.05`), `ibsActivateHourEt` (int, default `12`), `showSuppressedSignals` (bool, default `false`).
- `rawIbs = (high - low) == 0 ? 0.5 : (close - low) / (high - low)`.
- Availability approximation: on the realtime developing daily bar, `hour(time, "America/New_York") >= ibsActivateHourEt`; on weekly bars, `dayofweek(time) >= 3`. Completed bars always defined — Pine's `barstate` distinguishes realtime vs confirmed bars.
- Suppression: the existing uptick/downtick markers gate identically (`long: ibs >= T`, `short: ibs <= 1 − T`); suppressed markers plot as small hollow/dimmed circles when `showSuppressedSignals` is on.

## Contracts

```typescript
// the only cross-area surface — both gates consume exactly this
computeIbs(bar, timeframe, ctx) → number | undefined
// undefined ⇒ "filter not applicable" ⇒ signal passes unfiltered
```

Config keys (documented here, plumbed in BE/FE): `ibsThreshold` (default `0.5`), `activateAtEtMin` (default `720`), `activateAtWeekday` (default `3`).

## Decisions

- Single shared module over per-side ports — the function has no chart/Firebase coupling; forking the ET logic is the bigger risk. Prior port convention was born from chart-coupled indicators and doesn't apply.
- `undefined` return over a separate `isIbsAvailable` predicate — callers can't accidentally apply a stale "available" flag; absence IS the semantic.
- `Intl.DateTimeFormat` for ET — no new dependency (no `luxon`/`date-fns-tz`); Node 24 and evergreen browsers both support `timeZone`.
- ISO-week membership for `W` — robust to however the pipeline dates weekly bars (week-start vs week-end), verified against actual `weeklyBars` contents at impl time.
- Pine availability is an *approximation* (`hour`/`dayofweek`, `barstate`) — flagged as the known parity gap vs the precise `now`-injected TS semantics.

## Sequence / phases

Phase 1 (this area, ordered):
1. `st-ibs.ts` + spec + alias wiring — one task.
2. `rb-st-zones.pine` gate + inputs — second task; independent of BE/FE, schedule freely.

BE and FE Blueprints are **blocked by task 1** (the shared function); Pine is unblocked from the start.

## Prior art / regression

- `shared/st-*.ts` pattern (dual tsconfig `@st/` aliases, root `shared/*.spec.ts` under jest) — e.g. `shared/st-signals.ts`, `shared/flex-chart-indicator-visuals.ts`.
- `functions/src/indicators/*.ts` ported indicators — NOT the model here (see Decisions).
- `rb-ps/rb-ta/ind/rb-st-zones.pine` existing uptick/downtick marker logic — gate attaches at emission; ungated behavior must stay identical when `ibsThreshold` is effectively disabled (e.g., set to `0`/`1` or IBS unavailable).
- AGENTS.md jest notes: spec uses `jest.fn()`/`expect.*` directly, no jasmine shims needed for pure fn.

## Verify relay

- `npx jest shared/st-ibs.spec.ts` — new spec green.
- `npx tsc --noEmit -p functions` and app build — alias resolution compiles on both sides.
- Pine: manual TradingView paste — gate suppresses markers on qualifying bars; suppressed toggle reveals them.

## Risks / open seams

- **Weekly bar dating convention** — must verify at impl how `weeklyBars[].date` is keyed (week-start Monday vs week-end) before writing the ISO-week membership check; the ISO-week approach covers either, but the spec fixtures need the real convention.
- **`Intl` perf in hot path** — `DateTimeFormat` object must be created once (module-level `const`), not per call.
- **Pine `time` on intraday charts** — if the Pine script is ever run on non-daily TFs, `hour(...)` semantics shift; doc the daily-chart assumption in the script header.
