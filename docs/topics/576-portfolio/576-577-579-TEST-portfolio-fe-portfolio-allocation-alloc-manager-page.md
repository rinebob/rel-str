**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Allocation Manager Page  
**Thread Slug:** `alloc-manager-page`  
**Issue:** #579  
**Thread Parent:** #577  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# FE Test Plan — Portfolio Allocation Manager

## Seams

- `allocation.store.ts` selectors — primary seam: fixture buckets/attributions/positions/orders in → rows/stats out (mirrors `portfolio-dashboard.store.spec.ts` fixture pattern).
- Services mocked at the Firestore/MCP boundary — no live calls (follow `RobinhoodMcpObservationService` stub conventions; `{ provide: Firestore, useValue: {} }` pattern per AGENTS.md).

## Unit / integration targets

- `allocation-bucket.service` — CRUD writes correct composite ids; retire sets status; cash bucket never persisted.
- `position-attribution.service` — `assign`/`move` append `AttributionEvent` (from null vs from bucket); ticket `strategyName` → bucket `name` seeding.
- `allocation.store` — `bucketRows` merges config+stats per account; Cash row = remainder; `positionsRows` resolves bucket names + Unassigned filter; account switch re-scopes everything (no cross-account leakage); attribution write invalidates selectors (dialog + tabs freshness).
- `buckets-table` — renders merged rows; Cash row pinned non-editable; retire confirm gates the write.
- `positions-table` + `assign-bucket-dialog` — assign action opens picker; selection writes attribution.
- `bucket-detail-dialog` — header metadata renders; carousel iterates positions; dropdown switches viewed bucket without closing; trade-chart stub renders placeholder.
- Order ticket — selector optional (submits empty fine); `wouldExceedTarget` warning displays and does not block; `strategyName` stamped when set.

## Jest notes

- Async store paths: `async` tests flushed via `await new Promise<void>((r) => setTimeout(r, 0))` — never under `jest.useFakeTimers()` (AGENTS.md).
- `jasmine.clock` unsupported — jest fake timers only.

## E2E journeys (manual verify)

- Create bucket → assign a position → drift/exposure/P&L visible on Buckets tab → open detail dialog → carousel through positions → move position to another bucket → both tabs + dialog reflect the move.
- Non-agentic account → positions + assignment work; no order-side affordances implied.
- Submit order ticket without a bucket → lands in Unassigned → assign post-hoc.
