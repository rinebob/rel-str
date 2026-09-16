**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Option chain percent change grid
**Thread Slug:** initial-impl<br>
**Issue:** #340  
**Thread Parent:** #327
**Topic Parent:** #326  
**Task:** #343  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-16  
**Last Updated:** 2026-09-16  

---

# Code Review: Task #343 — SHARED chain snapshot types

## Summary

Task #343 adds the shared request/response types for the
`getHistoricalOptionsChain` callable, the FE re-exports, and the
`CallableName` enum entry. Three review axes were run: Standards, Spec,
and Thermo-nuclear.

## Findings by severity

### Major (resolved during review)

1. **`unknown` type usage in `GetHistoricalOptionsChainResponse`** —
   The initial implementation used `unknown[]` and `unknown` for
   `data.data`, `analysis.summary`, `analysis.expirations`, and
   `analysis.strikes`. This was flagged by both the Standards and
   Thermo-nuclear axes as weakening the type contract and forcing
   cast-heavy FE code.
   
   **Resolution:** Promoted `HistoricalOptionContract`,
   `HistoricalOptionsAnalysisSummary`, `HistoricalOptionsExpirationGroup`,
   and `HistoricalOptionsStrikeGroup` from BE-only
   `functions/src/types/partner.ts` to the shared
   `shared/options-contract-contracts.ts`. The BE file now imports and
   re-exports these types from shared, and the response type uses
   concrete types instead of `unknown`.

2. **BE barrel file missing re-export** —
   `functions/src/types/partner.ts` did not re-export the new types.
   
   **Resolution:** Added `HistoricalOptionContract`,
   `HistoricalOptionsAnalysisSummary`, `HistoricalOptionsExpirationGroup`,
   `HistoricalOptionsStrikeGroup`, `GetHistoricalOptionsChainRequest`,
   and `GetHistoricalOptionsChainResponse` to the BE re-export block.

### Minor (deferred)

3. **`CallableName.GET_HISTORICAL_OPTIONS_CHAIN` unused** — The enum
   entry has no consumers yet. This is intentional for a SHARED
   foundation task — it will be consumed by Task #344 (BE callable) and
   Task #346 (FE service). Deferring as expected for a dependency-first
   task ordering.

### Nits (resolved during review)

4. **JSDoc multi-line with placeholder `...`** — Replaced with
   single-line JSDoc consistent with the rest of the file.
5. **Re-exports under wrong section header** — Added a dedicated
   `// Historical Options Chain Snapshot DTOs` section header in
   `partner.types.ts`.
6. **JSDoc said "pct change" but naming uses "Historical Options Chain"**
   — Updated to "Options chain snapshot: fetch full chain snapshot for
   a symbol+date".

## Test results

- **BE build (`cd functions && npm run build`):** PASS
- **Angular build (`npx ng build`):** PASS
- **FE test suite (`npx ng test --watch=false`):** FAIL — pre-existing
  `fs`/`path` module resolution errors in
  `options-strategy-dashboard.component.spec.ts` and `strategy-builder`
  spec files. Verified pre-existing by stashing changes and reproducing
  the same errors on the base commit. Not caused by Task #343.

## Verdict: PASS

All major findings resolved during review. The deferred finding
(unused enum) is expected for a SHARED foundation task. Both builds
pass. Pre-existing test failures are unrelated to this task.
