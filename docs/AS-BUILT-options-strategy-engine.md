# As-Built: Options Position Strategy Engine

**Topic:** #108
**BE Blueprint:** #111 (RESOLVED)
**FE Blueprint:** #112 (RESOLVED)
**Status:** Complete
**Last Updated:** 2026-08-16

## Overview

A wheel-style options position strategy engine that runs nightly on Firebase, tracking short-put positions from open through expiration/assignment, computing equity curves and stats per instance and combined, and exposing a monitoring dashboard in the RH Agent feature area.

## What was built

### Backend (functions/src/options-strategy-engine/)

- **types.ts** — Core domain types: `Position`, `PositionStatus` (OPEN, EXPIRED_WORTHLESS, ASSIGNED_HOLDING_SHARES, COVERED_CALL_OPEN, CLOSED), `PositionLeg`, `PositionAssignment`, `PositionShares`, `StrategyStats`, `EquityCurvePoint`.
- **position-repository.ts** — Firestore repository for position documents. `listAllPositions` queries across instances with optional instance/status filters.
- **stats-repository.ts** — *(moved to `paper-trading/engine/`)* Write-side only since #1565: `statsDocRef`, `recomputeStats`, `defaultStatsDeps`, `legacyToPaperStats`. The legacy read surface (`defaultReadStatsDoc`, `getStats`, `getEquityCurve`) is retired — reads go through `paper-trading/repository.ts getStats(db, statsId)` / the `getPaperStats` callable.
- **stats-utils.ts** — Pure functions for max drawdown computation and stats aggregation from position lists.
- **strategy-query-service.ts** — *(moved to `paper-trading/engine/`)* `buildPositionsResponse` splits into open/closed arrays for `listStrategyPositions`. The stats/equity read surface moved to `getPaperStats` (#984).
- **options-strategy-callables.ts** — One HTTPS callable: `listStrategyPositions`. `getStrategyEquityCurve` retired in #1565 (replaced by `getPaperStats`, #984). CORS via dedicated `OPTIONS_STRATEGY_ALLOWED_ORIGINS` (decoupled from RH Agent origins).
- **options-strategy-cors.ts** — Dedicated CORS config for options strategy callables.
- **options-strategy-passes.ts** — Nightly pass orchestrator. Runs passes in order: open → mark → settlement → stats.
- **passes/open-pass.ts** — Detects new short-put opens from trade history, creates Position docs.
- **passes/mark-pass.ts** — Updates current value of open positions from live marks.
- **passes/settlement-pass.ts** — Handles expiration: worthless → EXPIRED_WORTHLESS, in-the-money → ASSIGNED_HOLDING_SHARES with share position.
- **passes/held-shares-pass.ts** — Daily mark for assigned share positions.
- **passes/stats-pass.ts** — *(deleted in #1565)* Replaced by the canonical `paper-trading/passes/paper-stats-pass.ts` — the sole stats writer, recomputing canonical `stats-{scope}` docs nightly.

### Frontend (src/app/features/rh-agent/)

- **services/options-strategy.types.ts** — FE-side types mirroring BE. `OptionsPositionStatus` (renamed to avoid collision with RS-trading `PositionStatus`). `OPTIONS_POSITION_STATUS_LABELS` for display.
- **services/options-strategy.service.ts** — Angular callable wrapper using `httpsCallable + runInInjectionContext`. Wraps `listStrategyPositions`; stats come from `paper-trading.service.ts getPaperStats$` (#1564).
- **stores/options-strategy-dashboard.store.ts** — NgRx SignalStore with `withState/withComputed/withMethods`. Race-condition-safe `selectInstance` (tracks and cancels in-flight subscriptions). Computed signals: `isLoading`, `isEmpty`, `openCount`, `closedCount`, `maxDrawdown`, `availableInstances`.
- **pages/options-strategy-dashboard/** — Standalone OnPush component with external template/styles. Open positions table (instance, symbol, strike, expiration, DTE, premium, current value, unrealized P&L). Closed positions table (instance, symbol, outcome, realized P&L, share position, unrealized P&L). Equity curve chart (Syncfusion EJ2). Dynamic scope toggle from `availableInstances`. Stats strip (open count, closed count, max drawdown). Accessibility: `aria-pressed`, `scope="col"`, `role="alert"`.

### Shared

- **constants.ts** — `LIST_STRATEGY_POSITIONS` and `GET_STRATEGY_EQUITY_CURVE` added to `CallableName` enum.
- **interfaces.ts** — `OPTIONS_STRATEGY_DASHBOARD` added to `AppRoutes` enum.
- **core-routes.ts** — Lazy-loaded route with `authGuard`.

## Architecture decisions

1. **Enum naming** — FE uses `OptionsPositionStatus` (not `PositionStatus`) to avoid collision with the existing RS-trading `PositionStatus` in `core/models/fe-position.types.ts`. Different domains, same name — explicit rename prevents confusion.

2. **CORS decoupling** — BE callables use `OPTIONS_STRATEGY_ALLOWED_ORIGINS` instead of reusing `RH_AGENT_ALLOWED_ORIGINS`. Prevents accidental coupling between feature areas.

3. **Race condition prevention** — Store tracks `positionsSub` and `equitySub` subscriptions, unsubscribing before starting new requests on scope change. Prevents stale state corruption from rapid toggle clicks.

4. **Dynamic instance toggle** — Scope toggle derives from `availableInstances` computed signal (unique instance IDs from loaded positions) rather than hardcoding instance names. Scales automatically as new strategy instances are added.

5. **External template/styles** — Component uses `templateUrl`/`styleUrl` with `ɵresolveComponentResources` in tests to resolve from disk. SCSS flattened to plain CSS to avoid jsdom parser warnings.

6. **Stats scope** — Stats are computed per-scope (ALL + per-instance) and stored as separate Firestore docs. Equity curve callable returns both points and stats in a single call to reduce round trips.

## Deviations from original design

- **Inline template → external** — Initially used inline template due to Jest limitations with `templateUrl`. Resolved by using `ɵresolveComponentResources` with a file reader in tests, allowing external template/styles as originally designed.
- **`realizedPnl` field** — Added to `Position` type during FE review to support the closed positions table's realized P&L column. Not in the original BE type but added as optional field with fallback to `premiumCollected`.

## Test coverage

- **BE:** 132 unit tests (functions suite) — all passing
- **FE:** 29 unit tests (4 service + 15 store + 10 component) — all passing
- **Build:** Angular CLI build succeeds, functions esbuild build succeeds

## Key files

| Layer | File | Purpose |
|---|---|---|
| BE types | `functions/src/options-strategy-engine/types.ts` | Domain types |
| BE callable | `functions/src/options-strategy-engine/options-strategy-callables.ts` | HTTPS callables |
| BE query | `functions/src/options-strategy-engine/strategy-query-service.ts` | Query orchestration |
| BE passes | `functions/src/options-strategy-engine/options-strategy-passes.ts` | Nightly pass orchestrator |
| FE types | `src/app/features/rh-agent/services/options-strategy.types.ts` | FE-side types |
| FE service | `src/app/features/rh-agent/services/options-strategy.service.ts` | Callable wrapper |
| FE store | `src/app/features/rh-agent/stores/options-strategy-dashboard.store.ts` | SignalStore |
| FE component | `src/app/features/rh-agent/pages/options-strategy-dashboard/options-strategy-dashboard.component.ts` | Dashboard UI |
