**Topic:** Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)  
**Issue:** #114  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Draft  
**Created:** 2026-08-15  
**Last Updated:** 2026-08-15  

# Interim Review — 2026-08-15 (Task #120)

## Standards

- **Minor — test data consistency.** `shared/options-strategy-engine-contracts.spec.ts` initially used `strike: 77` and `strike: 45` with OCC IDs that encode 770 and 450 (e.g. `SPY250817P00770000`). Corrected to `770` / `450` and added a decimal-strike round-trip test. This was caught by the round-trip assertions, but the inconsistent sample data could mislead future readers.
- **Minor — `@topic` tagging.** The new shared files (`options-strategy-engine-contracts.ts`, `options-strategy-engine-contracts.spec.ts`, `tsconfig.json`) do not include `@topic` comments. If the repo convention expects them, add a short header tag tying these files to Topic #114.
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

- **Minor — grid loop precision.** `for (let p = -rangePct; p <= rangePct + 1e-12; p += stepPct)` works for the tested defaults but floating-point accumulation is fragile. Consider integer-indexed generation for long-term maintainability.
- **Minor — test assertions are shallow.** Most tests only assert one field or a round-trip identity. They guarantee the TypeScript types compile and basic parsing works, but do not yet stress boundary cases (e.g. invalid strikes passed to `buildOccContractId`, far-future expirations, leap-day expirations).
- Otherwise this is a clean contract-only change with no runtime engine code.

## Test results

`npx jest shared/options-strategy-engine-contracts.spec.ts --no-coverage` — **9 passed, 0 failed**.

Full suite (`npx jest --no-coverage`) still fails on 38 pre-existing suites unrelated to this change (Angular/Firebase/Jest environment issues, ESM `jose` parsing, component naming mismatch in `heatmap.component.spec.ts`). Added to `docs/planning/TECH_DEBT.md`.

## Advisory findings

- Minor — add `@topic` headers to new shared files if that is the repo convention.
- Minor — consider integer-indexed grid generation and a few more `buildOccContractId` edge-case tests before final review.

## Status

Advisory — no gate. Continue implementation. Address findings before final `/proj review`.
