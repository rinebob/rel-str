**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1512  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# Test Plan (FE) — OpsStrat Manage Page Overhaul

## E2E User Journeys

- Nav → Manage loads `options/strategy/manage`; old build route 404s
- Create New Instance: pick variant → mode=paper → trigger=daily → 2
  symbols → two `…-ALL` rows appear on Paper tab
- Start a row → state flips UNSTARTED→ACTIVE; stop → STOPPED; start again
- Results popup shows stats + open position + sparkline for an instance
- Analysis link opens `/options/strategy/backtest/analysis/{id}` in a new
  tab
- Create New Strategy: pick template → fill leg Δ/DTE → name suggested →
  Export JSON dialog contains registry-shaped JSON → variant selectable
  in Create New Instance (session)

## Integration Tests

- Component + store: tab partition by mode; sort/filter state; position-
  status join renders from callable response
- Store + service: Firestore query scoping (userId), write paths for
  create/start/stop/delete

## Unit Tests

- Create-instance dialog: ID preview correctness, dedup check, real-mode
  stop-type required + `ALL` never offered, real create disabled v1
- Create-strategy dialog: per-leg inputs render from template shape, name
  suggestion, JSON export serialization matches registry schema
- Store computeds: paper/real partitions, sort/filter selectors

## Test Seams

- Highest: component specs with mock store/service (decorator mock
  components per AGENTS.md spec conventions; Firebase token stubs)
- Lower: pure form validators, ID-gen usage, variant-name builder

## Edge Cases

- Empty table states per tab; loading + error states
- Duplicate instance attempt (same variant+symbol+stop) → blocked
- ACTIVE-with-no-position renders as waiting, not broken
