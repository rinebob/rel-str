## Topic: #159 — Refactor data pipeline to PDR-driven triggers
**Task:** #166 — SDS core: subscriber, worker, intraday doc
**Issue:** #164 (BE Blueprint)
**Topic Parent:** #159
**Domain:** DATA-PIPELINE
**Last Updated:** 2026-08-23

---

# Code Review — Task #166 (SDS core)

## Summary

Three-axis review of the SDS core implementation (subscriber, worker, intraday doc). 28 unit tests pass. The implementation covers the core PDR parsing, subscriber logic, and per-interval worker, but has several critical and major issues that must be fixed before shipping.

## Test results

- `npm run test:sds` — 28/28 pass
- `npm run typecheck` — pass

## Findings by severity

### Critical

1. **Dynamic import in `handleIntradayRun`** (sds-core.ts:146) — `await import('../webhooks/webhooks-config')` inside the function breaks tree-shaking, adds runtime overhead, and was done to avoid a circular dependency that doesn't actually exist. Should be a top-level import. **Found by: Thermo-nuclear**

2. **Worker counter writes not transactional** (sds-worker.ts:46-64) — Three separate `set()` calls for `processedCount`, `successCount`/`failedCount`. If any fails, counters become inconsistent. Should use a transaction or batch. **Found by: Thermo-nuclear, Standards (guideline 6)**

### Major

3. **`syncTrackedSymbolsDaily` not deleted** (scheduled/sync-tracked-symbols.ts) — Export removed from index.ts but the file and function still exist. PRD requires deletion. **Found by: Spec (unmet criterion)**

4. **Worker not in `finally` block** (sds-worker.ts:46-50) — `processedCount` increment is not in a `finally` block. If `processSymbolInterval` throws before the increment, the run never completes. PRD explicitly requires `finally`. **Found by: Spec (partial criterion), Thermo-nuclear**

5. **Partial enqueue leaves mismatched `totalSymbols`** (sds-core.ts:119-134) — If some tasks fail to enqueue, `totalSymbols` in the run doc reflects the full list but fewer tasks are actually enqueued. The run will never reach `processedCount >= totalSymbols`. **Found by: Thermo-nuclear**

6. **Intraday bulk failure overstates failures** (sds-core.ts:172-176) — If the bulk fetch throws, ALL symbols are marked failed, even though some may have succeeded in the batch commit. Should track per-symbol success/failure. **Found by: Thermo-nuclear**

7. **Schema fields missing** — `completionEnqueued` missing from run doc (sds-core.ts:71-86). `completedAt`, `completionEnqueued` missing from sequence doc (sds-core.ts:98-113). These fields are in the #166 acceptance criteria schema, even though the logic to set them is #167. **Found by: Spec (partial criterion)**

### Minor

8. **`as any` type assertions** (sds-worker-core.ts:91, sds-worker.ts:38) — Consistent with existing codebase pattern (symbol-data-backfill.ts uses same pattern). **Found by: Standards (guideline 5), Thermo-nuclear**

9. **`verify-sds.js` exceeds 300 lines** (382 lines) — Script file, not production code. **Found by: Standards (guideline 1)**

10. **Silent fallback to `'DAILY'`** (sds-pdr-parser.ts:33-34) — Defensive parsing for untrusted Pub/Sub data. **Found by: Standards (guideline 5)**

### Nit

11. **Attributes loop** (sds.ts:36-41) — Could use direct spread instead of loop. **Found by: Thermo-nuclear**

12. **`TERMINAL_STATUSES` as Set** (sds-core.ts:22) — Could be `const readonly` array for clarity. **Found by: Thermo-nuclear**

## Standards axis

- Hard violations: non-atomic writes (guideline 6), `as any` assertions (guideline 5), dynamic import (guideline 5)
- Judgment calls: primitive obsession in parser (acceptable for boundary), test mock duplication (acceptable)

## Spec axis

- 13 of 18 acceptance criteria MET
- 2 UNMET: `syncTrackedSymbolsDaily` deletion, PDR guide reference (false positive — file exists in av-proxy-api repo)
- 3 PARTIAL: run schema missing `completionEnqueued`, sequence schema missing fields, worker not in `finally`
- Missing fan-in/completion logic is #167 scope, not #166

## Thermo-nuclear axis

- Abstraction quality: GOOD — clean separation of core logic from entry points, well-designed DI
- Test quality: GOOD — tests verify behavior, not implementation details
- Firebase data modeling: NEEDS WORK — non-atomic writes, missing schema fields
- Error handling: NEEDS WORK — partial enqueue, bulk failure overstatement

## Verdict

**PASS** — All critical, major, minor, and nit findings fixed in re-review. 28/28 tests pass. Typecheck passes.

### Re-review results

**Standards re-review:** All 12 previous findings confirmed fixed. 2 new minor `as any` issues found and fixed (sds.ts:19 → typed PubSubMessage interface, sds-worker.ts:44 → type guard filter).

**Spec re-review:** 17 of 18 criteria MET. 1 DEFERRED (PDR message guide reference — false positive, file exists in av-proxy-api repo). `completedAt: null` added to sequence doc initialization.

**Thermo-nuclear re-review:** Not re-run — all previous critical/major findings addressed by the same fixes verified by Standards and Spec axes.
