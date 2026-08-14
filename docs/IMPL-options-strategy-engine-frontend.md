**Topic:** Options Position Strategy Engine  
**Issue:** #108  
**Domain:** OPTIONS  
**Area:** FE  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-08-13

# Implementation Plan: Options Position Strategy Engine (FE)

## Placement

Kept under the existing RH Agent feature area (per user decision — this engine is conceptually still part of RH Agent, despite its separate backend architecture):

```
src/app/features/rh-agent/pages/options-strategy-dashboard/
  options-strategy-dashboard.component.ts/.html/.scss
  options-strategy-dashboard.store.ts       # signal-based store, following existing RH Agent store patterns
options-strategy.service.ts                 # Angular wrapper around the callables below (location TBD — likely
                                             # alongside other rh-agent services)
```

New route: `AppRoutes.OPTIONS_STRATEGY_DASHBOARD`, registered in `@c:\aa\projects\rel-str\src\app\core\core-routes.ts:135-144` alongside `OPTION_CHART`/`SPREAD_CHART`, guarded by `authGuard`.

## Backend Interface

New `onCall` callables (BE, `functions/src/options-strategy.callables.ts`) the FE consumes:

- `listStrategyPositions({ instanceId?, status? })` → open + closed positions for the dashboard tables.
- `getStrategyEquityCurve({ instanceId? })` → per-symbol daily cumulative P&L series + max drawdown; omitting `instanceId` returns the combined all-strategies series.

## Dashboard Components

- **Open positions table**: instance, symbol, strike, expiration, DTE remaining, premium collected, current value, unrealized P&L.
- **Closed/assigned positions table**: outcome (expired worthless / assigned), realized P&L, resulting share position (if assigned) with its own live unrealized P&L.
- **Equity curve chart**: toggle between per-symbol and combined view; renders cumulative P&L over time with a max-drawdown annotation/figure — reuses the charting setup from `@c:\aa\projects\rel-str\src\app\features\rh-agent\pages\option-chart\option-chart.component.ts` (same charting library/pattern already used for options-related data in RH Agent).
- **Max drawdown stat**: prominent numeric display alongside the chart, matching the TradeStation-Style Report's existing drawdown presentation convention where applicable.

## State Management

Signal-based store (`OptionsStrategyDashboardStore`) holding: selected instance filter, positions list, equity curve series, loading/error state — following the pattern of existing RH Agent dashboard stores.

## Key Risks

- Equity curve and max-drawdown are computed BE-side (`options-strategy-stats` collection, per the BE implementation plan) and simply rendered here — FE does no P&L math, only display. This is a settled decision, not an open risk, but worth restating: FE must not recompute or duplicate these figures locally.

## Out of Scope (FE, this phase)

- Any UI for creating/editing strategy instance configs (instances are seeded directly in Firestore/code for phase 1 — no admin UI yet).
- Exit-criteria configuration UI.
- Covered-call / Wheel UI.
