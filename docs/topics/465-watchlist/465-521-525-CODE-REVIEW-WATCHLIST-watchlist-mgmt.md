**Topic:** Watchlist management  
**Topic Slug:** watchlist-mgmt  
**Thread:** Unified list infrastructure  
**Thread Slug:** unified-list-infra  
**Issue:** #521  
**Thread Parent:** #492  
**Topic Parent:** #465  
**Task:** #525  
**Domain:** WATCHLIST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

# Code Review: #525 — Store catalog computeds + snapshot-truth mutations

Three axes run in parallel (Standards, Spec, Thermo-nuclear); findings
fixed and regression-tested in-tree before verdict.

## Summary

| Axis | Verdict | Notable findings |
|---|---|---|
| Standards | PASS after fixes | M1 `trackedInFlight` never reset on error; M2 divergent untriaged semantics — fixed |
| Spec | PASS after fixes | F1 unknown-key misroute to exclusive path — fixed (guard); ACs all MET |
| Thermo-nuclear | PASS after fixes | F1 moveToList read-modify-write race — fixed via write queue; F2 array-alias — fixed |

## Acceptance criteria — all MET

1. `loadSymbolLists` opens one `watchLists$` subscription (guarded,
   `takeUntilDestroyed`, retry on error); emissions re-derive computeds.
2. No optimistic `patchState` / rollback in mutations — snapshot is truth.
3. `untriagedSymbols` counts exclusive-role memberships only.
4. Exclusive toggle → `moveToList` over exclusive keys; nonexclusive →
   add/remove (role-routed; MONITOR name-check removed).
5. Re-filing preserves nonexclusive memberships (moveToList writes only
   exclusive keys).

## Findings by severity

### Major — fixed

- **`trackedInFlight` never reset on error** — a failed tracked-universe
  load could never retry. Reset in the error path; spec covers.
- **Unknown list key misrouted to `moveToList`** — a key absent from both
  catalog and seeds (deleted/stale user list) would have stripped all
  exclusive memberships and materialized a malformed doc. Guarded with a
  snackbar + early return; spec covers.
- **`moveToList` read-modify-write race** — rapid toggles could interleave
  reads before the first commit, leaving a symbol in two exclusive lists.
  All mutations now flow through a serialized `writeQueue`
  (`firstValueFrom` chained per write); spec asserts ordering.
- **Divergent "untriaged" semantics** — `chart-review-viewport` signals
  mode used name-driven `isUnlisted` while browse mode used role-driven
  `unlistedSymbols`. Signals mode now intersects `reviewSymbols` with the
  role-driven untriaged set; `isUnlisted` import removed.

### Minor — fixed

- `symbolLists` computed copied arrays (`[...d.symbols]`) — consumers can
  no longer mutate catalog state by reference.
- `catalog` computed gained a label secondary sort for order ties.
- `toggleMonitor` delegates to the role-routed `toggleSymbolInList`
  (single code path).
- Redundant double `find` in `toggleSymbolInList`; spec's type-erased
  `mockWatch` holder replaced with a plain `Subject`.
- New specs: unknown-key guard, write-queue serialization, stream
  error→retry, failed-write snackbar.

### Accepted / deferred

- `loadAllLists` in the service is now dead-ish (only compat callers) —
  removal lands with #528's consumer migration.
- `filterOptions` grouped computeds belong to #527/#528 per plan.
- Mutation echo latency is the accepted snapshot-truth tradeoff.

## Test results

- Focused: `symbol-list.store.spec.ts` 10/10, `symbol-nav.feature.spec.ts`
  18/18, services + chart-review suites 53/53.
- Full suite: 126 suites / 1733 tests — all green.
- tsc: no errors in changed files (unrelated in-flight work aside).

## Verdict

**PASS** — ACs met, all critical/major findings fixed with regression
coverage.
