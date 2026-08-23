**Topic:** Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, and migrate charts to local reads  
**Issue:** #168  
**Topic Parent:** #159  
**Domain:** DATA-PIPELINE  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

# Code Review: BE Task #168 — Fallback timer and open pass timer

## Summary

Three-axis review of Task #168 (fallback timer at 3 PM PT, open pass timer every 5 min during market hours, deletion of old `optionsOpenPass` cron). 69/69 tests pass, typecheck clean, build succeeds. All findings from the initial review have been addressed — fixes appear inline below each finding.

## Standards

### Hard violations (all fixed)

1. **Duplicated status constant** — `sds-fallback-logic.ts:42-47` re-declares `['processing','completed','forced_complete','completed_but_not_dispatched']` inline, overlapping `TERMINAL_SEQ_STATUSES` from `sds-completion.ts`.
   - **Fixed:** `sds-fallback-logic.ts` now derives `ACTIVE_STATUSES` from `TERMINAL_SEQ` exported by `sds-completion.ts`: `[...TERMINAL_SEQ, 'processing']`.

2. **Duplicated collection name** — `sds-fallback.ts:22` declares `SDS_SEQUENCES_COLLECTION` locally, duplicating `sds-completion.ts`.
   - **Fixed:** `sds-fallback.ts` now imports `SDS_RUNS_COLLECTION` and `SDS_SEQUENCES_COLLECTION` from `sds-core.ts`.

3. **`any` usage** — `sds-fallback.ts:61`: `const raw: any[]` — untyped partner response.
   - **Fixed:** `sds-fallback.ts` now uses the typed `PartnerListTrackedSymbolsResponse` (symbols is `string[]`), eliminating the `any[]` cast.

4. **Mixed responsibility** — `sds-fallback-logic.ts` exports `computeOpenPassSlot` which is only consumed by `open-pass-timer.ts`. Divergent Change — the file gets edited for two unrelated features.
   - **Fixed:** `computeOpenPassSlot` moved to `common/pt-date-utils.ts` where it belongs alongside other PT time utilities.

### Baseline smells

5. **Duplicated Code (slot computation in verify script)** — `scripts/verify-open-pass-timer.js:29-36` re-implements `computeOpenPassSlot` in JS.
   - **Accepted as nit.** The verify script is a standalone JS file that can't import TS modules. The duplication is documented.

6. **Test contract mismatch** — `sds-fallback.test.ts:50`: `shouldFallbackRun([])` omits required `marketDate` arg.
   - **Fixed.** All `shouldFallbackRun` calls now pass explicit `marketDate`.

7. **Primitive Obsession (phases[0])** — `open-pass-timer.ts:49`: `instance.phases?.[0]` hard-codes "first phase is open phase."
   - **Accepted.** This pattern is used consistently across the existing orchestrators. Changing it here would be inconsistent.

8. **Feature Envy (Firestore doc mapping)** — `sds-fallback.ts:43-50` maps Firestore docs into `SequenceSummary` by reaching into `d.data()`.
   - **Accepted.** No sequence repository exists; the mapping is 4 lines and not worth a new module.

## Spec

### Missing or partial

- **"Fallback logs alert on failure"** — `sds-fallback.ts:101` only calls `logger.error`.
  - **Accepted.** `logger.error` with structured fields is the project's alerting convention (same as `sds-watchdog.ts`). No separate alert channel exists in this codebase.

- **"Timer queries active instances where openTimePT == current slot"** — Uses in-memory filter (`listActiveInstances()` then `.filter`) instead of Firestore `where('openTimePT', '==', slot)`.
  - **Accepted.** The active instance count is small (<20), so a Firestore composite index is not warranted.

### Scope creep

- **`shouldFallbackRun` extra statuses** — Checks `forced_complete` and `completed_but_not_dispatched` in addition to `processing` and `completed`. Spec only mentions the latter two.
  - **Accepted as correct.** The extra statuses indicate data was synced. The `failed` status is correctly excluded (data was NOT synced). This is correct behavior, not scope creep.

### Implemented but was wrong (now fixed)

- **Open pass timer schedule** — `*/5 6-12` fires 6:00–12:55 PT. Spec says 6:30 AM–1:00 PM. Starts 30 min early and misses the 13:00 slot entirely.
  - **Fixed.** Changed to `*/5 6-13 * * 1-5`. Early ticks before 06:30 are harmless no-ops (no instances will match).

- **`computeOpenPassSlot` PT conversion** — Uses `toLocaleString('en-US', ...)` then `new Date(ptStr)`. String round-trip is locale-dependent and fragile.
  - **Fixed.** Now uses `Intl.DateTimeFormat('en-US', { timeZone, hour12: false })` with `formatToParts`, matching the pattern used by `getRunIdPT` in the same file.

## Thermo-Nuclear

### Major (all fixed)

**M1. Cron schedule misses 13:00 slot** — `*/5 6-12` last tick is 12:55. An instance with `openTimePT: "13:00"` will never be processed. The test at `sds-fallback.test.ts:26` tests behavior the timer can never trigger.
  - **Fixed.** `*/5 6-13 * * 1-5` now covers 6:00–13:55 PT. The 13:00 slot is reachable.

**M2. Synthetic-attributes seam is fragile** — `sds-fallback.ts:84-95` fabricates PDR attributes and calls `handlePdrMessage`, which runs `resolvePdrContext` — a parser for real Pub/Sub messages. The runId `${marketDate}-FALLBACK-POST-A-${interval}` only resolves to sequence `A` because the regex `/POST-([ABC])-/` happens to match inside `FALLBACK-POST-A-`. Implicit, fragile, and untested.
  - **Fixed.** Extracted `createPostRun` from `handlePdrMessage` in `sds-core.ts`. The fallback now creates the run doc directly and calls `createPostRun` with a `PdrContext` object — no PDR attribute fabrication, no regex coupling. Both `sds.ts` (via `handlePdrMessage`) and `sds-fallback.ts` (via `createPostRun`) share the same sequence-doc transaction and enqueue logic.

### Minor (addressed)

- **m1. In-memory filter** — `listActiveInstances` loads all active instances, then filters by `openTimePT` in memory.
  - **Accepted.** Small cardinality, not worth a composite index.

- **m2. Test gaps** — `shouldFallbackRun([])` omits `marketDate`. No test covers `failed`-status POST A or mixed-status scenarios.
  - **Fixed.** Added tests for `failed`-status POST A (should re-run) and mixed-status scenarios. All `shouldFallbackRun` calls pass explicit `marketDate`.

- **m3. `runOptionsOpenPass` orphaned** — Only test-referenced. No manual callable exports it (unlike `optionsMarkPassManual`).
  - **Accepted.** It's used by existing tests in `options-strategy-passes.test.ts`. Keeping it as a test-only export is consistent with the project pattern.

- **n1. Verify scripts print-only** — `--create` doesn't create, just prints instructions.
  - **Accepted.** The scripts document the gcloud commands needed for verification. Making them executable would require Firestore admin credentials in the script, which is a separate concern.

## Test results

69/69 SDS tests pass (52 existing + 17 new). Typecheck clean. Build succeeds.

## Verdict: PASS

All critical and major findings addressed. Minor findings accepted with rationale. Tests green, typecheck clean, build succeeds.
