# RH-AGENT-THERMO-2607-01 RH Agent Thermonuclear Review Remediation

- **Status**: planned
- **Planning doc(s)**: `.devin/skills/thermo-nuclear-code-review.md`
- **Area**: BE / FE
- **Scope**: MAINT
- **Code**: THERMO
- **Created**: 2026-07-03
- **Last updated**: 2026-07-03

## Intent

Perform a focused remediation of the RH Agent backend (`functions/src/rh-agent-cloud-function`) and frontend (`src/app/features/rh-agent`) based on the thermonuclear code review. The goals are:

- Fix concrete structural bugs and boundary/type-contract issues.
- Remove dead code and obsolete abstractions.
- Simplify the worker, the frontend service, and the chart detail component before they grow past maintainable size.
- Share canonical contracts across the boundary so the frontend and backend do not drift.
- Improve security and correctness of callable endpoints.

This plan is **analysis and remediation design**; implementation is tracked in the tasks below.

## Scope

### In scope

- `functions/src/rh-agent-cloud-function/*.ts`
- `functions/src/rh-agent-cloud-function/strategies/*.ts`
- `src/app/features/rh-agent/services/*.ts`
- `src/app/features/rh-agent/stores/*.ts`
- `src/app/features/rh-agent/components/signal-detail/*.ts`
- `src/app/features/rh-agent/common/*.ts`
- `src/app/features/rh-agent/utils/*.ts`

### Out of scope

- Chart rendering upgrades (e.g., ST-Zone colored step/dots, ST-Trend-Strength histogram bars) — those are visual/UX tasks, not structural remediation.
- Adding new strategies or signal types beyond the counter-trend consistency fix.
- Large cross-project Cloud Functions reorganization outside the RH Agent directories.

## Guiding principles

1. **Structural first**: fix bugs and type-contract issues before cosmetic cleanup.
2. **Delete before adding**: remove dead code and unused abstractions before introducing new modules.
3. **Single source of truth**: canonical types, constants, and helpers should exist once.
4. **File size guard**: keep files under 400 lines of real responsibility; nothing should approach 1k lines without a documented reason.
5. **No code changes in this doc**: this is the roadmap; implementation is in the linked tasks.

## Phase 1 — Fix concrete bugs and security issues

These are blockers and should be done first. Each task should be a separate, small PR or commit.

### RH-AGENT-THERMO-2607-01-T01 — Fix `computeSymbolIndicatorSeries` response shape

**Problem**: `computeSymbolIndicatorSeries` returns the same `indicators.daily` array for every indicator family (`zoneV1`, `zoneV2`, `trendStrength`, `trendBands`).

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-indicator-computation.ts`

**Remediation**:

- Split the monolithic `IndicatorDataPoint` into per-family result arrays:
  - `ZoneV1Point`/`ZoneV2Point`: `{ d: string; zone: number | null }`
  - `TrendStrengthPoint`: `{ d: string; diPlus: number | null; diMinus: number | null; diHist: number | null; adx: number | null }`
  - `TrendBandsPoint`: `{ d: string; bands: BandPoint[] }`
- Update `computeSymbolIndicatorSeries` to populate each family with its own array.
- Update the frontend mirror types in `src/app/features/rh-agent/common/rh-agent-indicator.types.ts` to match the new contract.
- Update `injectCallableIndicatorData` and `convertIntervalIndicators` in `src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts` to use the new shapes.
- Add a backend unit test that asserts each family has a distinct array and the correct element types.

**Acceptance**:

- `trendBands` returns `TrendBandsPoint[]`, not `IndicatorDataPoint[]`.
- `zoneV1` and `zoneV2` arrays are distinct and contain only the fields they need.
- Frontend chart indicator injection still works.

### RH-AGENT-THERMO-2607-01-T02 — Remove unused counter-trend signal enum values

**Problem**: `rh-agent-config.ts` defines `D_ST_TREND_RIDER_V1_CT_LONG` etc., but `signal-detection.ts` never emits them. The old `st-zone-uptick` naming scheme (e.g., `D_ZONE_V1_CT_UPTICK`) is retired.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-config.ts` and `strategies/signal-detection.ts`

**Decision**: Counter-trend signals will be added in the future, but the current enum values are premature and the final naming will likely differ. Remove the unused CT enum values now; reintroduce counter-trend signals with a clean design when the work is actually prioritized.

**Remediation**:

- Remove the `*_CT_LONG` enum values from `rh-agent-config.ts`.
- Remove any references to those values from `signal-detection.ts`, `rh-agent-indicator-computation.ts`, and the strategy README.
- Add a short comment in `signal-detection.ts` documenting that the current strategy emits only with-trend signals.

**Acceptance**:

- No counter-trend enum values exist in the codebase.
- `signal-detection.ts` only emits with-trend `LONG`/`SHORT` signals.
- No dead references remain.

### RH-AGENT-THERMO-2607-01-T03 — Secure admin/dashboard callables

**Problem**: `rh-agent-overview-sync-orchestrator.ts` and `rh-agent-dashboard-callables.ts` use `invoker: 'public'`.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-overview-sync-orchestrator.ts` and `rh-agent-dashboard-callables.ts`

**Context**: Project planning docs (`docs/planning/rh-agent/RH-AGENT-REFACTOR-PLAN.md`) note that `invoker: 'public'` was intentionally kept because Firebase Auth / App Check was not working reliably. This is a documented risk, not an accidental oversight.

> **Note**: The Auth / App Check reliability fix is a separate, larger infrastructure issue that is intentionally out of scope for this remediation plan. T03 should not be started until that work is complete and verified.

**Remediation**:

- Resolve the Auth / App Check reliability issue first.
- Migrate all RH Agent callables to auth enforcement in one coordinated pass, rather than piecemeal.
- If a public health/status endpoint is required, create a dedicated read-only function with no admin side effects and a strict CORS allowlist.
- Keep the current public invoker in place until the coordinated migration is ready.

**Acceptance**:

- No public invokers remain on functions that expose data or enqueue side effects.
- Migration is done as a single pass, not ad-hoc.

### RH-AGENT-THERMO-2607-01-T04 — Remove abandoned signal-dates and dead intraday code

**Problem**: `writeIntradayBarsToRsBars` is no longer called. `clearStaleInterimSignals` is a no-op. The `signal-dates` subcollection is intentionally abandoned.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-shared.ts`, `rh-agent-signal-date-writer.ts`, `rh-agent-worker.ts`, `rh-agent-config.ts`, and `README.md`

**Decision**: The `signal-dates` path is permanently abandoned. All related code, constants, types, and documentation references must be removed.

**Remediation**:

- Delete `writeIntradayBarsToRsBars` and any associated helpers.
- Delete `clearStaleInterimSignals` and its `INTERIM` signal logic.
- Remove the `signal-dates` clearing calls from `rh-agent-worker.ts`.
- Remove `RH_AGENT_SIGNAL_DATES_SUBCOLLECTION` and `RhAgentSignalDateDoc` from `rh-agent-config.ts`.
- Remove references to `signal-dates` from `README.md` and the worker comment.
- If the trigger flow diagram is still useful, update it to reflect the current trigger → worker path.

**Acceptance**:

- No references to `signal-dates` in code or docs.
- `npm run build` in `functions/` passes.
- No unused imports remain.

## Phase 2 — Share boundary contracts

### RH-AGENT-THERMO-2607-01-T05 — Create a single canonical `OhlcBar` type

**Problem**: `OhlcBar` is defined in `rs-bars-sync.ts`, `rh-agent-indicator-computation.ts`, and `rh-agent-chart.service.ts`.

**Location**: `functions/src/rs-bars/rs-bars-sync.ts`, `functions/src/rh-agent-cloud-function/rh-agent-indicator-computation.ts`, `src/app/features/rh-agent/services/rh-agent-chart.service.ts`

**Remediation**:

- Move the canonical `OhlcBar` interface to a side-effect-free location such as `functions/src/rh-agent-cloud-function/rh-agent-types.ts`.
- Import it from `rs-bars-sync.ts`, `rh-agent-indicator-computation.ts`, and any scripts/backfill code.
- Remove the frontend duplicate if it can be replaced by a generated or shared contract; otherwise, document why the frontend must mirror it.

**Acceptance**:

- Exactly one backend definition of `OhlcBar`.
- All consumers import from the canonical location.

### RH-AGENT-THERMO-2607-01-T06 — Centralize RH Agent CORS allowlists

**Problem**: `ALLOWED_ORIGINS` is duplicated in `rh-agent-callables.ts` and `rh-agent-indicator-series.ts`. `rh-agent-executor.ts` has a separate inline CORS list, and `rhGetAccountSummary` uses `cors: true` (open). The allowlists are inconsistent across functions.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-callables.ts`, `rh-agent-executor.ts`, `rh-agent-indicator-series.ts`

**Remediation**:

- Create `functions/src/rh-agent-cloud-function/rh-agent-cors.ts` exporting a single `RH_AGENT_ALLOWED_ORIGINS` array.
- Replace all local copies with an import.
- Change `rhGetAccountSummary` from `cors: true` to the same restricted allowlist.
- Consider moving the list to environment configuration for production flexibility.

**Acceptance**:

- One source of truth for the CORS allowlist.
- No `cors: true` on RH Agent callables.

### RH-AGENT-THERMO-2607-01-T07 — Remove index signature from `OHLCV`

**Problem**: `base-strategy.ts` declares `[key: string]: any` on the `OHLCV` interface.

**Location**: `functions/src/rh-agent-cloud-function/strategies/base-strategy.ts`

**Remediation**:

- Remove the index signature.
- Add explicit fields if needed, or use a generic `Record<string, unknown>` extension for optional metadata.
- Ensure `st-trend-rider.strategy.ts` and the worker pass data that matches the strict interface.

**Acceptance**:

- `OHLCV` has no `any` index signature.
- Strategy implementations compile without broadening the type.

## Phase 3 — Decompose the backend worker

### RH-AGENT-THERMO-2607-01-T08 — Split `rh-agent-worker.ts` into focused modules

**Problem**: `rh-agent-worker.ts` (555 lines) mixes orchestration, data loading, freshness, persistence, counters, and completion.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-worker.ts`

**Remediation**:

- Extract `SymbolDataLoader` (or `loadSymbolBars`) that owns:
  - Reading `rs-bars/{symbol}`.
  - Injecting intraday partial bars.
  - Returning typed arrays and a `sufficient` flag.
- Extract `SignalPersister` that owns:
  - Writing the run-ids entry.
  - Writing the signal-history entry.
  - Updating the symbol doc gate fields.
  - All writes happen in a single Firestore batch.
- Extract `RunProgressTracker` that owns:
  - Incrementing success/error counters.
  - Marking job completion.
- Keep `rhAgentProcessSymbol` as a thin orchestrator that calls the three helpers.

**Acceptance**:

- `rh-agent-worker.ts` is under 250 lines.
- Each helper is independently testable.
- Existing behavior is preserved.

### RH-AGENT-THERMO-2607-01-T09 — Unify the enqueue path

**Problem**: The trigger and the manual callable both have nearly identical loops to enqueue symbol jobs.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` and `rh-agent-callables.ts`

**Remediation**:

- Extract `enqueueSymbolJobs(runId, symbols, intradayBySymbol, triggeredBy)` into `rh-agent-shared.ts`.
- Replace both loops with the helper.
- The helper should log origin and symbol count.

**Acceptance**:

- No duplicated enqueue logic.
- Trigger and manual callable still produce identical job payloads.

## Phase 4 — Decompose the frontend

### RH-AGENT-THERMO-2607-01-T10 — Split `RhAgentService` into focused services

**Problem**: `RhAgentService` (455 lines) handles runs, status, symbols, signals, intraday, charts, and backfill.

**Location**: `src/app/features/rh-agent/services/rh-agent.service.ts`

**Remediation**:

- Create:
  - `RhAgentRunService` — manual run, status, run history.
  - `RhAgentSignalService` — symbol profiles, signal history, signal queries.
  - `RhAgentChartService` — already exists; keep and extend if needed.
  - `RhAgentOverviewService` — company overview sync.
- Leave `RhAgentService` as a thin facade or remove it after updating consumers.

**Acceptance**:

- Each service is under 250 lines.
- Existing stores inject the new services without behavior change.

### RH-AGENT-THERMO-2607-01-T11 — Simplify `RhAgentGroupStore.groups`

**Problem**: The `groups` computed reads four other stores and performs filtering, grouping, history merge, and triage merge.

**Location**: `src/app/features/rh-agent/stores/rh-agent-group.store.ts`

**Remediation**:

- Split into layered computeds:
  - `filteredSymbols` — apply signal/list/status filters.
  - `groupedRows` — group by the active dimension.
  - `rowsWithSignals` — merge history and triage into the row shape.
- Avoid nested object re-creation in the hot path.

**Acceptance**:

- `groups` is composed from smaller, named computeds.
- Each computed is independently testable.

### RH-AGENT-THERMO-2607-01-T12 — Extract chart state from `SignalDetailComponent`

**Problem**: `SignalDetailComponent` (438 lines) mixes layout, data loading, chart configuration, and indicator injection.

**Location**: `src/app/features/rh-agent/components/signal-detail/signal-detail.component.ts`

**Remediation**:

- Create a `SignalDetailChartState` signal-store or injectable state class that owns:
  - Loading bars for the symbol.
  - Loading callable indicator series.
  - Building base indicator configs.
  - Injecting zone dots, signal dots, and trend-rider dots.
  - Range selection state.
- The component should bind to the state and own only template logic.

**Acceptance**:

- `SignalDetailComponent` is under 200 lines.
- Chart state is testable in isolation.

### RH-AGENT-THERMO-2607-01-T13 — Centralize frontend Firestore auth helpers

**Problem**: `withUserId`, `chunkArray`, and `getDocData` are duplicated across triage, symbol-list, and symbol-meta services.

**Location**: `src/app/features/rh-agent/services/rh-agent-triage.service.ts`, `rh-agent-symbol-list.service.ts`, `rh-agent-symbol-meta.service.ts`

**Remediation**:

- Create `src/app/features/rh-agent/services/rh-agent-firestore-helpers.ts` with:
  - `requireUserId(auth)` — throws if no user.
  - `chunkArray<T>(arr, size)` — Firestore `in` chunking.
  - `getDocData<T>(docRef)` — typed snapshot helper.
- Replace duplicates with imports.

**Acceptance**:

- No duplicated helper functions in the three services.

## Phase 5 — Type and contract cleanup

### RH-AGENT-THERMO-2607-01-T14 — Split `rh-agent-config.ts` into focused contract files

**Problem**: `rh-agent-config.ts` (302 lines) is a god file holding collections, enums, all types, and payloads.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-config.ts`

**Remediation**:

- Create:
  - `rh-agent-collections.ts` — collection names and document ID patterns.
  - `rh-agent-signals.ts` — signal types, directions, and signal payloads.
  - `rh-agent-status.ts` — run/job status enums and status doc shape.
  - `rh-agent-types.ts` — symbol, run, job, and profile interfaces.
- Re-export from `rh-agent-config.ts` for backwards compatibility during migration, then update consumers gradually.

**Acceptance**:

- New files are under 200 lines each.
- `rh-agent-config.ts` becomes a barrel or is removed.

### RH-AGENT-THERMO-2607-01-T15 — Fix `SignalDateWriter` atomicity

**Problem**: `persistBarDate` writes run-ids, signal-history, and symbol doc updates in parallel.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-signal-date-writer.ts`

**Remediation**:

- Wrap the three writes in a single Firestore `batch()` or `runTransaction()`.
- If cross-collection transactions are needed, use a transaction.
- Ensure failures surface as a single error.

**Acceptance**:

- All signal writes for a bar date are atomic.

### RH-AGENT-THERMO-2607-01-T16 — Fix `RhAgentSymbolListService` document ID collision (deferred)

**Problem**: `listId` ignores `userId`, so all users share the same list document IDs.

**Location**: `src/app/features/rh-agent/services/rh-agent-symbol-list.service.ts`

**Context**: You are the only user for the foreseeable future, so this collision is not an immediate issue.

**Remediation**:

- Defer until multi-user support is prioritized.
- When that time comes, change `listId(userId, name)` to return `${userId}_${name}` or a deterministic hash.
- Plan a migration to rename old global documents to per-user IDs.

**Acceptance**:

- Two users can have a list with the same name without collision.

## Phase 6 — Executor and strategy cleanup

### RH-AGENT-THERMO-2607-01-T17 — Remove hardcoded defaults from `rh-agent-executor.ts`

**Problem**: The executor declares secrets but falls back to a live production MCP URL (`https://agent.robinhood.com/mcp/trading`) and a hardcoded account number (`'6245'`).

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-executor.ts`

**Remediation**:

- Remove the default URL for `MCP_SERVER_URL`.
- Remove the default account number fallback.
- Fail fast if either secret is not configured.
- Update local emulator docs to require both secrets.

**Acceptance**:

- No live-production URL or account number defaults in the source.
- Executor fails at startup if secrets are missing.

### RH-AGENT-THERMO-2607-01-T18 — Wire `strategyRegistry.validateConfig` into the worker

**Problem**: `StrategyRegistry` has a `validateConfig` method, but the worker does not call it.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-worker.ts`, `strategies/strategy-registry.ts`

**Remediation**:

- Call `validateConfig(strategyId, strategyConfig)` before `execute`.
- Return a clear error in the job result if validation fails.
- If validation is not needed, remove the unused method.

**Acceptance**:

- Config validation is either used or removed.

### RH-AGENT-THERMO-2607-01-T19 — Stop returning null from `getCachedBars`

**Problem**: `getCachedBars` returns `null` per bar array, forcing callers to null-check.

**Location**: `functions/src/rh-agent-cloud-function/rh-agent-worker.ts`

**Remediation**:

- Return empty arrays with a `sufficient: boolean` flag.
- Update the worker and `st-trend-rider.strategy.ts` to use the new shape.

**Acceptance**:

- No null checks for bar arrays.

## Phase 7 — Verification and documentation

### RH-AGENT-THERMO-2607-01-T20 — Add regression tests for the bugs above

- Backend unit tests for `computeSymbolIndicatorSeries` response shape.
- Backend unit tests asserting no unused counter-trend enum values remain and the strategy emits only with-trend signals.
- Backend unit tests for `SignalDateWriter` atomicity.
- Frontend unit tests for `RhAgentGroupStore.groups` decomposition.
- Frontend unit tests for `SignalDetailChartState`.

### RH-AGENT-THERMO-2607-01-T21 — Update README

- Remove the `writeIntradayBarsToRsBars` step and `signal-dates` references.
- Document the canonical `OhlcBar` contract.
- Document the security model for public vs authenticated functions.

### RH-AGENT-THERMO-2607-01-T22 — Run full verification

- `npm run build` in `functions/`
- `ng build --configuration development`
- `npm run test` (or `ng test`) for affected frontend units
- `npm run test` for backend functions if available
- Deploy to staging and run a manual RH Agent end-to-end test

## Phase 8 — Architecture evaluations

### RH-AGENT-THERMO-2607-01-T23 — Evaluate run-ids storage model

**Question**: Should the `run-ids` subcollection under each symbol have a TTL, or be replaced by a single `latest-signals` doc?

**Context**: `run-ids` stores every run's signals per symbol. For grouped review, only the latest signals matter. Older docs may accumulate indefinitely.

**Remediation**:

- Analyze query patterns for the grouped review page.
- Evaluate cost and complexity of a single `latest-signals` doc vs. TTL on `run-ids`.
- If a single doc is chosen, design the update and migration path.

**Acceptance**:

- Documented decision and next-step task for the chosen model.

### RH-AGENT-THERMO-2607-01-T24 — Evaluate exclusive use of backend indicator callable

**Question**: Should the frontend stop computing ST indicators inline and consume `rhAgentGetSymbolIndicatorSeries` exclusively?

**Context**: The frontend currently has inline calculators (`st-zone.indicator.ts`, `st-trend-strength.indicator.ts`, etc.) that duplicate backend math. The backend callable now provides pre-computed series.

**Remediation**:

- Measure latency and cost of the callable vs. inline calculation.
- Identify any UI paths that depend on real-time recomputation not available in the callable.
- If feasible, remove inline calculators and use the callable as the single source of truth.

**Acceptance**:

- Documented decision. If adopted, remove or deprecate the inline calculators.

### RH-AGENT-THERMO-2607-01-T25 — Evaluate shared types package

**Question**: Should the frontend and backend share a generated or monorepo types package instead of mirroring types?

**Context**: Types like `OhlcBar`, `ChartInterval`, `IndicatorFamily`, and `SymbolIndicatorSeriesResponse` are duplicated. The frontend comment explicitly says the duplication is intentional to avoid build issues.

**Remediation**:

- Evaluate Firebase Functions + Angular monorepo tooling for a shared `types/` package.
- If a package is too heavy, evaluate generated OpenAPI/JSON-schema types or a simple pre-build copy step.
- Document the chosen approach and migration plan.

**Acceptance**:

- Documented decision and a path to eliminating the frontend mirrors.

## Task order summary

1. ✅ T01 — Fix indicator response shape
2. ✅ T02 — Remove unused counter-trend signal enum values
3. T03 — Secure callables (blocked on Auth / App Check reliability)
4. ✅ T04 — Remove abandoned signal-dates and dead intraday code
5. ✅ T05 — Canonical `OhlcBar`
6. ✅ T06 — Centralize CORS
7. ✅ T07 — Strict `OHLCV`
8. ✅ T08 — Decompose worker
9. T09 — Unify enqueue path
10. T10 — Split frontend service
11. T11 — Simplify group store
12. T12 — Extract chart state
13. T13 — Centralize Firestore helpers
14. T14 — Split config file
15. T15 — Atomic signal writes
16. T16 — Fix list doc ID collision (deferred)
17. T17 — Remove executor hardcoded defaults
18. T18 — Use or remove validateConfig
19. T19 — Non-null bar arrays
20. T20 — Regression tests
21. T21 — README update
22. T22 — Full verification
23. T23 — Evaluate run-ids storage model
24. T24 — Evaluate exclusive use of backend indicator callable
25. T25 — Evaluate shared types package

## Risks and notes

- **Counter-trend signal removal**: T02 only removes unused enum values; it does not change emitted signals. Reintroducing counter-trend signals will be a separate, future effort.
- **Public invoker changes**: Switching from `public` to auth-enforced may break unauthenticated health checks or dashboard widgets. Audit those callers before T03.
- **List document ID change**: T16 changes Firestore document IDs. Plan a migration or data rename.
- **Atomic writes**: T15 may require transaction limits if signal batches grow large. Consider chunking by symbol if needed.
- **No HTF multiplier change**: Per project memory, the HTF multiplier stays hardcoded at 3. Do not make it configurable.
