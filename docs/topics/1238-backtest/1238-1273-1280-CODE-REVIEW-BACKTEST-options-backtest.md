**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1280  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — Task #1280 (Row mapper + optionsReplayPermutation worker)

## Verdict: PASS

Three axes against the converged working tree. Three convergence findings
across implement pass 2 and review pass 1; no majors.

## Standards

- Module shape matches the established options-replay pattern: pure mapper
  (no imports beyond contracts), deps-seamed worker core, `onTaskDispatched`
  wrapper with `stBacktestPermutation`-parity config (3 attempts, 10–120s
  backoff, 10 concurrent / 5 per second, 512MiB, 300s).
- `stOptionsContractListDocId` used for the doc id — single point for the
  `{runId}_{symbol}` convention; its stale comment corrected as part of the
  task.
- snake_case logger keys (`options_replay_worker_*`); eslint clean;
  `import type` for type-only imports.
- `resolveRunCloseOut` extracted as a pure helper so the counter/status
  math is unit-tested rather than living only inside the transaction.

## Spec (issue #1280 ACs)

| AC | Result |
|---|---|
| Mapper pure — no Firestore, no network | **PASS** — imports only shared contracts + types |
| Absent days → `no-selection`, incl. past `lastDate` | **PASS** — `'out-of-range'` symmetric (before `firstDate` too); absent in-range carries no reason (no honest explanation) |
| `repeatsPrevious` across repeats + gaps | **PASS** — tracks prior pick's `contractId`, reset by any marker |
| Missing pick doc → `failed` naming coordinate; run completes with `failedLists` | **PASS** — 404 → `failed` doc + close-out, message names cellId; `resolveRunCloseOut` counts it |
| Already-`success` doc short-circuits | **PASS** — and `failed` too (both are terminal + closed-out) |
| Partial failures close run with correct counters | **PASS** — `completed` unless every list failed; tested via `resolveRunCloseOut` |
| Exported/wired per registration pattern | **PASS** — `index.ts` export; name = queue name = `OPTIONS_REPLAY_TASK_QUEUE` contract |
| Unit tests per TEST-BE | **PASS** — 8 mapper + 12 worker + 4 close-out tests |

## Thermo-Nuclear

- **Convergence finding 1 (fixed, implement pass 2):** `failed` list docs
  didn't short-circuit — a stray at-least-once redelivery would re-run and
  double-close the run's counters. Both terminal statuses now skip.
- **Convergence finding 2 (fixed, implement pass 2):** stale
  `stOptionsContractListDocId` doc comment claimed runIds are
  underscore-free auto-ids — the actual format contains `_`. Rewritten to
  record *why* the id is safe (never parsed back).
- **Convergence finding 3 (fixed, review pass 1):** terminal-write /
  close-out liveness hole — `writeListDoc(success)` committing while
  `closeOutList` threw meant a retry saw terminal status, skipped, and the
  run hung `running` forever. Fixed by making close-out **idempotent and
  convergent**: the run doc gains a `listOutcomes` map written in the same
  transaction as the counter increment; terminal-status sightings call
  `closeOutList` (a no-op if already counted) rather than skipping
  outright. Self-heals the lost-closeout case and eliminates the
  concurrent-duplicate double-count.
- Deliberately not done: claiming a lease on the list doc for parallel
  first-dispatches (at-least-once delivery is the platform's nature; the
  `listOutcomes` guard already prevents counter corruption — worst case is
  redundant fetch work, bounded by `maxAttempts`), field-level dedupe of
  `listOutcomes` vs counters (the map IS the source of truth for "was this
  symbol counted").

## Convergence log

- Implement pass 1: mapper + worker + 20 tests, `index.ts` export.
- Implement pass 2: `failed`-status skip + `st-collections` comment fix.
- Review pass 1: convergent close-out (`listOutcomes` in the same
  transaction; terminal sightings ensure rather than skip) + shared
  contract field + test updates.

## Test state at review

- `npm run test:options-replay` — 38/38 (9 pick-doc + 8 mapper + 13 worker/close-out + 8 start)
- `functions tsc --noEmit` — clean
- `npm run build` (esbuild bundle) — OK
- eslint `src/options-replay/` — clean
- `shared/options-replay-contracts.spec.ts` — 16/16 (optional `listOutcomes` additive)
