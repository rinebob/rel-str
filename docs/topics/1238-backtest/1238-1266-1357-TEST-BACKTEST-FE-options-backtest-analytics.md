**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1357  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# Test Plan — FE: Backtest Analytics

## E2E User Journeys

- **Filter+find:** several runs (multi-symbol, mixed statuses/templates) → user filters by status + symbol → row set narrows; clears → full list.
- **Rerun:** failed symbol row → Rerun → callable invoked with that runId; button disabled while running; row later shows regenerated status.
- **Analyze→results:** success contract-list card → Analyze → task enqueued → "View Results" → results page loads the exit-type aggregate table + event rows.

## Integration Tests

- `options-replay.store` `runRows` derivation: one row per `run.symbols[]` entry, symbolStatus from `listOutcomes` (missing entry → `'pending'`); multi-symbol run → N rows; single-symbol → 1.
- `filteredRows` composition: status×template×symbol filters compose; empty-filter = all rows; sort by createdAt/startDate/symbol both directions; default createdAt desc.
- Result-doc streaming: `options-analysis-runs.service` query against `contractListDocId`; `where` clause shape verified against the declared index.

## Unit Tests

### `options-replay-run-controls`
- Emits each `*Change` output on control interaction; `templateOptions` lists seeded `REPLAY_TEMPLATES`; renders no config/archive/date controls.

### `options-replay-run-list` (modified)
- Renders one row per derived list row; symbolStatus shown; rerun action visible only on `symbolStatus:'failed'`; rerun emits `runId`; action disabled during run pending/running.
- Selection emits `(runId, symbol)` pair; selected row highlighted.

### Dashboard wiring
- Rerun output → `optionsReplayRetry` call with the row's runId.
- Analyze button enabled iff list `status==='success'`; label switches Analyze→View Results when result docs exist.

### Results page + store
- Aggregate table renders one row per exit type in registry `order`; values bound correctly (hitRatePct, counts, avgDaysToExit).
- Event rows render exit (date+price), expired (ITM flag + distance), and error records distinctly; exit-type filter narrows rows.
- Empty-result and failed-doc states render; loading state while streaming.

## Test Seams

- `optionsReplayRetry`/`optionsAnalysisStart` callables stubbed via `Functions` provider token (existing pattern).
- Result-doc stream stubbed at the service seam (Firestore `collection`/`where` mocked or service stubbed).
- Route param seam: `ActivatedRoute` stub feeds `:listDocId`.

## Edge Cases

- Run with `listOutcomes` absent entirely (legacy runs) → rows derive `'pending'` without crashing.
- Symbol search matches case-insensitively; no-match state renders.
- Aggregate row with `avgDaysToExit` undefined (no exits) renders '—' not NaN.
- Results page with a `failed` result doc → error banner, other exit docs still shown.
