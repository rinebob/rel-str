**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1477  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1462  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12  

# UAT — Signal-order workspace orders fetch walks pages (#1462)

## Scope

`order.component.ts` (the signal-order/order-ticket workspace) fetched
Robinhood equity orders via a raw single-page `get_equity_orders` call.
Orders past page 1 were invisible to `rhStopRows`,
`restingLimitBuyNotional`, `mergeWithRhOrder`,
`reconcileTerminalStatuses`, and — worst — `findActiveStopLoss`, which
could bless a duplicate stop if the real stop sat on a deeper page.

The fix routes the workspace through a new verbatim paginated client
method, `RobinhoodMcpClient.getEquityOrdersRaw`, which walks `data.next`
to exhaustion (25-page cap + warn, mid-walk failure rejects) and returns
the raw wire records so the workspace's `BrokerOrderSnapshot` normalizer
keeps `trigger` / `last_transaction_at` / `fees` / `placed_agent` etc.
(the typed `BrokerOrder` drops them, which would break stop detection).

**Acceptance criteria:**

1. All resting RH orders (not just page 1) populate `rhOrders` and its
   consumers: `rhStopRows`, `protectedSymbols`, `restingLimitBuyNotional`,
   `reconcileTerminalStatuses`.
2. A stop order whose wire shape uses `type: 'market'` + `trigger:
   'stop'` still detects as active (`isActiveStopLoss` unchanged) —
   i.e., a position's PROTECTED badge and the duplicate-stop guard still
   work.
3. Fetch failure (transport error or MCP `toolError`) does NOT mark
   `rhOrdersLoaded = true` — the workspace stays gated rather than
   acting on a silently empty order map.
4. Orders lacking a string `id` are skipped **with a console warn**
   (previously silent).
5. `updateEquityStopOrder`'s cancel-confirm poll (`getEquityOrders
   {orderId}`) is unaffected — unchanged single-order path.
6. No user-visible regression on the `/trading/live` surface.

## Prerequisites

- Dev server running: `npm start` (or already on `http://localhost:4200`).
- An authenticated Robinhood MCP session (the same session the app uses
  for live trading surfaces — sign in via the app if prompted).
- An account with at least one open/resting order is helpful but not
  required — the account today fits one page, so acceptance is
  "orders still load correctly", not "page 2 appears". The multi-page
  walk, verbatim cursor pass-back, mid-walk failure isolation, and
  verbatim field passthrough are all spec-covered in
  `robinhood-mcp-client.service.spec.ts` (3 new specs) and
  `order.component.spec.ts` (3 new specs).

## Getting to the feature

- **Route:** `/trading/live`
- **Entry point:** Sidenav → **Trading** section → **Live** nav item
  (between "Gallery" and "Paper").
- **Landing surface:** the signal-order workspace — order-ticket queue
  plus the Robinhood orders panel (`rhStopRows`, PROTECTED badges,
  resting-buy notional, merged order statuses).

## Test scenarios

### 1. Orders populate on load

- **Feature:** `refreshRhOrders` runs on page load via the new walking
  client.
- **Steps:** Sign in → Sidenav → Trading → Live.
- **Expected:** The RH orders surface populates as before — open orders
  visible, PROTECTED badges on positions with resting stops, resting-buy
  notional non-zero if resting buys exist. No visible change vs
  pre-#1462 behavior.

### 2. No fetch errors or stray warns

- **Feature:** clean wire handling on the new path.
- **Steps:** Open DevTools console while loading `/trading/live` and
  while performing scenario 3.
- **Expected:** No `[OrderComponent] Failed to fetch RH orders` errors.
  No `Skipped equity order with no string id` warns — a warn means a
  malformed wire order arrived; **investigate it, don't dismiss it**.

### 3. Refresh after an order action

- **Feature:** `onRefreshRequested` re-walks after submit/cancel/stop.
- **Steps:** Perform any ticket action you would normally run (e.g.,
  cancel a resting order you intend to re-place, or submit/cancel an
  Update Stop on a position you own — use judgment; do NOT manufacture
  order churn just for QA).
- **Expected:** The orders list refreshes and statuses update to match
  the action (cancelled order leaves the open list / shows terminal
  state).

### 4. Regression — Update Stop cancel-confirm still resolves

- **Feature:** `updateEquityStopOrder`'s cancel-confirm poll uses the
  unchanged single-order `getEquityOrders({orderId})` path.
- **Steps:** If you run an Update Stop during scenario 3, confirm the
  dialog completes normally rather than hanging on the cancel poll.
- **Expected:** Update completes; the new stop appears in the orders
  surface.
- **Note:** Skip if no Update Stop is run — the path is spec-covered by
  the order-execution suite (unchanged externally observable semantics).

### 5. Stop detection integrity (spec-verified, visual confirm)

- **Feature:** `isActiveStopLoss` still keys on verbatim `trigger:
  'stop'` — the whole reason the raw path exists.
- **Steps:** On a position with a resting stop, confirm the PROTECTED
  badge still shows and the position's stop row appears in `rhStopRows`.
- **Expected:** Badge + row present, identical to pre-change.

### 6. Failure path (manual, optional)

- **Feature:** a failed fetch leaves `rhOrdersLoaded` false — the
  workspace gates rather than acting on an empty map.
- **Steps:** DevTools → Network → Offline → trigger a refresh (navigate
  away and back to `/trading/live`).
- **Expected:** Console shows `[OrderComponent] Failed to fetch RH
  orders`; the orders surface does not present an empty-but-"loaded"
  state. Restore network afterward.
- **Note:** Optional — the gating is pinned by spec (`leaves
  rhOrdersLoaded false when the fetch rejects`). Run only if convenient.

## Manual UI/UX refinement pass

- [ ] `/trading/live` visually identical to pre-change (no UI diff —
  verify nothing regressed: orders table, badges, notional totals).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| 1 — complete order list feeds all consumers | 1, 3 |
| 2 — verbatim `trigger` preserves stop detection | 5 |
| 3 — failure does not set `rhOrdersLoaded` | 2, 6 (+ spec) |
| 4 — id-less orders warn, not silently skip | 2 |
| 5 — cancel-confirm path unaffected | 4 |
| 6 — no user-visible regression | 1, refinement pass |

## Results log

**2026-11-12 (automated evidence):** affected suites re-run in QA —
4/4 suites, 284/284 specs green (`order.component`,
`broker-order.util`, `robinhood-mcp-client`, `order-execution`);
`tsc --noEmit` clean on `tsconfig.app.json` + `tsconfig.spec.json`.
The multi-page walk, verbatim cursor pass-back, `toolError` rejection,
mid-walk failure isolation, and id-less-order warn are all spec-pinned —
the manual scenarios below confirm no regression on the live surface.

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Orders populate on load | PASS | User-executed 2026-11-12 — "all pass" |
| 2 | No console errors / stray warns | PASS | User-executed 2026-11-12 — "all pass" |
| 3 | Refresh after order action | PASS | User-executed 2026-11-12 — "all pass" |
| 4 | Update Stop cancel-confirm regression | PASS | User-executed 2026-11-12 — "all pass" |
| 5 | Stop detection integrity | PASS | User-executed 2026-11-12 — "all pass" |
| 6 | Failure path (optional) | PASS | Spec-pinned (`leaves rhOrdersLoaded false when the fetch rejects`) |
