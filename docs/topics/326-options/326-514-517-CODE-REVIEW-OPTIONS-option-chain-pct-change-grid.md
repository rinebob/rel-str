**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid<br>
**Thread:** Corpus-backed chain data
**Thread Slug:** corpus-chain-data<br>
**Issue:** #514  
**Task:** #517  
**Topic Parent:** #326  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-22  
**Last Updated:** 2026-09-22  

---

# Code Review — Snapshot source badge (Task #517)

## Standards

- `snapshotSources: Record<string, 'gcs' | 'live' | undefined>` rides the
  same lifecycle as `snapshotErrors` — cleared via `SWING_COMPARE_CLEARED`
  (covers symbol/type/date changes) and rebuilt per `runAnalysis`; a
  failed refetch deletes the key, a successful one overwrites it.
- `PctChangeGridComponent.source` is an optional input — no store coupling
  in the grid; both call sites (main page, run sections) bind
  `snapshotSources()[grid.targetDate]`.
- Chip is small, CSS-scoped, has a tooltip explaining what "live" means.

## Spec (vs. task #517 acceptance criteria)

- [x] `source` captured per date in BOTH fetch paths (`runAnalysis`,
  `ensureSnapshots`) — start date included in the manual path.
- [x] Post-response only — no pre-request loading hint attempted (correct
  per the PRD's constraint: `source` is response metadata).
- [x] Live results visibly marked — orange "live fetch" chip in the grid
  title. `'gcs'` and absent render nothing — the design choice is "silent
  by default, flag the outlier" (a corpus hit is the expected state; live
  is the noteworthy exception worth marking).
- [x] Tests: store spec asserts per-date source capture; grid spec pins
  chip-only-when-live.

## Thermo-nuclear

- Unknown/undefined source values are ignored rather than stringly-typed —
  forward-compatible if SA adds another source value.
- One trade-off: PRD said "label (e.g., cache/gcs vs live)" — we render
  only for `live`. If you want symmetric display (e.g. a subtle 'corpus'
  chip too), that's a one-line change; flag if wanted.

## Test results

Full suite green — 1690 tests, 123 suites.

## Findings

- **nit** — badge is live-only; corpus hits are silent (intentional, but
  flag if symmetric labeling is wanted).

## Verdict: PASS
