**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Issue:** #427  
**Task:** #428  
**Thread Parent:** #416  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-19  
**Last Updated:** 2026-09-19

# CODE REVIEW — FE: Batch runner in SwingAnalysisStore (Task #428)

## Summary

| Axis | Result |
|------|--------|
| Standards | 2 major found → **both fixed** (see below); minors/nits resolved or documented |
| Spec | **PASS** — every #428 acceptance criterion met and tested |
| Thermo-nuclear | 2 major found → **both fixed**; minors addressed |
| Tests | `swing-analysis*` suites: **219/219 green** |

> Environment note: the repo-wide suite shows ~169 failures in unrelated
> suites (option-chain, portfolio-dashboard, robinhood-mcp, etc.) — all from
> other in-flight working-tree changes outside this task's files. Every
> suite touching this task's files is green.

## Majors — all resolved before verdict

| # | Finding (axis) | Resolution |
|---|----------------|------------|
| 1 | No `error:` handler on outer subscribe — a dead outer stream latches `batchRunning: true` forever, bricking `runBatch` for the session (Thermo) | Added `error: () => { batchSub = null; patchState(batchRunning: false) }` — `swing-analysis.store.ts` |
| 2 | Untracked, uncancellable batch subscription; `resetState` left a zombie sweep writing `batchResults` into a reset store (Thermo + Standards) | Added `batchSub` field tracking, `cancelBatch()`, and `resetState` now unsubscribes + clears all three batch fields |
| 3 | `forkJoin` parallel saves = non-atomic writes; one config save failing while a sibling persisted reported as clean `ok:false` (Standards) | Saves serialized via `concatMap` + `toArray` in `swing-batch.ts`; result contract documented — "failed" means at least one save failed, siblings may have landed |
| 4 | File size — store hit ~645 lines vs guideline ~400 threshold (Standards) | Sweep pipeline extracted to `swing-batch.ts` (~115 lines): `parseSymbols`, `buildBatchSweep`, `recomputeForSave`. Store back to ~590 lines — still over threshold (pre-existing debt), but the task's addition is now thin state plumbing |

## Minors / nits addressed

- `take(1)` guard on `loadBars$` emission — defensive against multi-emission breaking progress math
- `stats: r.stats!` non-null assertion replaced by typed filter (`r is RecomputedSet`)
- Untyped mock-call access (`c[0].symbol as string`) → `c[0] as SwingAnalysisInput`
- Comment added: `loadBars$` never errors in prod (swallows into empty datasets) — `throwError` test covers the defensive path; real failure mode covered by empty-bars test
- `parseSymbols` duplication with `backtest-new-run-form.builder.ts` noted — nit; kept in `swing-batch.ts` (batch-domain module) rather than a cross-feature util

## Spec coverage — task #428 acceptance criteria

| Criterion | Verdict |
|-----------|---------|
| Normalizes input (trim/uppercase/dedupe, comma/space/newline); no-op on empty or while running | ✅ `parseSymbols` + guard; tested |
| Per symbol: `loadBars$` → per-config compute → `saveAnalysis` (config snapshot at start) | ✅ `buildBatchSweep` serial concatMap; snapshot test proves mid-run edits don't leak |
| Display state (`symbol`/`bars`/`pivots`/`swings`/`stats`) untouched | ✅ never patched by sweep; identity assertions in spec |
| `batchProgress {done,total,current}` per symbol; `batchResults` ok/error; `batchRunning` clears | ✅ incl. new mid-run progress assertion |
| Failing symbol recorded, loop continues (bars error, save error, empty bars) | ✅ per-symbol `catchError` → `ok:false` |
| Store spec coverage | ✅ 16 runBatch/cancel/reset tests |

**Test-doc gaps closed during review:** `loadBars$` called exactly once per symbol; mid-run progress ticks; consecutive runs; `cancelBatch`; `resetState` batch cleanup.

## Files

- `src/app/features/savant-trader/swing-analysis/swing-batch.ts` (new — sweep pipeline)
- `src/app/features/savant-trader/swing-analysis/swing-analysis.store.ts` (batch state + thin `runBatch`/`cancelBatch`)
- `src/app/features/savant-trader/swing-analysis/swing-analysis.store.spec.ts`

## Verdict

**PASS** — all acceptance criteria met, all majors resolved, tests green at the task seam.
