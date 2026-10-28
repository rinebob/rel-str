**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Domain:** BACKTEST  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-25  
**Last Updated:** 2026-10-26  

# Implementation Plan — BE: Selection Replay

## Architecture Overview

Two new Cloud Functions mirroring the `stBacktestStart` / `stBacktestPermutation` shape: a callable that validates + creates the run doc + fans out one task per symbol, and a task handler that fetches the SA pick doc, maps it to contract-list rows against the local trading-day calendar, and persists the list doc. The pick-doc fetch goes through a new partner proxy callable — the endpoint contract is SA-side and pinned as a seam behind one task.

```mermaid
flowchart LR
    UI[FE run dialog] --> C1[optionsReplayStart callable<br/>validate → run doc → enqueue tasks]
    C1 --> RUN[(st-options-replay-runs/{runId})]
    C1 -->|1 task per symbol| T[optionsReplayPermutation<br/>task handler]
    T -->|ID-token fetch| SA[SA pick-doc endpoint<br/>via partner proxy]
    SA -->|PickDocument| M[mapPickDocToRows<br/>pure mapper]
    BARS[(symbol-data daily bars<br/>trading-day calendar)] --> M
    M --> LIST[(st-options-contract-lists/{runId}_{symbol})]
    T -->|progress| RUN
    T -->|status| LIST
    FE2[FE table + chart] --> C2[getHistoricalOptionsContract$<br/>existing — unchanged]
```

## Modules

### 1. `optionsReplayStart` callable (`functions/src/options-replay/start.ts`, new)

Mirrors `stBacktestStart`'s create+enqueue skeleton:

- Validate request: `templateId` resolves via `getReplayTemplate` (400 `invalid-argument` on miss), `symbols` non-empty + uppercased, `startDate` ISO-8601.
- Create `st-options-replay-runs/{runId}` — status `pending`, `totalLists = symbols.length`, zeroed counters.
- Enqueue one Cloud Task per symbol with `OptionsReplayPermutationPayload`; set run status `running`.
- Return `{ runId }`.
- **Idempotency:** a rerun is always a fresh `runId` — no dedupe (mirrors today's backtest semantics).
- **As-built (#1281):** all effects sit behind `ReplayStartDeps` (createRun / markRunStatus / enqueue) so `startReplay` is unit-tested with fakes; the `onCall` wrapper injects production wiring. Three refinements vs the sketch: `running` is marked **before** fanout (a blind write after enqueue could regress a fast worker's `completed`), symbols are deduped (a duplicate would make two tasks race the same `{runId}_{symbol}` list doc and corrupt counters), and an enqueue failure marks the run `failed` + throws `internal` — a partial fanout can never reach `totalLists`, so failing fast beats a run stuck in `running`. `OPTIONS_REPLAY_TASK_QUEUE` is exported here as the contract for module 2.

### 2. `optionsReplayPermutation` task handler (`functions/src/options-replay/permutation.ts`, new)

Per-symbol pipeline:

1. Create/reset list doc `{runId}_{symbol}` → status `running`.
2. Fetch the `PickDocument`(s) from SA via the new partner proxy (module 3) — one year-sharded call per calendar year covering `[startDate, latestBar]` (SA serves a year per call; `startDate` filters `days`, it is not a request param).
3. Load the symbol's trading-day calendar: `getCachedBarsFromSymbolData(symbol)` — same `data-loader` path the analysis replay already uses. Window = trading days `>= startDate` up to the latest available bar (the PRD's "latest available data day").
4. `rows = mapPickDocToRows(doc, tradingDays, template.side)` — module 4.
5. Write list doc: rows + `pickDocMeta` (coordinate, gridVersion, pick/miss counts, first/lastDate) + status `success` + `generatedAt`.
6. Increment run doc counters (`completedLists` or `failedLists`); when `totalLists` reached → run status `completed` (or `failed` if all failed; partial success still `completed` with nonzero `failedLists`).

**Error semantics** (PRD): missing pick doc for the coordinate → list doc status `failed`, error names the coordinate; run keeps going for other symbols. Task retry semantics mirror `stBacktestPermutation` — a transient failure may retry; a completed list doc on retry is skipped (idempotent by `status === 'success'` check).

### 3. SA pick-doc proxy client (`functions/src/options-replay/pick-doc-client.ts`, new)

- Thin wrapper on the existing `partner-proxy` ID-token machinery (same auth path as `partnerHistoricalOptions*` — HTTPS GET + `Authorization: Bearer <ID token>`).
- **Confirmed contract (spike #1278, 2026-10-26):** SA stores year-sharded cell docs at `options-delta-picks/{SYM}-{type}-{deltaPct}-{dte}/years/{YYYY}`; the doc shape `CellYearDoc` in `av-proxy-api/shared/options/options-delta-picks.types.ts` is the authoritative storage **and** wire contract (SPEC 213-215 declares it so). The endpoint serves one year shard per call — request params `(symbol, type, delta, dte, year)`, params validated against `PICK_GRID`, off-grid → `400` naming the bad component. Auth follows existing partner-endpoint conventions (av-proxy-api task #225).
- **Open seam:** the endpoint itself is not yet implemented on the SA side (av-proxy-api #225, blocked by #223 materialization). Exact function name, delta-param spelling, and response envelope are provisional — the client (`pick-doc-client.ts`, as-built #1279) holds them as single-point constants (`PICK_DOC_ENDPOINT_PATH`, `deltaPct` param, raw-doc parse) behind the injectable `PickDocTransport` seam (TEST-BE seam #1).
- **Request shape consequence:** `startDate` is not a fetch parameter — the endpoint returns a full year shard; the caller filters `days` client-side. A run spanning a year boundary needs one fetch per year, merged before mapping.
- **Miss entries:** the `days` map contains explicit miss entries (`status: 'no_chain' | 'no_match'`), not just picks — reconciled into `PickDocDayEntry` on the shared contract; `isPickDocPick` mirrors SA's `isPickEntry` narrowing.
- **Grid reality:** `PICK_GRID` = 19 delta magnitudes (5–95 in steps of 5) × 10 DTEs (7,14,21,30,45,60,90,120,180,365) × 2 types. The grid is keyed on **deltaPct magnitude** — the client derives it from the signed `targetDelta` via `abs(targetDelta) × 100` (e.g. -0.20 → `20`). Both seed coordinates are on-grid (20Δ@45DTE, 30Δ@30DTE). SA-side codec + path builders exist (`buildCellId`, `parseCellId`, `cellYearDocPath` in `options-delta-picks.utils.ts`) if the endpoint takes a cellId rather than raw params — TBD at #225.

### 4. Row mapper (`functions/src/options-replay/pick-doc-mapper.ts`, new — pure)

```typescript
mapPickDocToRows(
  doc: PickDocument,
  tradingDays: string[],       // sorted ISO dates from symbol-data
  side: TradeSide,
): ContractListRow[]
```

- For each trading day: `doc.days[date]` entry passing `isPickDocPick` → `kind:'pick'` row (all day fields + `side`); miss entry (`status` present) → `kind:'no-selection'` with reason mapped (`no_match`→`'miss'`, `no_chain`→`'gap'`); absent key → `kind:'no-selection'`.
- `repeatsPrevious`: set when the prior `pick` row shares `contractId` (resets across no-selection gaps).
- Pure function — fully unit-testable with fixture docs + a synthetic calendar (TEST-BE seam #2). No Firestore, no network.

### 5. Registration

- `functions/src/index.ts`: export `optionsReplayStart` (done in #1281) + `optionsReplayPermutation` (#1280) with the same queue/timeout config pattern as the backtest permutation task.

## Seams / Testability

- Pick-doc fetch behind `pick-doc-client.ts` — injectable fixture for tests; real SA wire isolated in one file.
- `symbol-data` bar reads behind `data-loader` — fixture bars in unit tests.
- Firestore writes behind the existing Firestore test harness pattern used by other task tests.
- No scheduler, no queue wiring changes beyond registering the new task — each `onTaskDispatched` function is its own Cloud Tasks queue (queue name = function name), so `optionsReplayPermutation` gets a dedicated queue (`OPTIONS_REPLAY_TASK_QUEUE` in `start.ts`), not a shared one with `stBacktestPermutation`.

## Out of scope (re-stated)

- No exit rules, no P&L, no equity curve, no portfolio sim.
- No contract-series fetch in the worker — that's per-row, client-side, via the existing `getHistoricalOptionsContract$`.
- No multi-leg handling — `templateId` resolution is single-coordinate this thread.
