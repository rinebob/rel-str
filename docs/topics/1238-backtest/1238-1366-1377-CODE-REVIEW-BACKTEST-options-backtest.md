**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1366  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1377  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — #1377: FE Task: Analysis results page

## Verdict

**PASS** — two rounds. All four acceptance criteria met; R1's two majors remediated in-cycle, and all three axes re-verified every fix as semantically correct in R2. R2's small batch of new findings fixed; residual items are malformed-doc armor deliberately skipped per scope discipline.

## Round 2 (2026-11-05)

All three axes re-ran on the remediated diff. Every R1 fix verified correct — no regressions. New findings and their disposition:

**Fixed:**

| Severity | Finding | Fix |
|---|---|---|
| Low (Standards) | `new Map() as unknown as ParamMap` in the rebind spec — §10 violation; also `Map.get` returns `undefined` vs `ParamMap.get` `null` | `convertToParamMap` (sibling-spec convention) |
| Low (Standards) | `.analyzed-at` rendered raw ISO; feature convention is `formatBacktestTimestamp` | component `analyzedAt` computed → PT format; spec updated |
| Minor (TN) | Converter `status` cast passed invalid values through — `'garbage'`/`42` → silent '—' row, no banner | `ANALYSIS_RESULT_STATUSES.includes()` membership check → `'failed'`; spec pinned |
| Minor (TN) | Converter `aggregate: 'junk'` passed the cast → blank cells, not '—' | `typeof === 'object'` guard → zeroed default; spec pinned |
| Nit (Standards) | `daysHeld: 0` placeholder rendered on error rows (same rationale as MAE/MFE) | `'—'` on error rows; spec updated |
| Minor (TN) | Staleness invisible in the events table — chip only in aggregates | `EventRow.stale` + badge in the Exit-rule cell; spec pinned |
| Nit (Spec) | store spec `makeDoc` used literal `registryVersion: 1` — rots on registry bump | `EXIT_REGISTRY_VERSION` constant |
| Nit (TN) | `subject()` rendered a bare '·' for sparse docs; index comment imprecise | guard on `symbol \|\| templateId`; comment corrected (single-field `==` rides the automatic index) |

**Skipped — documented deferrals (malformed-doc armor, per AGENTS scope discipline):**

- Per-element `trades` validation in the converter (a malformed record could throw in `outcomeText`) — worker-owned writes; boundary accepted explicitly.
- `streamError` arriving *after* docs renders tables without an error note (post-first-emission errors keep stale docs) — Firestore listeners don't recover into this state in practice.
- Param→absent transition on a live component leaves the old subscription until destroy — the route requires the param; unreachable.
- `failedRows.stale` computed but unrendered; `'running'` docs render like `'missing'` (worker never writes them); chips on failed rows yield an empty table; `ExitFilter` collapses to `string`.

## Axes

| Axis | Verdict | Summary |
|---|---|---|
| Standards | Pass with nits | Signal-store shape, converter seam, Firestore index/rules coverage, jest idioms, page-scoped store, union narrowing all conform. No critical/major. |
| Spec | PASS | All 4 ACs met with spec coverage tracing service→store→DOM. Deltas were minor coverage nits only. |
| Thermo-nuclear | Hold → cleared | Two majors (below), both remediated. Verified stream lifecycle, state shape, fail-safe rendering as correct. |

## Major findings — remediated in-cycle

| # | Finding | Fix |
|---|---|---|
| M1 | Staleness invisible: `registryVersion` never compared to `EXIT_REGISTRY_VERSION`, `generatedAt` never rendered, orphan exitIds (removed strategies) would flood `eventRows` with rows that have no aggregate row or chip. The #1376 review explicitly deferred staleness to this task. | `AggregateRow.stale` flags `registryVersion ≠ EXIT_REGISTRY_VERSION` → `stale` chip + `row-stale` styling; header renders latest `generatedAt` ("Analyzed …"); `eventRows` gates to registered exitIds; `failedRows` stays docs()-derived so orphan *failed* docs still surface (commented). |
| M2 | `convertAnalysisResultDoc` — load-bearing `status ?? 'failed'` fail-safe — was private in the service with zero coverage (`collectionData` stub returned `of([])`); deviates from the converter-file+spec convention. | Extracted to `options-analysis-firestore-converter.ts` + spec pinning full-doc mapping, sparse defaults, the fail-safe, and non-array trades coercion. |

## Minor findings — remediated in-cycle

| Finding | Fix |
|---|---|
| Error rows rendered the contract's entry-day `mae/mfe` *placeholder* as real excursion data | `—` for MAE/MFE when `outcome === 'error'` (+ spec) |
| Union-impossible spec fixtures (`as AnalysisTradeRecord` masked the union — an `expired` record without `assignmentDistancePct` compiled but crashed `outcomeText`) | Per-variant typed factories (`makeExitRecord`/`makeExpiredRecord`/`makeErrorRecord`) in both specs |
| In-flight analysis showed misleading "never run" empty copy | Copy now notes results appear when a started analysis finishes |
| Absent route param spun "Loading…" forever | Dedicated "No analysis list in this route" state (+ spec) |
| `'—'` for absent optional stats only covered the missing-doc path | Spec now pins a success doc with `avgDaysToExit` absent → `—`, no NaN |
| Component-level param-change rebind uncovered | paramMap stub → `Subject`; spec asserts re-subscription on param change |
| Redundant `destroyRef.onDestroy` (takeUntilDestroyed already covers) + per-recompute registry sort | Removed; hoisted `SORTED_STRATEGIES` |
| `provideNoopAnimations` unused | Removed |

## Deferrals / judgement calls (non-blocking)

- `'running'` docs render like `'missing'` ('—' row, no indicator) — dormant: the worker only writes success/failed today (`worker.ts` — "No 'running' docs"). Revisit if the worker ever emits running.
- Filter chips include `failed`/`running` rows → selecting one shows an empty event table. Defensible (shows the exit exists).
- `watchResultDocs`/`watchListResultDocs` are 8-line twins differing only in the `where` field — borderline dedupe, left as-is for readability.
- Orphan *success* docs (unregistered exitId) are excluded from `eventRows` silently; failed orphans surface via the banner. Acceptable staleness posture for v1.
- Spec factories duplicated across the two spec files (~40 lines) — spec-local is the repo convention; a shared fixture module is a separate cleanup.
- `expect(agg.length).toBe(6)` pins registry size — intentional; will break on registry growth.

## Test evidence

- Backtest suites: **166/166** (13 suites), tsc clean — converter specs (incl. invalid-status/non-object-aggregate guards), staleness/orphan/param-rebind, error-placeholder '—', PT-formatted stamp.
- Full suite: **5197/5202** — 5 failures all in uncommitted foreign work (#1363/#1419 contract-list chunk/timeline: `sendChunkAt` missing on the store type, picker send/chunk specs mid-refactor). None in this diff.

## Files in scope

- `services/options-analysis-runs.service.ts` + `.spec.ts` — `watchListResultDocs(contractListDocId)`; converter extracted
- `services/options-analysis-firestore-converter.ts` + `.spec.ts` (new)
- `stores/analysis-results.store.ts` + `.spec.ts` (new) — page-scoped store: stream, aggregateRows, failedRows, eventRows, staleness, filter, states
- `pages/backtest-analysis-results/` (4 files) — aggregate table, event table, chips, banner, states, stale badges, analyzed stamp
