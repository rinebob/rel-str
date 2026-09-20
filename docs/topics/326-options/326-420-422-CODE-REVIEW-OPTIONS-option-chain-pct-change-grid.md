# Code Review: Swing-compare state + date-list utils

**Topic:** Option Chain Pct Change Grid
**Topic Slug:** option-chain-pct-change-grid
**Issue:** #420 (FE Blueprint)
**Task:** #422
**Topic Parent:** #326
**Domain:** OPTIONS
**Area:** FE
**Status:** Final
**Last Updated:** 2026-09-19

## Reviewed change

Uncommitted working-tree diff at review time (committed as checkpoint after fixes):

- NEW `utils/swing-compare.utils.ts` — `SwingCompareRun`, `SwingCompareDateItem`, `SwingCompareLabel`, `toUtcDateString`, `mergeDateList`, `defaultTypeForStart`
- NEW `utils/swing-compare.utils.spec.ts` — 14 tests
- NEW `swing-compare.feature.ts` — `swingCompareComputedBlock` + `swingCompareMethods` (extracted during review)
- `option-chain-pct-change.store.ts` — state slice, feature wiring, unified snapshot cache
- `option-chain-pct-change.store.spec.ts` — `swing-compare state` describe (10 tests) + snapshotCache migration
- `utils/pct-change.utils.ts` — `newId`, `chainContracts`, `closestPriorCloses` (extracted during review)

## Standards

- **Fixed — Duplicated Code:** `ensureSnapshots` copied `runAnalysis`'s closest-prior-close loop and chain-payload unwrap verbatim → both now use `closestPriorCloses()` + `chainContracts()` from `pct-change.utils.ts`.
- **Fixed — file size:** the ~200-line swing-compare slice pushed the store to 937 lines → extracted to `swing-compare.feature.ts` (store back to 822; still >400 guideline — pre-existing, flagged).
- **Fixed — untracked subscription:** `ensureSnapshots`' fetch wasn't cancellable → `snapshotSubs` set, cancelled in `setSymbol`/`reset` like `runSub`/`swingSub`/`resolveSub`.
- **Fixed — `as never` spy** → `jest.spyOn(svc as OptionsContractService, ...)`.
- **Fixed — untyped `mkPivot`/`mkSwing` fixtures** → `Pivot`/`Swing` annotations.
- **Fixed — Mysterious Name:** `pivotDate` → `toUtcDateString` (it's ms→date, not pivot-specific).
- **Fixed — Primitive Obsession:** label literals → `SwingCompareLabel` union type; pivot labels dedupe like signals.
- **Noted:** `ensureSnapshots` failures log-only (consistent with `loadSwingData`); `pendingSnapshotDates` keyed by date is safe because `setSymbol` clears it on change.
- **Noted:** `mkSignal`/`makeSwingAnalysisDoc` fixtures now duplicated across spec files — nit, defer to a shared fixtures file if a third consumer appears.

## Spec

All five acceptance criteria met:

- `frameSetId`/`extremesSetId`/`frameSwing`/`runs` state — ✓
- `dateList` merges confirmed pivots + signals inside `[frameStart, frameEnd]` (inclusive), labeled + sorted — ✓
- `targetCandidates(start)` filters post-start — ✓
- `defaultTypeForStart` low/LONG→CALL, high/SHORT→PUT — ✓ (pivot wins outright on collisions)
- `addRun`/`removeRun`; `ensureSnapshots` fills cache, skips cached + in-flight — ✓

Deviations (documented, intentional):

- `signals` is a computed over `SymbolHistoryStore` cache, not stored state — superior to the IMPL sketch (kills stale-symbol landing); flagged in the #421 review too.
- `swingPolyline`/`swingSegments` deferred to #423 (picker geometry) per task split.
- **Fixed during review:** `selectFrameSwing` now clears `runs` — runs were previously left pointing at dates outside the new frame bounds.

## Thermo-nuclear

- **Fixed — three snapshot representations → one:** `startSnapshot` + `targetSnapshots` folded into `snapshotCache`; `grids`, `selectedContractSeries`, `runAnalysis`, `ensureSnapshots` all read/write the same date→contracts map. `selectedContractSeries` builds its target map from `targetDates` only, so run-section entries can't leak into the chart popup.
- **Fixed — feature extraction:** computeds + methods moved to `swing-compare.feature.ts` behind `SwingCompareStoreApi`/`SwingCompareDeps` interfaces — the slice is separable, tested through the store, and keeps the main file under 1k through #423–#426.
- `targetCandidates` kept as a store method despite being one line — the call sites (#424) read better, and it keeps the predicate testable.
- **Noted:** `Subscription` pre-created before `forkJoin(...).subscribe()` so synchronous mock emissions don't hit the binding in TDZ.

## Test results

- pct-change suite: **305/305 green** (10 suites), typecheck clean.
- New coverage: frame-end boundary, `selectFrameSwing` clearing runs, `ensureSnapshots` skip-cached/dedup, symbol-change clearing.

## Verdict

**PASS** — all majors fixed and re-verified before this verdict; nits recorded above.
