# Code Review — #473 Shared Filters panel + delta defaults (+ fetch-cap fold-in)

**Verdict: PASS after fixes** — 350/350 tests green, tsc clean.

Scope: `option-chain-pct-change.component.ts/.spec`, `option-chain-pct-change.store.ts/.spec`, `swing-compare.feature.ts`, `pct-change.utils.ts` (SNAPSHOT_FETCH_CONCURRENCY).

## What shipped

- Filters panel extracted from the Manual run expando → top-level, expanded by default (`filtersExpanded = signal(true)`); applies to manual grids and swing-compare run grids (both read `store.filter()`).
- `DEFAULT_DELTA_FILTER = { deltaGte: -0.6, deltaLte: 0.6 }` in `initialState` and merged under `cfg.filter` in `selectConfig`. Filter compares |delta| — the band caps calls at +0.6 and floors puts at −0.6.
- Snapshot fetch concurrency 8→3 (`SNAPSHOT_FETCH_CONCURRENCY` in utils, shared); `runAnalysis` now uses the same cap (was uncapped `forkJoin` — same burst-502 exposure).
- Config select no longer collapses the Filters panel.

## Findings fixed during review

- **HIGH:** cleared filter inputs leave `undefined` keys on `state.filter`; `setDoc` rejects undefined → "Failed to save config" (became reachable once the band was pre-populated). Fixed: `stripUndefinedFilter()` strips keys in `saveCurrentConfig` — covers the in-memory doc too. Test added.
- **MEDIUM:** `selectConfig` merge could produce `filter.type === undefined` on legacy/malformed docs → always-empty grids. Fixed: `type: cfg.filter?.type ?? cfg.type` backstop. Test added.
- **LOW:** `runAnalysis` target fetches uncapped — capped at `SNAPSHOT_FETCH_CONCURRENCY` with index-preserving re-sort (mergeMap emits in completion order).
- **LOW (spec gap):** selectConfig delta-merge tests added (absent→default, explicit→override).
- **MINOR:** stale header + `onConfigSelect` docblocks corrected.

## Documented non-fixes

- **Missing-delta contracts** are dropped whenever any delta bound is set — with the band on by default, delta-less contracts never render (pre-existing contract, now always-on; flagged to user — partner does return delta, and the expanded Filters panel shows the band).
- **`deltaGte` is a floor on |delta|** — the `-0.6` default is a no-op bound; the UI labels are signed Min/Max but semantics are absolute-value. Cosmetic mismatch, matches the pre-existing filter contract.
