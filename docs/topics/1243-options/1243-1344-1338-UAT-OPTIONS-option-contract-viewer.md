**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1344  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1338  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# UAT — FE: Availability service + generator store

## Scope

#1338 delivers the drawer's data lifecycle: a thin
`ContractAvailabilityService` callable seam and the page-scoped
`OptionGroupGeneratorStore` (query → fetch → refine → emit → persist).
No UI surface and no reachable network in tests — acceptance is exercised
through the Jest spec suite with the service stubbed, which is the
documented verification path (TEST-FE "Lower seams: store with mocked
service").

Acceptance criteria (QA issue #1344):

1. `queryContractAvailability$` hits the `queryContractAvailability`
   callable; symbol normalized; empty symbol → error.
2. `run()` populates records/status/truncated/corpusDates; error → error
   state; `ok:false` body → error state.
3. `refine`/`applyRange` recompute `filtered` without refetch; applyRange
   fills openDate only per toggle (incl. toggle-ON backfill + persisted
   restore); inverted/empty bounds rejected.
4. Params persist under `rs-optgen:{SYMBOL}` on mutation/run; `setSymbol`
   loads that symbol's blob; `clear` resets + removes blob.
5. Stale guards: symbol-switch mid-fetch, clear-mid-fetch, and
   overlapping same-symbol runs all discard superseded responses.
6. `emit()` produces sorted `date,id`/bare pair lines over the filtered
   set.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, deps installed.
- Jest 30 + jest-preset-angular.
- No credentials/services/seed data — service seam is `jest.fn()`-stubbed;
  localStorage runs under jsdom.

## Start instructions

```powershell
npx jest src/app/features/savant-trader/stores/option-group-generator.store.spec.ts `
         --coverage=false
```

Expected: 20 tests green.

## Scenarios

1. **Service seam callable wiring** — `queryContractAvailability$` invokes
   `CallableName.QUERY_CONTRACT_AVAILABILITY` with the request verbatim +
   normalized symbol. Verified by the run specs asserting
   `objectContaining({ symbol: 'QQQ' })` on the stub call; the
   callable-name constant lives in `constants.ts`.
   Result: PASS.

2. **Run populates result state** — spec `fetches via the service…`:
   records, `status:'idle'`, `truncated`, `corpusDates` all land.
   Result: PASS.

3. **Wire assembly through the store** — spec `passes the assembled
   availability request…`: explicit expirations override the range at the
   store→service boundary (FE-1's `toAvailabilityQuery` in the loop).
   Result: PASS.

4. **Error paths** — spec `lands in error state…` (service rejection →
   `status:'error'`, message surfaced, records empty); `ok:false` guard
   verified in code review (no live callable exists to exercise it —
   noted in findings).
   Result: PASS.

5. **Refine without refetch** — spec `narrows filtered records…`:
   `setRefine` recomputes `filtered`, service called exactly once.
   Result: PASS.

6. **Alive-across-range bound** — specs `applyRange writes…`,
   `applyRange(null) clears…`, `ignores an inverted range`,
   `rejects empty/whitespace bounds…` (trimmed copy, no aliasing).
   Result: PASS.

7. **Range→openDate link** — specs `applyRange fills openDate only when…`,
   `turning the toggle ON…backfills`, `restores openDate from a persisted
   toggle+range`. Covers all three fill paths.
   Result: PASS.

8. **Persistence** — specs `run persists…` (blob under
   `rs-optgen:QQQ`), `setSymbol loads…isolated`, `clear resets…and
   persists` (blob key removed, defaults restored).
   Result: PASS.

9. **Stale guards** — specs `discards…symbol changed mid-fetch`,
   `clear() during an in-flight run…`, `a second run() supersedes the
   first`. All three supersession paths verified.
   Result: PASS.

10. **Emit handoff** — specs `produces sorted pair lines…`,
    `emits bare ids…`, `emits an empty list…`. Dated/bare/empty emit
    shapes over the filtered set.
    Result: PASS.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| QA-1 service seam | 1, 3 |
| QA-2 run/error states | 2, 4 |
| QA-3 refine/range/toggle | 5, 6, 7 |
| QA-4 persistence | 8 |
| QA-5 stale guards | 9 |
| QA-6 emit | 10 |

## Refinement pass

Not applicable — no user-facing surface in this task (service + store).
Drawer UI UAT lands with #1339.

## Regression / smoke checklist

- [x] Full Jest suite — 282 suites / 4,866 tests PASS during review gate.
- [x] `tsc --noEmit` — clean on touched files; 3 pre-existing errors in
      unrelated files only.

## Execution log

- 2026-10-29 — Focused spec run executed under the command above;
  20/20 green; results recorded per-scenario.
