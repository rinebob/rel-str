# Backtest / Leap-Drop Refactor — Thermo-Nuclear Review

**Scope:** comprehensive one-pass review and refactor of the recent backtest change set and the leap-drop strategy adapter.

**Change set reviewed:**
- `functions/src/rh-agent-cloud-function/backtest/backtest-simulator.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-metrics.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-data-loader.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-orchestrator.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-worker.ts`
- `functions/src/rh-agent-cloud-function/strategies/leap-drop/leap-drop.strategy.ts`
- `functions/src/rh-agent-cloud-function/strategies/option-contract-selection.ts`
- `functions/src/rh-agent-cloud-function/strategies/base-strategy.ts`
- `functions/src/rh-agent-cloud-function/strategies/strategy-registry.ts`
- `functions/scripts/backtest-qqq-underlying.ts`
- `functions/tsconfig.json`
- `functions/.gitignore`

---

## 1. Architectural changes

### 1.1 `PositionLeg` discriminated union

`backtest-simulator.ts` previously used a single `PositionLeg` interface with an optional `isUnderlying` flag and a pile of optional option-specific fields (`contract`, `contractId`, `optionType`, `strike`, `expiration`). Every consumer had to repeat the same `isUnderlying ? underlyingClose : findMarkForContract(...)` branch.

**Fixed:** introduced a proper discriminated union:

```ts
interface BasePositionLeg { side; quantity; multiplier; entryMark; lastMark; }
interface OptionPositionLeg extends BasePositionLeg { kind: 'option'; contract: HistoricalOptionContract; }
interface UnderlyingPositionLeg extends BasePositionLeg { kind: 'underlying'; }
type PositionLeg = OptionPositionLeg | UnderlyingPositionLeg;
```

- `findMarkForContract` now takes a full `HistoricalOptionContract` and looks it up by `contractID` first, then by `type`/`expiration`/`strike` fallback.
- `getLegMark(leg, today, chain)` is the single place that decides how to mark a leg.
- `evaluateExit`, the open-position mark refresh loop, `closePosition`, and `computeOpenPositionValue` all call `getLegMark` instead of inline branching.

### 1.2 Centralized leg value math

- Added `entryValueOfLegs(legs)` so `tryEnterPosition`, `closePosition`, and `BacktestTrade.returnPct` all use the same signed-leg formula.
- `BacktestTrade.returnPct` now divides `pnl` by `Math.abs(position.entryValue)` (the net entry value of all legs) instead of an arbitrary first-leg denominator. This is correct for spreads and short legs.

### 1.3 Cash-flow naming and sign convention

- Renamed `PositionEntry.cashOutflow` to `cashFlow` because the value is signed (negative for long debits, positive for short credits / covered entries).
- `runBacktestSimulation` now reads `entry.cashFlow`.
- `tryEnterPosition` computes `const cashFlow = -entryValue;` so the sign is consistent everywhere.
- `closePosition` still computes `cashFlow` as the signed liquidation value (positive for long closes, negative for short closes) and `pnl` as `sideMultiplier * (mark - entryMark) * multiplier * quantity`.

### 1.4 `BacktestTrade` reporting

- Added `isUnderlying?: boolean` to `BacktestTrade` so downstream report/frontend code can distinguish equity trades from option trades without sniffing for `contractId`.
- `closePosition` populates `optionType`, `strike`, `expiration`, `contractId`, and `isUnderlying` from the discriminated leg.

---

## 2. `backtest-simulator.ts` function split

### `tryEnterPosition` / `closePosition`

`tryEnterPosition` previously duplicated underlying-vs-option branching to pick contracts, build `PositionLeg` objects, and accumulate entry value. Now it delegates to:

- `buildUnderlyingLegs(today, underlying, notes)` — validates `close > 0`, returns a single `UnderlyingPositionLeg`.
- `buildOptionLegs(marketDate, chain, optionLegs, signalType, notes)` — handles single-leg and spread selection uniformly and returns `OptionPositionLeg[]`.

`closePosition` no longer branches on `isUnderlying`; it uses `getLegMark` for every leg and falls back to `lastMark` or `entryMark` when no mark exists.

### `computeDrop` / execute helpers in `leap-drop.strategy.ts`

`execute` previously duplicated the `StrategyOutput` object construction for underlying and option modes. Now it:

- Validates bars and computes the drop in `computeDrop()`.
- Computes quantity in `computeUnderlyingQuantity(currentClose, positionSize)` with a zero/negative close guard and the documented `Math.max(1, Math.floor(positionSize / currentClose))` behavior.
- Builds the `reason` string in `buildUnderlyingReason()` / `buildOptionReason()`.
- Builds the shared `exit` metadata once and only differs the leg metadata (`underlyingPosition` vs `optionLegs`).

---

## 3. Leap-drop config and schema fixes

### 3.1 `LeapDropConfig` discriminated union

```ts
export interface OptionLeapDropConfig extends LeapDropBaseConfig { useUnderlying: false; targetDelta; targetDte; minDte?; maxDte?; optionType; }
export interface UnderlyingLeapDropConfig extends LeapDropBaseConfig { useUnderlying: true; positionSize; }
export type LeapDropConfig = OptionLeapDropConfig | UnderlyingLeapDropConfig;
```

`applyDefaults` now branches once on `useUnderlying` instead of repeating ternaries for every option-only field. The default `trailingStopPct` is now respected for options when the caller supplies it (previously it was forced to `undefined` in option mode).

### 3.2 Sentinel values accepted by the schema

| field | old min/max | new min/max | sentinel semantics |
|---|---|---|---|
| `maxHoldDays` | `min: 5, step: 5` | `min: 0, step: 1` | `0` disables the time exit |
| `stopLossPct` | `min: 0.01, max: 0.95` | `min: 0.0, max: 2.0` | `0` disables the stop; otherwise exit when `pnlPct <= -stopLossPct` |
| `trailingStopPct` | `min: 0.01, max: 0.5` | `min: 0.0, max: 0.5` | `0` disables the trailing stop |

`targetGainPct` remains optional: omit it to disable the target-gain exit. Underlying mode now defaults it to `undefined` unless overridden; option mode defaults to `1.0` (100%).

### 3.3 Underlying quantity sizing and close guard

`computeUnderlyingQuantity`:

```ts
if (currentClose <= 0 || positionSize <= 0) return 1;
return Math.max(1, Math.floor(positionSize / currentClose));
```

This correctly buys at least one share when the price is greater than `positionSize`, and refuses to enter on non-positive closes.

### 3.4 `computeDrop` close guard

`computeDrop` returns `null` when `prevClose` or `currentClose` is missing or zero, so `execute` never attempts to divide by zero.

---

## 4. Test script and output cleanup

- Deleted `functions/backtest-qqq-output.txt` (generated local script output).
- Updated `functions/.gitignore` to ignore `backtest-*.txt` and `backtest-*.json`.
- Fixed `functions/scripts/backtest-qqq-underlying.ts` to print `dailyBars[0]?.date` instead of `dailyBars[1]?.date` for the first bar.

---

## 5. Additional changes (current pass)

### 5.1 Weekly and monthly bars now passed to `StrategyInput`

`backtest-data-loader.ts` now exposes `loadAllBars()` which returns sorted, unique `dailyBars`, `weeklyBars`, and `monthlyBars`. `backtest-worker.ts` and the local script call it and pass all three arrays to `runBacktestSimulation`, which forwards them on `StrategyInput`. This makes multi-timeframe strategies backtestable.

### 5.2 Per-leg `BacktestTrade` reporting

`BacktestTrade` now carries an optional `legs: BacktestTradeLeg[]` array with every closed leg's kind, side, quantity, multiplier, entry/exit marks, and PnL. `closePosition` populates it. First-leg summary fields (`entryMark`, `exitMark`, `quantity`, `side`, `optionType`, etc.) are retained for backward compatibility.

### 5.3 Typed strategy output metadata

`base-strategy.ts` now exports `ExitConfig` and `StrategyOutputMetadata`. `StrategyOutput.metadata` is typed as `StrategyOutputMetadata` while still allowing extra keys. `backtest-simulator.ts` no longer casts `output.metadata` to a local `EntryMetadata` interface.

### 5.4 Stronger config validation

`strategyRegistry.validateConfig` now validates integer-ness, `boolean`/`string` types, and string enum membership in addition to numeric `min`/`max`.

### 5.5 Safer simulator defaults

`tryEnterPosition` now defaults missing `stopLossPct` and `maxHoldDays` to `0` (disabled) instead of hidden `0.5`/`252`. Leap-drop's `applyDefaults` still supplies active defaults; other strategies must be explicit or will run with no stop/time exit.

### 5.6 CLI parser hardening

`backtest-qqq-underlying.ts` header was updated to mention `--options` mode, and `parseNumberFlag` now enforces non-negative floors for all numeric flags. `--drop-pct` floor is `1e-6` to prevent a zero drop from silently disabling entries.

### 5.7 Reason formatting fix

`buildUnderlyingReason` formats the trailing-stop percentage with `.toFixed(0)` to avoid floating-point artifacts.

---

## 6. Other observations (not changed)

- `st-trend-rider` now receives weekly bars through `StrategyInput` but still does not emit `optionLegs`/`underlyingPosition`/`exit` metadata, so the simulator will not trade it. To backtest it, add trade metadata to its `StrategyOutput`.
- `BacktestTrade` first-leg-only summary fields are retained for backward compatibility; use the `legs` array for per-leg detail.
- `backtest-metrics.ts` computes `calmarRatio` and `sharpeRatio` correctly from the equity curve and closed trades; no edits required.
- `backtest-orchestrator.ts` and `backtest-worker.ts` are structurally sound.

---

## 7. Verification

- `npm run typecheck` (`tsc --noEmit`) in `functions/` passes with no errors.
- `npm run build` (esbuild bundle of `src/index.ts`) passes and produces `lib/index.js`.
- `npx eslint` on modified files passes with no errors (only the pre-existing TS-version warning from `@typescript-eslint/typescript-estree`).
- `npx tsx scripts/backtest-qqq-underlying.ts --help` prints updated usage.

---

## 8. Files modified

- `functions/src/rh-agent-cloud-function/backtest/backtest-simulator.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-types.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-data-loader.ts`
- `functions/src/rh-agent-cloud-function/backtest/backtest-worker.ts`
- `functions/src/rh-agent-cloud-function/strategies/base-strategy.ts`
- `functions/src/rh-agent-cloud-function/strategies/leap-drop/leap-drop.strategy.ts`
- `functions/src/rh-agent-cloud-function/strategies/option-contract-selection.ts`
- `functions/src/rh-agent-cloud-function/strategies/strategy-registry.ts`
- `functions/scripts/backtest-qqq-underlying.ts`
- `functions/tsconfig.json`
- `functions/.gitignore`
- `docs/reviews/BACKTEST-LEAP-DROP-REFACTOR-THERMO-REVIEW-2607-01.md` (this file)

---

## 9. Recommended next step

Merge/deploy is unblocked once you confirm the diff. The local backtest script (`npx tsx scripts/backtest-qqq-underlying.ts`) can be run to smoke-test underlying mode end-to-end if Firestore credentials are available.

---

## 10. Follow-up re-review (current session)

A second two-axis review was run against `prod` (`af5c916b...`) with the working-tree changes.

### 10.1 Standards findings and fixes

| finding | file | fix applied |
|---|---|---|
| Duplicated date math: `calendarDaysBetween` in simulator repeated `parseDate`/`daysBetween` already in `option-contract-selection.ts` | `backtest-simulator.ts`, `option-contract-selection.ts` | Exported `daysBetween`; replaced simulator's local function and callers |
| `closePosition` duplicated first-leg option/underlying field extraction before and after building `tradeLegs` | `backtest-simulator.ts` | Summary fields now read from `tradeLegs[0]` |
| Unnecessary cast `result.trades as BacktestTrade[]` | `backtest-worker.ts` | Removed cast and unused `BacktestTrade` import |
| Unnecessary `cfg as UnderlyingLeapDropConfig` / `cfg as OptionLeapDropConfig` after a discriminated union | `leap-drop.strategy.ts` | Removed casts; relies on TypeScript narrowing |
| `normalizeBars` accepted `unknown[]` and cast each bar to `Record<string, unknown>` to work around `OHLCV` lacking raw `OhlcBar` aliases | `base-strategy.ts`, `leap-drop.strategy.ts` | Added raw aliases (`d`, `o`, `h`, `l`, `c`, `v`) to `OHLCV`; typed `normalizeBars` as `OHLCV[]` without cast |
| `runBacktestSimulation` carries 8 positional parameters (symbol, strategy, config, dailyBars, optionsCache, initialCash, weeklyBars, monthlyBars) | `backtest-simulator.ts` | **Not fixed** — acceptable judgment call; bundling into a `BacktestSimulationInput` object would be cleaner but touches worker and script |

### 10.2 Spec findings

- User requirements (stopLossPct `0` sentinel and CLI configurability) remain correctly implemented.
- ADR backtest contract points (strategy adapter, `symbol-data` D/W/M bars, option `mark` pricing, EOD execution, Firestore collections, report tiers, metrics) remain correctly implemented.
- Walk-forward engine is **not wired end-to-end**: `BacktestRunType` and `BacktestPermutationPayload` define `allData`/`expandingWindow` and `inSampleDays`/`outOfSampleDays`/`rollStepDays`, but the orchestrator does not read/forward these windows and `runBacktestSimulation` ignores `runType`. Only `allData` currently works.
- `st-trend-rider` still does not emit trade metadata; with weekly bars now available it is one step closer to backtestability but remains signal-only.

### 10.3 Verification after follow-up fixes

- `npm run typecheck` — pass.
- `npm run build` — pass.
- `npx eslint` on touched files — pass (only pre-existing TS-version warning).
- `npx tsx scripts/backtest-qqq-underlying.ts --help` — prints updated usage.
