**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1283  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — Task #1283 (Replay runs service + runs list)

## Verdict: PASS

Three axes against the converged working tree. No convergence findings —
the implement passes self-healed the only risk (the read/write contract
question resolved by inspection, below).

## Standards

- Faithful mirror of the proven `backtest-run.service.ts` /
  `BacktestRunStore` / `backtest-run-list` pattern: service with
  `runInInjectionContext` watchers, pure converter, signalStore with
  `watchStream` + `takeUntilDestroyed`, presentational OnPush components
  with signal inputs/outputs and `@for`/`@if` template syntax.
- `OptionsReplayStore` is a dedicated store (not a `BacktestRunStore`
  feature) — correct seam: different data model, different lifecycle.
- `import type` for type-only contracts; `@st/collections` +
  `@options-replay/templates` aliases used per tsconfig paths; FE bundle
  already pulls the shared registry (build verified).
- Naming `options-replay-*` per IMPL-FE; specs colocated per repo
  convention; `jest.fn()` over jasmine spies per AGENTS.md.
- Reuses `getBacktestStatusVisuals`/`formatBacktestRunId`/
  `formatBacktestTimestamp` — the shared status/format vocabulary covers
  `success` (list-doc status) and the replay runId format verbatim.

## Spec (issue #1283 ACs)

| AC | Result |
|---|---|
| Runs list renders status + `completedLists/totalLists` + failed badge | **PASS** — columns + progress bar + conditional `.failed-badge`; covered by spec |
| Live updates as run/list docs change | **PASS** — `collectionData` listeners; store spec proves emission→signal update |
| Sim runs list untouched | **PASS** — additive second `<section>`; zero changes to sim components |
| Tests per TEST-FE | **PASS** — status→visuals mapping, progress, badge, live update, error snack-bar, pending-placeholder |

## Thermo-Nuclear

- **Read/write contract verified, not assumed:** the FE query filters
  `where('runId','==',runId)` on list docs — traced every worker write
  path to confirm no terminal state can produce a doc without `runId`
  (`running` write always lands first and `writeListDoc` uses
  `set(merge)`; `failPermanently` spreads `runId/symbol/templateId` into
  the failed write). A failed doc can never silently vanish from the
  symbol grid.
- **Composite index verified:** `where runId ==` + `orderBy symbol`
  matches the `(runId ASC, symbol ASC)` index #1277 declared.
- **`from(observable)` flattening confirmed** — same emission-mapping
  pattern as the sim service.
- Deliberately not done: same-run re-click resubscribe (identical to
  `BacktestRunStore.selectRun`, convention preserved); `pending`-window
  `createdAt` renders `—` (standard serverTimestamp behavior, same as
  sim list); no `watchRun` single-doc method (no consumer needs it).

## Deliberate scope splits (documented in IMPL-FE as-built)

- Detail is a **shell** — per-symbol status cards only; the
  `pickDocMeta` coverage header belongs to #1285 (its AC).
- `optionsReplayStart` callable wiring deferred to #1284's run dialog.

## Convergence log

- Implement pass 1: module + dashboard mount + 4 specs, build green.
- Implement pass 2: verified runId-presence-on-every-doc contract,
  merge semantics, index coverage, `from()` flattening. Zero changes.

## Test state at review

- `npx jest options-replay` — 44/44 (4 new specs: converter 5, run-list 7,
  store 6, detail 4)
- `tsc --noEmit -p tsconfig.app.json` — clean for new files
- `ng build --configuration development` — bundle OK, dashboard lazy
  chunk compiled (template type-checks passed)
- No `src/` eslint config exists — FE verification is build + jest.
