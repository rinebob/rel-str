**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #514  
**Task:** #516  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# Code Review — Per-date resilience for manual runs (Task #516)

## Standards

- `TargetResult` is an explicit discriminated union carrying the input
  index — order survives `mergeMap`'s completion-order emission; typing is
  strict (no narrowing casts).
- Failed targets land in the same `snapshotErrors` map `ensureSnapshots`
  uses — one error model for both paths; the retry button reuses
  `ensureSnapshots([d])`, so no parallel retry machinery.
- `grids()` filters errored dates — a missing cache entry no longer
  renders a misleading empty "No contracts" grid.

## Spec (vs. task #516 acceptance criteria)

- [x] One bad target date degrades to an error row; the rest of the run
  completes — `error` stays null.
- [x] Failed dates render as dated error rows (not silent, not a blank
  grid).
- [x] Start-date failure still fails the whole run (start$ stays
  uncaught → forkJoin-level error path).
- [x] Retry per date via `ensureSnapshots`.
- [x] Template gate is `hasResults() || failedTargetDates().length` — the
  all-targets-fail case still shows the error rows instead of nothing.
- [x] Spec coverage: partial-failure store test asserts the good date
  renders + bad date errors; start-failure test pins the fail-the-run
  contract.

## Thermo-nuclear

- Errored dates removed from `targetDates` leave a stale `snapshotErrors`
  key — invisible (`failedTargetDates` only reads current targets) and
  cleared on the next run; harmless.
- `underlyingPrices` computes over all requested dates including failed
  ones — harmless, it's just a price lookup map.

## Test results

Full suite green — 1690 tests, 123 suites.

## Findings

None.

## Verdict: PASS
