**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Issue:** #1634  
**Task:** #1637  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# Code Review — FE-IMPL: lazy store — index + trees memo + ensureTopic + all-topics queue (#1637)

## Axes summary

| Axis | Verdict | Findings |
|---|---|---|
| Standards | FAIL → remediated | 2 majors (queueActive reset vs. stale finallys; unconditional inFlight.delete); 4 minors; 4 nits |
| Spec | PASS → pins hardened | all 7 ACs met; 1 minor (same stale-finally hole), 2 weak pins, 2 nits |
| Thermo-nuclear | FAIL → remediated | 3 majors in-scope (M1 cap blowout, M2 dedupe clobber, M3 unguarded write path); M4/M5 deferred to #1638; 3 masked specs |

## Remediated in-gate

1. **MAJOR — `queueActive` reset vs. stale `.finally` callbacks**
   (all three axes converged): `dropMemo`/`selectRepo` zeroed
   `queueActive` while in-flight queue dispatches still ran
   `.finally(() => { queueActive--; pump(); })` — a routine refresh
   mid-drain would fire ~8–12 concurrent subtree calls against the
   cap of 4 and double-fetch every in-flight topic. Fix: `queueEpoch`
   closure counter bumped by `dropMemo`; the pump finally captures the
   generation at dispatch and no-ops when stale.
2. **MAJOR — unconditional `inFlight.delete(n)`** (all three axes
   converged): a stale-epoch promise's `.finally` deleted the NEW
   epoch's dedupe entry registered after the map clear — a third
   trigger inside the gap fired a duplicate callable. Fix:
   `if (inFlight.get(n) === p) inFlight.delete(n)`.
3. **MAJOR — `updateIssueLabels` had no epoch guard** (Thermo M3):
   a label write issued on repo A could apply its labels to repo B's
   same-numbered issue after a mid-flight repo switch — every read
   path checked `memoSeq`; the write path checked nothing. Fix:
   capture `memoSeq` before the await; skip `applyLabelUpdate` when it
   changed (the callable result still returns — the write succeeded
   server-side on the old repo).
4. **Sync dispatch throw leaked state** (second-pass hardening of
   Thermo's slot-leak minor): `service.getLifecycleTopicTree$` invokes
   `runInInjectionContext` eagerly — a synchronous throw left the
   topic stuck in `treeLoading` with no fetch and no error. Fix:
   dispatch wrapped so a sync throw routes through `throwError` → the
   normal `.catch` error path; pump's own try/catch reclaims the slot
   defensively.
5. **`allTopicsDrained` went stale** (Standards 4): a filter/top-up
   retry could succeed while the drain flag was still set — banner
   over loaded data. Fix: flag cleared inside `enqueueFiltered`
   (re-populating the queue IS the retry).
6. **`selectRepo` duplicated `dropMemo`'s bookkeeping** (Standards 5):
   now calls `dropMemo()` and patches only its own additional fields.
7. **Three vacuous queue specs** (Thermo M6 + Spec F2/F3): manual
   `ensureTopic` calls masked queue dispatch — isolation, filter
   top-up, and refresh-refetch specs now count queue-dispatched calls
   only (assert before any manual `ensureTopic`).
8. **New regression specs**: refresh-mid-flight spec pins M1+M2
   jointly (stale settles free no slots, clobber no dedupe entries,
   discard no data into the new epoch); M3 spec pins the write-path
   epoch guard; `setShowClosed(true)` top-up pin added (Spec F2).
9. **Nits**: `treeErrors` patch churn guard; `[...arr].sort()` no
   longer mutates the live signal array; redundant jest casts dropped;
   stale service-spec header corrected; priority-lane comment added
   (user-triggered `ensureTopic` intentionally bypasses the queue
   cap); `getLifecycleTree$` retention documented (deployed rollback
   surface); state-field comments corrected to name #1638 as the page
   consumer.

## Deferred findings (disposition recorded)

- **Page never binds `treeErrors`/`treeLoadingSet`/`allTopicsDrained`/
  `treeFetchedAt`** (Thermo M4/M5): a selected-but-loading topic shows
  the unselected copy; per-topic errors are invisible; the all-topics
  pane flashes "No Topics found" while the first trees land. This is
  `#1638 — FE-IMPL: service wrappers + page skeleton/retry/progressive
  all-topics` scope per the IMPL doc's task split — carried to the QA
  gate as a shipped-surface risk: #1637 must not ship to a
  user-verifiable UI without #1638's page states landing alongside it.
- `updateIssueLabels` success clears an unrelated banner `error`
  (pre-existing semantics, nit — accepted).
- `selectTopic` clears `suppressedIds` unconditionally (pre-existing
  semantics, nit — accepted).
- `trees` object re-created per landing topic → O(topics²) computed
  work during a queue drain (fine at current scale — noted).
- Store file ~780 lines — past the 400-line smell guideline;
  SignalStore single-file cohesion is the accepted counterargument;
  flagged for a conscious revisit if it approaches 1k.
- `selectRepo` early-returns on the same index — after a failed load,
  the same repo can't be re-picked for retry (use Refresh; nit).
- `treeFetchedAt` written but not yet rendered — #1638 display scope.

## Acceptance criteria trace

| AC | Evidence |
|---|---|
| `load` = index only, zero subtree calls | spec-pinned (`topic-viewer.store.spec.ts` — index called once, `getLifecycleTopicTree$` never called on refresh) |
| `ensureTopic` memo/dedupe | memo-hit zero-call spec; three concurrent triggers → 1 call, identical resolutions |
| all-topics queue: unfetched-filtered only, bounded 4, rate-limit drain, per-section isolation | Subject-driven specs — 4 max in-flight; drain sets flag + clears queue + re-enable retries unfetched only; non-RL errors isolate to `treeErrors[n]` |
| `showClosed` = index filter | zero-call spec (all-topics off) + queue top-up spec (on) |
| `refresh` = index + memo drop + rendered set only | selection-only + filtered-set variants spec'd |
| existing derivations green | all adapted derivation specs retained |
| `npx jest src/app/features/topic-viewer/` green | 98/98 |

## Test results

- `npx jest src/app/features/topic-viewer/` — **98/98** (4 suites)
- `npx jest --coverage=false` — **6,149/6,149** (324 suites; the
  repo's pre-existing worker-teardown warning recurs, unchanged)
- `npx tsc -p tsconfig.app.json --noEmit` — clean

## Second pass

Re-checked the union of the three axes against the full diff: all
majors remediated + spec-pinned; the sync-throw leak surfaced as the
one finding the axes under-specified (fixed); remaining items are
scope-deferred (#1638) or accepted pre-existing nits. Converged —
no third pass needed.

## Verdict

**PASS** — remediated in-gate. Every major carried a spec pin; the
deferred page-state surface is #1638's task and is recorded as a QA
dependency for ship.
