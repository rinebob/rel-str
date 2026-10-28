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
**Last Updated:** 2026-10-23  

# TEST — BE (functions)

## Unit test targets

- `SignalDateWriter` upsert: interim write creates doc; second run same occurrence appends `runIds` (no dupe); nightly upgrades INTERIM→CONFIRMED; `marketDate`/`sourceRunId` unchanged on upsert.
- Ticket writers: auto-paper emits `signal/auto:true/paper` ticket before ledger; open-pass emits `program/auto:true/{mode}`; paperSignalOrder emits staged tickets (not PENDING trades); management → `origin:management` + `positionGroupId`.
- State machine: `submitted→cancel_pending→cancelled`; fill racing cancel → filled wins.
- expression-fill: staged ticket → trade doc with correct `{SYM}-{date}-{origin}-{expr}-{exp}-{strike}-{NN}` + contract fields.
- jobs TTL: docs older than 7d deleted, newer preserved.
- NEW backfill: additive-only (existing memberships untouched).
- Migration scripts: 77 intents → tickets preserving `refId`/state/lineage; cohort→group `memberTradeIds` carried.
- Legacy-roots retirement (#1013): `tests/functions/legacy-roots-cleanup-1013.test.ts` —
  source-scan pin asserting every retired collection literal + mirror/trigger identifier
  is absent from `functions/src` (a stray reference fails the suite, not the delete
  script), plus the mirror/sweeper file deletions. Parity gate: `scripts/verify/
  data-pipeline-legacy-roots-1013.ts` FAILs if any legacy doc id/refId lacks canonical
  coverage — archive+delete must not run against a FAIL.
- st-runs/st-symbols cutover (#1159): `signal-date-writer.test.ts` pins the
  split — gate fields → `st-symbols`, run-ids/signal-history stay on the legacy
  parent; `run-jobs-ttl-1010.test.ts` pins `ST_RUN_JOB_ROOTS == ['st-runs']`;
  `legacy-roots-cleanup-1013.test.ts` adds the `'savant-trader/data/runs'`
  literal needle; FE `st-path-cutover-1014.spec.ts` pins `Collection.ST_RUNS`
  removed + `ST_SYMBOLS` still legacy-bound;
  `st-runs-symbols-cutover-1159.test.ts` pins the split boundary — auto-paper
  jobs off st-runs + run-ids off the legacy parent, the writer's two refs,
  and `ST_RUN_JOB_ROOTS == ['st-runs']`. Parity gate:
  `scripts/verify/data-pipeline-st-runs-symbols-1159.ts` — verbatim field-diff
  on run docs + jobs + symbol docs, with empty-legacy floors so a
  zero-evidence run FAILs rather than passing vacuously (green 9/9
  as-built, re-verified post-review).

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
