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

# Test Plan (BE) — OpsStrat Manage Page Overhaul

## Unit Tests

- Manage-instance reader: ACTIVE-only query, trigger partition, legacy-doc
  skip-with-warning
- Open pass: daily trigger opens every trading day (respects
  `maxOpenPositions`); signal trigger opens only on fresh symbol signal;
  non-ACTIVE skipped
- Leg resolution: variant Δ/DTE → contract per leg, multi-leg position doc
  with `legs[]`
- Contract-list writer: `{instanceId}` doc id (no `_SYM` append), one row
  per leg, ContractListRow fields
- Exit-scan pass: paper → all `EXIT_REGISTRY` entries; real → configured
  stop only; result doc shape `{instanceId}_{exitId}`; new registry entries
  picked up automatically
- Manual open callable (#157): single-instance open pass, idempotent on
  flat+ACTIVE, no-op on non-ACTIVE

## Integration Tests

- Emulator: seed instance + quote-provider mock → run open pass → assert
  position doc + contract-list doc written
- Exit-scan: seed position + mark series → assert per-exitId results docs
- Auth guards on new callables (pattern from #1447)

## Edge Cases

- No ACTIVE instances → pass no-ops cleanly
- Signal lookup returns nothing → signal-triggered instance stays flat,
  table reads as "waiting" not broken
- Position missing marks → exit-scan skips with log, not error write

## Test Seams

- Highest: emulator-run pass functions with seeded Firestore
- Lower: pure evaluator reuse (already covered upstream), reader mappers

## Existing Coverage

- `options-analysis` evaluators + registry specs — reused, not re-tested
- Engine pass specs (`open-pass`, `mark-pass`) — update for new instance
  shape
