**Topic:** Portfolio Allocation  
**Topic Slug:** `portfolio-allocation`  
**Thread:** Allocation Manager Page  
**Thread Slug:** `alloc-manager-page`  
**Issue:** #579  
**Thread Parent:** #577  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

---

# SHARED Implementation Plan — Portfolio Allocation

Contracts and pure, testable logic shared by the FE. No functions backend — all live reads go through the existing `RobinhoodMcpClient`, all persistence through the client Firestore SDK.

## 1. Contracts — `shared/portfolio-allocation-contracts.ts`

```ts
export enum BucketStatus { ACTIVE = 'ACTIVE', RETIRED = 'RETIRED' }

/** Named strategy group owning a funding target for ONE RH account. */
export interface AllocationBucket {
  id: string;                    // `{accountNumber}_{slug}` — FROZEN at creation; rename updates `name` only
  accountNumber: string;
  name: string;                  // strategy group name — ticket attribution key
  targetPct: number;             // % of current account value
  status: BucketStatus;
  createdAt: string;
  updatedAt: string;
}

/** One audit entry per attribution change (post-hoc assign or move). */
export interface AttributionEvent {
  fromBucketId: string | null;   // null = initial post-hoc assignment
  toBucketId: string;
  at: string;                    // ISO timestamp
}

/** Per-position attribution — a bucket owns the instrument's full activity. */
export interface PositionAttribution {
  id: string;                    // `{accountNumber}_{instrumentId}` composite
  accountNumber: string;
  instrumentId: string;
  bucketId: string;
  history: AttributionEvent[];   // appended on every change
  createdAt: string;
  updatedAt: string;
}

/** Computed per-bucket rollup (not persisted). */
export interface BucketStats {
  bucketId: string;
  exposure: number;
  targetDollars: number;
  drift: number;                 // exposure - targetDollars
  realizedPnl: number;
  unrealizedPnl: number;
  openCount: number;
  closedCount: number;
  asOf: string;                  // ISO as-of label (PRD requirement)
  equityCurve: EquityCurvePoint[];  // canonical shape from shared/common.ts
}
```

## 2. Firestore layout + rules

- `portfolio-buckets/{account}_{slug}` — flat collection, composite ids (single-query enumeration per AGENTS.md convention). Bucket id is minted once at creation (frozen); renames update `name` only. **Uniqueness rule:** names compare by `bucketSlug(name)` — create fails if the `{account}_{slug}` doc exists (covers same-name, alias, and retired/renamed-away slugs — occupied ids are never freed); rename fails if any other bucket's name-slug equals the new name's. Both checks run in the same transaction as the write. Ticket match: ACTIVE bucket in the same account with equal name-slug; 0 or >1 → Unassigned. `toBucketId` never targets a RETIRED bucket.
- `portfolio-attributions/{account}_{instrumentId}` — flat collection, composite ids.
- `firestore.rules`: owner-scoped read/write (same pattern as `st-trading-config`); `portfolio.indexes.json` entries if queries need them (bucket list filters by `accountNumber` + `status`).
- Cash bucket and Unassigned are **derived views** — never stored docs.

## 3. Pure utils — `shared/portfolio-allocation-utils.ts` (+ `.spec.ts`)

- `targetDollars(accountValue, targetPct)` — `accountValue * pct / 100`.
- `drift(exposure, targetDollars)` and `wouldExceedTarget(currentExposure, orderCost, targetDollars)` — the warn-not-block predicate (mirrors `order-guardrails.util.ts` style).
- `attributePositions(positions, attributions)` — joins RH positions to bucket ids; returns `{bucketId | 'UNASSIGNED'}` per position.
- `matchRealizedPnl(orders, instrumentIds)` — buy/sell matching over broker order history per instrument → realized P&L per instrument. FIFO per instrument; document that RH order history depth bounds fidelity.
- `computeBucketStats(bucket, accountValue, positions, orders, attributions)` — the single rollup seam feeding `BucketStats`; equity curve = cumulative P&L from attributed orders over time (approximation — no historical marks; flagged in PRD).

## 4. Boundaries

- FE consumes everything via imports from `shared/` — no backend build step.
- The order ticket seeds attribution at fill: ticket `strategyName` → bucket `name` lookup happens in FE order flow, not in shared.

## 5. Risks

- **Order history depth**: RH may not return full history — realized P&L is a lower bound. Document the limitation; do not fabricate marks.
- **Instrument reuse**: attribution keys `instrumentId` — close-then-reopen keeps the bucket (intended per grilling).
- **Composite-id collisions**: slug normalization for bucket names (lowercase-hyphen) must be deterministic.
