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

# SHARED Test Plan — Portfolio Allocation

## Seams

- `shared/portfolio-allocation-utils.ts` — pure functions; the single seam for all rollup math. Test external behavior only.

## Unit targets

- `targetDollars` / `drift` — percent-of-account math, zero/negative account value edge, fractional results.
- `wouldExceedTarget` — boundary: projected exposure exactly at target (no warn), $0.01 over (warn), zero target, zero exposure.
- `attributePositions` — positions with attribution, without attribution (→ UNASSIGNED), attribution for a different account (must not leak), retired bucket still attributed.
- `matchRealizedPnl` — FIFO matching per instrument: round trip (buy→sell), partial closes, multiple lots, short sells, interleaved instruments, orders with no matching sell (unrealized, excluded), missing/malformed fills skipped.
- `computeBucketStats` — full rollup: exposure from positions, realized from orders, counts, drift; cash remainder math (account value − Σ); equity curve ordering + cumulative correctness.
- Contracts spec (`portfolio-allocation-contracts.spec.ts`) — enum values, composite-id shape expectations, required fields (follows `paper-trading-contracts.spec.ts` precedent).
- Ids spec (`portfolio-allocation-ids.spec.ts`) — slug determinism + intentional aliasing (create must de-dupe), empty/non-ASCII handling, `accountNumber`/`instrumentId` validation.
- Invariants pinned by specs — id frozen at creation (rename keeps id), `history[last].toBucketId === bucketId` (append-only), `BucketStats` field set incl. `asOf`, `isCash` absent (Cash computed).

## Edge cases

- Bucket target % sum > 100% — warn state computable, never throws.
- Attribution move: `history` appends; `fromBucketId` null on initial assignment.
- Empty inputs everywhere — zero buckets, zero positions, zero orders → zeroed stats, full cash remainder.
- Order history truncation: orders older than RH's window simply absent — realized P&L is a lower bound (assert no crash, not completeness).
