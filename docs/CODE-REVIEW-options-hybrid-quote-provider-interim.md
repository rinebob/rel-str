**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #114  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Draft  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

# Interim Review — 2026-08-15 (Task #121)

## Standards

- **[FIXED] Minor — duplicated `parseOptionalNumber` helper.** `functions/src/common/option-contract-selection.ts:53` and `functions/src/options-strategy-engine/quote-providers/av-eod-option-quote-provider.ts:26` contained nearly identical private number-parsing logic. Fixed by exporting the helper from `common/option-contract-selection.ts` and importing it in the AV EOD provider.
- **[FIXED] Minor — `AvEodOptionQuoteProvider` does not explicitly implement `OptionQuoteProvider`.** Fixed by adding `implements OptionQuoteProvider` to the class.
- **[FIXED] Minor — redundant `as OptionType` casts.** `av-eod-option-quote-provider.ts:55,58` and `overnight-simulation.ts:78` cast values to `OptionType`. Fixed by importing `OptionType` as a value and using the enum members directly.
- **[FIXED] Minor — `@topic` ownership of `functions/src/common/option-contract-selection.ts`.** Removed the `@topic #114` tag and updated the header to describe it as shared between the options strategy engine and the hybrid quote provider.

## Spec

- **[FIXED] Major — `deltaTolerance` conflates delta and DTE scores.** `eod-selection-pass.ts:93-98` compared `selected.score` (delta error + DTE penalty) against `config.deltaTolerance`. Fixed by computing the delta component alone (`|effectiveDelta - targetDelta|`) and comparing only that to `config.deltaTolerance`.
- **[FIXED] Minor — `resolveMark` can return `NaN` for the required `mark` field.** `av-eod-option-quote-provider.ts:49` fell through to `NaN` when `mark`, `bid`, `ask`, and `last` were all missing. Fixed by throwing a data-quality error when no price is available.
- **[NOT FIXED] Minor — `McpOccRhInstrumentMapResolver` opens a fresh MCP session per tool call.** It delegates to `executeObservationTool`, which connects/disconnects for each call; the fallback path can open three sessions. This is acceptable for #121 and will be resolved by the `RobinhoodMcpSessionManager` reuse layer in #122.
- **[FIXED] Minor — overnight simulation persistence is not wired into `runEodSelectionPass`.** `eod-selection-pass.ts` returned the selected quote without persisting the simulation. Fixed by adding `runEodNightlySelection` in `eod-orchestrator.ts` to coordinate selection, map persistence, and simulation persistence.
- Otherwise the AV EOD provider, selection pass, instrument map service, and Black-Scholes simulator cover the #121 acceptance criteria.

## Thermo-nuclear

- **[FIXED] Minor — `McpOccRhInstrumentMapResolver` has a duplicated `do { ... } while (cursor)` loop for `get_option_instruments`.** The first pass and the `chain_id` fallback pass were identical except for the `chain_symbol` / `chain_id` argument. Fixed by extracting the loop into a private `findMatchingInstrument` helper.
- **[NOT FIXED] Minor — `OccRhInstrumentMapService` silently overwrites existing map entries.** `buildAndPersist` uses `set(..., { merge: true })`. This is acceptable for an initial build; the #122 backfill path should log or version entry updates.

## Test results

- Targeted `npx tsx --test ../tests/functions/options-strategy-engine/*.test.ts` — **28 passed, 0 failed**.
- Full `npx tsx --test ../tests/functions/**/*.test.ts` — **101 passed, 0 failed**.
- `npm run typecheck` in `functions/` — **clean**.
- `npx tsc --noEmit -p shared/tsconfig.json` — **clean**.
- `npx jest shared/options-strategy-engine-contracts.spec.ts` — **17 passed, 0 failed**.
- Full `npx jest` still has **38 pre-existing suite failures** (unrelated Angular/Firebase/Jest environment issues; documented in `docs/planning/TECH_DEBT.md`).

## Status

Advisory — no gate. All fixable findings are now [FIXED]; the two [NOT FIXED] items require #122 code (`RobinhoodMcpSessionManager` and backfill/versioning) and can be addressed there.

# Interim Review — 2026-08-15 (Task #120)

## Standards

- **[FIXED] Minor — test data consistency.** `shared/options-strategy-engine-contracts.spec.ts` initially used `strike: 77` and `strike: 45` with OCC IDs that encode 770 and 450. Test data was corrected to `770` / `450` and a decimal-strike round-trip test was added.
- **[FIXED] Minor — `@topic` tagging.** The new shared files (`options-strategy-engine-contracts.ts`, `options-strategy-engine-contracts.spec.ts`, `tsconfig.json`) already include `@topic #114` headers.
- Otherwise files are small and single-purpose, types are clean, and no duplication is introduced.

## Spec

- `OptionQuoteSource` enum present with `AV_EOD`, `RH_MCP`, `AV_REALTIME` in `shared/options-common.ts`.
- `OptionQuote`, `OccRhInstrumentMapEntry`, `OvernightDeltaGridPoint`, `OvernightDeltaSimulation`, and `StrategyInstanceConfig` all defined in `shared/options-strategy-engine-contracts.ts` and match the PRD fields.
- `StrategyInstanceConfig` exposes `overnightGridRangePct`, `overnightGridStepPct`, and `maxOvernightMovePct?: number | null` (disabled by default) as required.
- No build errors after adding the new file in:
  - `npx tsc --noEmit -p functions/tsconfig.json`
  - `npx tsc --noEmit -p tsconfig.app.json`
  - `npx tsc --noEmit -p tsconfig.spec.json`
  - `npx tsc --noEmit -p shared/tsconfig.json`
- Tests cover minimal/full `OptionQuote`, `OccRhInstrumentMapEntry` with/without `firstTradedDate`, grid symmetry, config with `maxOvernightMovePct: null`, OCC round-trips, decimal strikes, and malformed ID rejection.

## Thermo-nuclear

- **[FIXED] Minor — grid loop precision.** `for (let p = -rangePct; p <= rangePct + 1e-12; p += stepPct)` was fragile. Fixed by integer-indexed move-percent generation in `overnight-simulation.ts`.
- **[FIXED] Minor — test assertions are shallow.** Added far-future expiration, leap-day expiration, zero strike, long symbol, and whitespace/negative-strike validation tests in `shared/options-strategy-engine-contracts.spec.ts`.
- Otherwise this is a clean contract-only change with no runtime engine code.

## Test results

- `npx jest shared/options-strategy-engine-contracts.spec.ts` — **17 passed, 0 failed**.
- Full `npx jest` still has **38 pre-existing suite failures** (unrelated Angular/Firebase/Jest environment issues; ESM `jose` parsing, component naming mismatch). Documented in `docs/planning/TECH_DEBT.md`.

## Status

Advisory — no gate. All fixable findings are now [FIXED]; the two [NOT FIXED] items require #122 code (`RobinhoodMcpSessionManager` and backfill/versioning) and can be addressed there.
