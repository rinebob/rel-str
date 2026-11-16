**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1554  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** IMPL  
**Area:** FE  
**Status:** Approved  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-16  

# IMPL — Stats Pipeline Consolidation: FE (options strategy dashboard)

## Overview

Migrate the strategy dashboard's stats card + equity curve from
`getStrategyEquityCurve` (deleted by the BE task — **hard dependency,
land together or BE first**) to the canonical `getPaperStats` callable,
and add the two-select scope UX: Population (All / Strategies /
Signals) + the existing instance select enabled under Strategies.

## Phase 1 — Service + store migration

1. `src/app/features/savant-trader/services/paper-trading.service.ts` —
   add `getPaperStats$` wrapper (`GET_PAPER_STATS` constant already
   exists in `constants.ts`; the `call` seam is the existing pattern).
   Request `{ scope? }`, response `{ stats: PaperStats[] }` (0 or 1
   docs for a scoped call).
2. `src/app/features/savant-trader/stores/options-strategy-dashboard.store.ts`:
   - State gains `selectedPopulation: 'ALL' | 'STRATEGY' | 'SIGNAL'`
     (default `'STRATEGY'` — preserves today's strategy-only combined
     view; `'ALL'` is the new honest everything option) alongside the
     existing `selectedInstanceId`.
   - Derived `statsScope()`: `inst-{id}` when an instance is selected,
     else `all` / `src-STRATEGY` / `src-SIGNAL` by population.
   - `loadCurve`-equivalent block calls
     `paperTradingService.getPaperStats$({ scope })` instead of
     `optionsStrategyService.getStrategyEquityCurve$({ instanceId })`;
     `response.stats[0]` supplies BOTH the stats fields and
     `equityCurve` (same doc — the old callable's two reads were the
     same doc too).
   - Field renames in store/component (`StrategyStats` → `PaperStats`):
     `openPositionCount`→`openTradeCount`,
     `closedPositionCount`→`closedTradeCount`, `lastUpdated`→`updatedAt`,
     `points`→`stats.equityCurve`. No shape adapter — bind PaperStats
     fields directly.
   - `selectPopulation(p)` patches state and triggers the same reload
     path `selectInstance` uses; `selectInstance` only affects the
     scope when population is `STRATEGY` (an instance implies strategy
     scope).
3. Delete `getStrategyEquityCurve$` from
   `services/options-strategy.service.ts` + `GET_STRATEGY_EQUITY_CURVE`
   from `constants.ts` (cross-area: the constant deletion pairs with
   the BE callable removal).

## Phase 2 — Selector UI

1. `options-strategy-dashboard.component.html` — header-actions gains a
   second `dse-select` matching the existing pattern:
   `Population: All | Strategies | Signals`. The existing "Strategy"
   instance select: when population ≠ `STRATEGY` it's disabled (its
   selection is retained, not cleared); label/option copy updated —
   "All Strategies (Combined)" stays under Strategies.
2. Honest UX note in the plan: the position tables below remain
   strategy-only (`listStrategyPositions` is unchanged) — the
   population select governs the stats card + equity curve only. No
   copy change needed if the selects sit in the stats header region;
   revisit if user testing finds it confusing.
3. Specs:
   - `options-strategy-dashboard.store.spec.ts` — population state,
     scope derivation per population+instance combo, `getPaperStats$`
     call shape, `stats[0]`-absent → empty-state mapping.
   - `options-strategy-dashboard.component.spec.ts` — population select
     renders + patches store; instance select disabled/enabled per
     population; stats card binds new field names.
   - Delete/update specs covering `getStrategyEquityCurve$`.

## Boundary + risks

- **BE dependency**: `getStrategyEquityCurve` is deleted by the BE
  blueprint — FE and BE land in the same deploy (or BE first, briefly
  breaking only the legacy surface nobody else calls). The new FE code
  depends on `stats-src-*` docs existing — first nightly pass after BE
  deploy populates them; until then the Strategies/Signals scopes show
  the empty state (acceptable on a prototype; alternatively run
  `runPaperStatsPass` manually post-deploy).
- **`listStats` ghost scopes** — unrelated to this dashboard but the
  paper dashboard's scope enumeration stops seeing `stats-ALL` /
  `stats-{id}` once the BE cleanup script runs.
