**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1366  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1376  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# Code Review — #1376: Analyze / View Results entry point

## Verdict

**PASS** — two rounds. All three acceptance criteria met; no critical or major findings. R1 remediations all verified correct in R2; three low/nit findings from R2 fixed; remainder deferred with notes below.

## Round 2 (2026-11-05)

All three axes re-verified every R1 fix as correct — no regressions from the remediations. Spec axis explicitly affirmed the success-only `analysisReadyListIds` is the *correct* AC interpretation (failed docs are tombstones, not results; Analyze re-click is the only re-run affordance and the callable is idempotent).

**R2 findings — all remediated:**

| Severity | Finding | Fix |
|---|---|---|
| Low (flagged by 2 axes) | `status ?? 'success'` converter default — a malformed doc would flip the card to dead-end View Results | default now `'failed'` (fails safe — Analyze stays enabled) |
| Nit | `jest.requireActual('rxjs')` indirection in the service spec | top-level `of` import |
| Nit | `selectRun` JSDoc still said "contract lists" only | updated |

**R2 info-level deferrals:** full-doc retention in `analysisResults` (memory-only, forward state for #1377); failed-analysis invisibility on the card (deliberate — `doc.error` tooltip is ~5 lines if #1377 wants it); `Number(registryVersion)` NaN propagation (nothing compares it); store file at ~466 lines (split decision belongs to #1377 when the real read shape lands).

## Changes

- `options-analysis-runs.service.ts` (new) — `startAnalysis` → `optionsAnalysisStart` callable; `watchResultDocs(runId)` → `st-options-analysis-results` where `runId ==`, docs through `convertAnalysisResultDoc`
- `options-analysis-runs.service.spec.ts` (new) — callable name/payload + `where`-clause shape pinned
- `options-replay.store.ts` — `analysisResults` stream alongside the lists stream (renamed `loadRunStreams`), success-only `analysisReadyListIds`, `analyzingListIds` flag pruned on doc arrival / error / selection clear; `selectRow` dead-stream guard covers both streams
- `options-replay.store.spec.ts` — stream lifecycle, flag lifecycle (hold → doc-lands prune → different-list retention → deselect clear), toast paths, failed-doc exclusion
- `options-replay-run-detail` — card action: Analyze (enabled iff `status==='success'` and not in flight) emits listDocId → View Results routerLink when ready; `analysisLink` computed in the view model
- `backtest-analysis-results` page (new) — minimal route shell; #1377 builds the surface
- `interfaces.ts` / `constants.ts` / `core-routes.ts` — param'd enum route per `HEATMAP_CHART` convention; `authGuard`; PAGE_INFO keyed by the param'd path
- `backtest-dashboard.component.html` — input/output wiring

## Axes

### Standards — no hard violations

Contract baseline verified end-to-end: callable name/payload, `contractListDocId` request field, results-collection rules (authed read, deny client writes), single-field `where` needing no composite index, param'd-enum route convention, spec conventions (jest.fn, Subjects, no fakeAsync). Judgement calls tracked below.

### Spec — all ACs MET

- AC1 enabled iff `status === 'success'` — `canAnalyze` + `[disabled]` matrix spec'd (success enabled, failed disabled, no-doc hidden)
- AC2 `optionsAnalysisStart` with `contractListDocId` — emit → store → `httpsCallable('optionsAnalysisStart')({contractListDocId})`; pinned by the new service spec
- AC3 View Results → `/options/strategy/backtest/analysis/:listDocId` — param'd enum route + link href asserted in spec

Query-key drift noted: plans specify `contractListDocId` for the results-page stream (#1377's concern); the card surface uses `runId` — one query feeds all cards, defensible and documented in the service docstring.

### Thermo-nuclear — no criticals

Spec quality clean (external-behavior assertions, typed fixtures, no setTimeout). Structural notes tracked below.

## Findings — remediated in-cycle

| Severity | Finding | Fix |
|---|---|---|
| Minor | `ready` included `failed` docs → dead-end View Results with no card re-run | `analysisReadyListIds` now success-only — failed docs keep Analyze re-clickable (callable is idempotent); spec added |
| Minor | `as unknown as AnalysisResultDoc` cast skipped the converter seam | `convertAnalysisResultDoc` added (defaults for sparse docs, mirrors sibling converters) |
| Nit | `analysisPath.replace(':listDocId', …)` string surgery in template | `analysisLink` computed inside `symbolViews`; template binds it directly |
| Minor | No spec on the service seam — TEST-FE requires the `where` shape verified | `options-analysis-runs.service.spec.ts`: callable name + `{contractListDocId}` payload + single-field `where('runId','==')` pinned |
| Nit | `loadContractLists` owned two run-scoped streams | renamed `loadRunStreams` |
| Nit | "Snapshot is post-retry truth" comment duplicated (pre-existing) | merged into one paragraph |
| Nit | spec gaps: different-list doc retaining flag; page-spec setup duplication | both added/fixed |

## Deferred

- `options-replay.store.ts` at ~470 lines and now owning a second Firestore domain — an `OptionsAnalysisStore` split is #1377's call once the results page's real read shape lands (results-page queries are per-`contractListDocId`, not run-scoped).
- The 3-site `next.size === set.size` prune idiom — a helper saves ~4 lines at each site; churn outweighed benefit.
- Sticky View Results after a list regression — result docs aren't deleted on re-run/reset, so a re-run list can link to stale docs. Real staleness, but the results page surfaces `generatedAt`; revisit under #1377 if it confuses.
- `analyzingListIds` has no timeout escape if the worker never writes — bounded by run deselect; callable is idempotent so a stale flag only delays a duplicate click, never corrupts.
- `analysisResults` retains full docs for a membership check today — forward state for #1377's results surface.

## Tests

- Task suites: **209/209** (`backtest` tree + `core-routes.spec.ts`), `tsc --noEmit` clean.
- Full suite: **5175/5176** — the one failure (`DevScreenshotComponent` clipboard-rejection spec) is in uncommitted foreign-session changes to `dev-screenshot.*`, not on HEAD and unrelated to this task.
