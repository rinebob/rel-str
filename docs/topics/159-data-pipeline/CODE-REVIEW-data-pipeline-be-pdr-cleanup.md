**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #163  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Code Review: BE — PDRv2 Cleanup, Dead Code, Logging, Monitoring (Task #169)

## Summary

Task #169 is the final cleanup task for the BE PDR migration. It removes the `currentPrice` side-effect from PDRv2, deletes the dead symbol-driven pipeline (`processSymbolsReady` and related code), removes the `USE_SYMBOL_DRIVEN_PIPELINE` flag, disables the `backfillSymbolDataForTradesDaily` scheduled function, and adds a `MONITORING.md` doc with Logs Explorer queries.

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. All three returned no critical or major findings. Minor findings were addressed during the review.

## Findings by Severity

### Critical
None.

### Major
None.

### Minor

1. **Stale `symbolDataSyncNightly` reference in README** — `functions/src/rh-agent-cloud-function/README.md:130` referenced the deleted `symbolDataSyncNightly` function. **Fixed**: updated to reference the SDS pipeline.
2. **`sds_fallback_start` log missing `marketDate`** — `functions/src/symbol-data-sync/sds-fallback.ts:39` logged without context fields. **Fixed**: `marketDate` is now computed before the log and included.
3. **Stale references in legacy docs** — Several historical docs under `docs/implementations/` and `docs/planning/` reference deleted symbols. These are legacy archive documents and are acceptable as historical context. No action taken.

### Nit

1. **Empty `/** */` header in index.ts** — `functions/src/index.ts:1` had an empty JSDoc comment left after the stale header was removed. **Fixed**: removed.

## Standards Axis

| Standard | Status | Notes |
|----------|--------|-------|
| No dead code remaining | PASS | All deleted functions/constants removed from source |
| No unused imports | PASS | `onRequest`, `fetchAndCacheSymbolSeries`, `SYMBOL_DATA_COLLECTION` removed |
| No duplicated constants/types | PASS | No duplication found |
| Consistent patterns | PASS | Code follows existing patterns |
| Clean type contracts | N/A | Pre-existing `any` usage in `partner-webhooks.ts` is out of scope for this cleanup task |
| No security issues | PASS | No secrets logged, no auth bypasses |
| Test conventions | PASS | No tests modified; verification script added |
| File size | PASS | `partner-webhooks.ts` reduced from ~1600 to ~1161 lines |

## Spec Axis

| Acceptance Criterion | Status | Evidence |
|---|---|---|
| `currentPrice` side-effect removed from PDRv2 `processPairLive` | MET | `upsertSymbolCurrentPrice` call deleted from `partner-webhooks.ts` |
| `processSymbolsReady` and `processSymbolsReadyHttpTest` deleted | MET | Functions, `runSymbolsReadyCore`, `normalizeInterval` all deleted |
| `PARTNER_SYMBOLS_READY_TOPIC` removed from `webhooks-config.ts` | MET | Constant deleted |
| Commented-out export removed from `index.ts` | MET | Comment block and stale header deleted |
| `USE_SYMBOL_DRIVEN_PIPELINE` flag removed | MET | Constant deleted from `webhooks-config.ts`, usage block deleted from `processDataReadyRunV2` |
| `backfillSymbolDataForTradesDaily` disabled (not exported, function kept) | MET | Not in `index.ts` exports; function definition kept per spec |
| Structured lifecycle logging on all new functions | MET | SDS functions have `runId`, `marketDate`, `symbol`, `phase` where applicable; `sds_fallback_start` fixed to include `marketDate` |
| `MONITORING.md` written with Logs Explorer queries | MET | `docs/topics/159-data-pipeline/MONITORING.md` created |
| No references to deleted symbols remain | MET | Only historical comment references (acceptable) |

## Thermo-nuclear Axis

| Category | Status | Notes |
|----------|--------|-------|
| Abstraction quality | CLEAN | No half-removed abstractions |
| Spaghetti detection | CLEAN | No broken control flow; `processDataReadyRunV2` intact |
| Code judo | CLEAN | Surgical changes, minimal churn |
| Edge cases (env var) | MINOR | If `USE_SYMBOL_DRIVEN_PIPELINE=true` is set in deployed env, it's a no-op since the code path is gone. Post-deploy: verify env var is unset. |
| Test quality | CLEAN | Verification script covers source + export checks |
| Architectural risk (currentPrice gap) | CLEAN | SDS pipeline writes `currentPrice` in both DAILY and intraday paths — no gap |
| Stale references | MINOR | Legacy docs have historical references (acceptable) |

## Test Results

- **Typecheck**: clean (`tsc --noEmit` passes)
- **SDS tests**: 69/69 pass (`npm run test:sds`)
- **Build**: succeeds (`npm run build`)
- **Verification script**: 25/25 checks pass (`node scripts/verify-pdr-v2-cleanup.js`)

## Verdict: PASS

No critical or major findings. All minor/nit findings were addressed during the review. All acceptance criteria are met. Tests pass, typecheck is clean, build succeeds.
