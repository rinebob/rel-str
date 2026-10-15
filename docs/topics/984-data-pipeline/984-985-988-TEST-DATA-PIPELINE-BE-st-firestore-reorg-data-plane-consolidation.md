**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #988  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** TEST  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-10-14  
**Last Updated:** 2026-10-14  

# TEST — BE (functions)

## Unit test targets

- `SignalDateWriter` upsert: interim write creates doc; second run same occurrence appends `runIds` (no dupe); nightly upgrades INTERIM→CONFIRMED; `marketDate`/`sourceRunId` unchanged on upsert.
- Ticket writers: auto-paper emits `signal/auto:true/paper` ticket before ledger; open-pass emits `program/auto:true/{mode}`; paperSignalOrder emits staged tickets (not PENDING trades); management → `origin:management` + `positionGroupId`.
- State machine: `submitted→cancel_pending→cancelled`; fill racing cancel → filled wins.
- expression-fill: staged ticket → trade doc with correct `{SYM}-{date}-{origin}-{expr}-{exp}-{strike}-{NN}` + contract fields.
- jobs TTL: docs older than 7d deleted, newer preserved.
- NEW backfill: additive-only (existing memberships untouched).
- Migration scripts: 77 intents → tickets preserving `refId`/state/lineage; cohort→group `memberTradeIds` carried.

## Integration boundaries

- Emulator: full pipeline run — PDR sim → run → signals in `st-signals` + legacy (dual-write) → auto-paper ticket+trade → staged expression ticket → fill pass → minted trade.
- Callable contract tests: `paperSignalOrder` idempotency via `refId`.

## E2E journeys

1. Nightly run → `st-signals` populated; legacy `run-ids`+`signal-history` still written (soak).
2. Auto-paper: config-scoped signal → ticket → paper trade → group membership.
3. Live order (mocked MCP): staged→submitted→brokerOrderId stamped; fill observed→`fillSummary`; cancel→`cancel_pending`→`cancelled`.
4. Time-based: instance with `openTimePT` matching timer → program ticket → paper trade.
5. Cutover verify: counts legacy vs new collections equal; reads flip cleanly.

## Edge cases

- Re-run same day (manual + nightly) — runIds accumulate, no dupes.
- Symbol in multiple lists — first-list-wins `captureList` semantics preserved.
- Fill pass on ticket with no matching contract → `lastError`, ticket stays staged (not minted).
- Migration on partially-filled intent states (`queued`, `paper`) — state mapping correct.
- 1.24M jobs purge — batched deletes, no timeout.
