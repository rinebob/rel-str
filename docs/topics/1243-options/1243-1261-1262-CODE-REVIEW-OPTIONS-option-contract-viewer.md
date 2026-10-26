**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1261  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1262  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-06-23  
**Last Updated:** 2026-06-23  

## Verdict: PASS

One major finding was identified during review and **remediated in the same review cycle** before this verdict was recorded. All remaining findings are minor/nit and either fixed or consciously deferred to later tasks in the thread.

## Scope reviewed

- `shared/options-contract-contracts.ts` — `PlottedEntry` interface added
- `src/app/features/savant-trader/utils/plotted-pairs.util.ts` + spec (new)
- `src/app/features/savant-trader/stores/plotted-contracts-feature.ts` + spec (new)
- `src/app/features/savant-trader/stores/options-contract-viewer.store.ts` — feature wiring only

## Standards axis

Clean. The feature mirrors `contract-catalog-feature.ts` structure, the util is a single strict pure function, and specs follow repo convention (real store, service seam mocked, `setTimeout(0)` flush per AGENTS.md, typed fixtures, no `as any`). SDK call signature verified against `getHistoricalOptionsContract$` directly.

## Spec axis

Every acceptance criterion on #1262 is met. `Record<string, PlottedContract>` replaces the spec'd `Map` — correct call for `patchState` semantics; IMPL doc updated to match. `isMultiMode` counts non-error entries (includes `loading`) instead of loaded-only — deliberate anti-flicker choice, IMPL doc updated.

## Thermo-nuclear axis

Store-feature split, parser seam, and test seam confirmed sound. One structural fix required and applied (below).

## Findings

### Critical
None.

### Major

1. ~~**In-flight fetch completions resurrect removed/cleared contracts** (`plotted-contracts-feature.ts`)~~ — **FIXED.** `base` was captured before `await`; the post-fetch patch re-inserted entries removed via `removePlotted`/`clearPlotted`, could regress a concurrently-merged `openDate`, and revived `plottedLoadProgress` after a clear. Fixed by re-reading the entry after the await and patching only when `current?.status === 'loading'` (merges onto the fresh record), plus a progress-write guard that only advances while a batch is still tracking. Two Subject-backed regression tests added: remove-during-flight and clear-during-flight.

## Second pass (post-remediation)

Re-review of the fixed code found **all fixes correct** and no new critical/major issues. Verified: the `'loading'` guard can't drop a legit completion (error entries can never have an in-flight fetch — the worker is the only error writer); remove→reload same-contract landings write correct data. Residual lows recorded below. Two trivial cleanups applied (`toFetch` carries `parsed` only; `setDisplayWindow` param renamed). Tests re-run green.

### Minor

0a. **Cross-batch progress corruption** — clear→new-load while old workers drain lets old workers advance the new batch's counter. Display-only, single caller in v1; batch-generation counter is the v2 fix.
0b. **Stuck-`'loading'` if a patchState throws inside a worker's catch** — requires two consecutive patch failures; recoverable via remove/clear. Optional sweep at `Promise.all` exit noted for v2.

1. ~~**`status: 'error'` entries silently un-retryable**~~ — **FIXED.** Re-queueing a failed entry previously merged the openDate and skipped the fetch; now `existing.status !== 'error'` gates the skip so failed contracts re-queue. Regression test added.
2. ~~**`plottedLoadProgress` resurrected after `clearPlotted`**~~ — **FIXED** (progress write now guarded).
3. ~~**`window` shadows the global**~~ — **FIXED** (renamed `win`).
4. ~~**Worker re-parsed the OCC ID with `!`**~~ — **FIXED** (`toFetch` carries `{entry, parsed}`).
5. ~~**`contractLength` read per queue item**~~ — **FIXED** (snapshotted once per call).
6. ~~**`allDates` could add `undefined` on malformed response**~~ — **FIXED** (guarded add).
7. **Concurrent `loadPlotted` calls share one progress slot** — per-call queue/done are safe; the single `plottedLoadProgress` field can misreport if two calls overlap. Deferred: v1 has a single caller (the paste input). Revisit if a second feeder lands.
8. **`focusPlotted` × `removePlotted` coherence** — focusing pushes the contract into the single-contract slice; removing it later leaves `contractData` pointing at an un-plotted contract. Deliberate for now; the page task (#1264) settles whether focused state outlives set membership.
9. **`asPlotted` cast is manually maintained** — strictly better than the bare `withMethods` convention in `contract-catalog-feature.ts` (which compiles with zero member checking), but renames in the store still won't fail compile. Accepted for v1.

### Nits

- `withAllDatesComputed` must compose after `withPlottedComputed` — ordering constraint now documented on the function.
- Feature surface is unwired (no component consumers) — deliberate store-first slice; #1263–#1265 wire it.
- `renderedSeries` re-parses all contracts per patch — trivial at this scale.
- Two OCC tokens on one line reject as `invalid-date` rather than a clearer reason — cosmetic.
- `PlottedEntry` in `shared/` is FE-only today — kept for the Contract List feeder contract.

### Test results

Full suite: **262 files / 4522 tests — green.** This task: 25 tests (12 parser, 13 feature) including three regression tests added during review (remove/clear-during-flight, error retry).

## Next

`/proj qa 1243 1262`
