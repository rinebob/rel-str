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
- `attributePositions(positions, attributions, accountNumber)` — joins positions to bucket ids; `bucketId: null` = Unassigned.
- `matchRealizedPnl(fills)` — FIFO signed-lot matching per instrument over `AllocationFillInput` (per-instrument, per-execution fills): partial closes, multi-lot, shorts, option ×100 multiplier, malformed fills skipped. `positionEffect: 'close'` drops unmatchable remainders (truncated history never fabricates phantom lots). RH order-history depth bounds fidelity — realized P&L is a lower bound.
- `computeBucketStats(bucket, accountValue, positions, fills, attributions, asOf)` — the single rollup seam feeding `BucketStats`. `exposure` is gross (Σ|marketValue| — drift/targets); `netValue` is signed (Σ marketValue — reconciliation). Equity curve = cumulative realized per market date + endpoint folding in current unrealized (approximation — no historical marks; flagged in PRD).
- `cashExposure(accountValue, positions)` — the derived residual (account value − Σ signed position MV over ALL positions). `cashCheck(rhCash, accountValue, positions, tolerance)` compares it against broker-reported cash → `{actual, derived, discrepancy, diverged}`.
- **Cash model (decision):** Cash is NOT a pseudo-bucket you allocate into — it's the pool strategies allocate from. The Cash row displays the broker's *actual* cash; `cashCheck` flags divergence vs the derived residual (stale snapshots, pending fills). **Allocation basis = RH-reported cash**: `computeBucketStats` receives `rhCash` as its basis param — target % and drift measure a strategy's claim on the cash pool. Moving-basis caveat: fills move both exposure and basis (buys shrink cash, premium credits grow it) — drift accelerates as the pool drains, which is the intended stress signal.
- **Multi-leg grouping (decision):** `PositionAttribution.linkKey` = parent `orderId` shared by an order's legs. Legs attributing through a linkKey move **atomically** — a post-hoc move on any leg applies to all legs in the account. Splitting a spread across buckets would misrepresent strategy P&L (a lone short leg reads as naked).
- Service layer infers `positionEffect` where the raw data allows: option legs carry `position_effect`; equity sells can infer `close` when the account's `sharesHeldForSells` covers the qty. Omitted = assumed open-capable (documented fallback — truncated history can fabricate phantom shorts otherwise).
- Input shapes are domain types (`AllocationPositionInput`, `AllocationFillInput`) — NOT MCP types. `instrumentId` = RH UUID for options, symbol for equities (the MCP equity surface exposes no UUID). `get_pnl_trade_history` was rejected for attribution: it keys by symbol and option trades carry empty/chain symbol — concurrent strikes of one underlying can't be separated.

## 4. Boundaries

- FE consumes everything via imports from `shared/` — no backend build step.
- The order ticket seeds attribution at fill: ticket `strategyName` → bucket `name` lookup happens in FE order flow, not in shared.
- **#586 dependency:** `BrokerOrder` (FE MCP type) currently drops `instrument_id`, `legs[]` (multi-instrument option orders), and `executions[]` (per-fill detail — raw orders carry them; see `shared/broker-types.ts` `RawBrokerOrder`). The service layer must extend `normalizeOrder` to expose legs + executions and expand them into per-instrument `AllocationFillInput`s — leg `position_effect` (open/close) flows into `AllocationFillInput.positionEffect`.

## 5. Risks

- **Order history depth**: RH may not return full history — realized P&L is a lower bound. Document the limitation; do not fabricate marks.
- **Instrument reuse**: attribution keys `instrumentId` — close-then-reopen keeps the bucket (intended per grilling).
- **Composite-id collisions**: slug normalization for bucket names (lowercase-hyphen) must be deterministic.
