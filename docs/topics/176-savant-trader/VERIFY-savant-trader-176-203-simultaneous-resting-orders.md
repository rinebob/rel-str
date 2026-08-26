# FE-D2b (#203): Verify Robinhood Simultaneous Resting Orders

**Date:** 2026-08-26
**Account:** [REDACTED] (nickname: "Agentic", agentic_allowed=true, cash type)
**Method:** Real `place_equity_order` + `get_equity_orders` + `cancel_equity_order` + `get_equity_positions`
**Tool:** Robinhood MCP observation API (localhost:3456)

## Objective

Verify whether Robinhood allows a stop loss and target exit to rest simultaneously on the same symbol. This resolves the open question from the PRD (PRD-savant-trader-order-placement-refactor.md).

## Test setup

- **Symbol:** AAPL (actively traded, current price ~$313)
- **Account:** [REDACTED] (agentic-allowed, cash)
- **Position:** 2 whole shares purchased at ~$312.64

## Results

### Phase 1: Buy orders (simultaneity test — buy/buy)

Two GTC buy orders on AAPL, placed seconds apart:
- Order 1: GTC limit buy, qty=1, $100 (68% below market)
- Order 2: GTC stop_market buy, qty=1, $500 (60% above market)

**Result: Both accepted, both confirmed, both resting simultaneously.** Cancelled cleanly.

### Phase 2: Sell orders with 1 share (stop loss + target exit — sell/sell)

Bought 1 whole share at $312.64. Placed:
- Stop loss: GTC stop_market sell, qty=1, stop=$250
- Target exit: GTC limit sell, qty=1, limit=$400 (placed while stop loss was resting)

**Result: Target exit REJECTED — "Not enough shares to sell."**

Position check after stop loss was placed:
- `quantity: 1.000000`
- `shares_available_for_sells: 0.000000`
- `shares_held_for_sells: 1.000000`

The stop loss order held the entire position (1 share), leaving 0 shares available for the target exit. Reversed the order (limit sell first, then stop loss) — same result: second order rejected.

### Phase 3: Sell orders with 2 shares (split position)

Bought 2 whole shares. Placed:
- Stop loss: GTC stop_market sell, qty=1, stop=$250
- Target exit: GTC limit sell, qty=1, limit=$400 (placed while stop loss was resting)

**Result: Both accepted, both confirmed, both resting simultaneously.**

Position check:
- `quantity: 2.000000`
- `shares_available_for_sells: 0.000000`
- `shares_held_for_sells: 2.000000`

Each order held 1 share, leaving 0 available but both orders resting. Cancelled both cleanly, sold 2 shares back at $312.71.

### Phase 4: Fractional share limitations (incidental finding)

When testing with $100 of AAPL (0.32 fractional shares):
- **GTC time_in_force:** rejected — "Invalid time in force for fractional order"
- **stop_market orders:** rejected — "Invalid trigger for fractional order"
- **limit orders with fractional quantity:** rejected — "Limit order quantity cannot include fractional shares"

**Fractional shares only support market orders with gfd time_in_force.** Stop loss and target exit orders require whole shares.

## Conclusion

**Robinhood enforces share availability, not symbol-level exclusivity.** The constraint is:

> You cannot place sell orders for more shares than you hold. Each resting sell order "holds" its shares, reducing `shares_available_for_sells` by the order quantity.

**For stop loss + target exit on the same position:**
- **1 share:** Cannot place both — the first order holds the only share, rejecting the second.
- **2+ shares:** CAN place both if the position is split (e.g., stop loss for 1 share, target exit for 1 share). Both rest simultaneously.
- **Fractional shares:** Cannot place stop or limit orders at all — only market orders with gfd.

## Splitting is NOT a viable solution

Splitting the position across stop loss and target exit (e.g., 50 shares each) does not work because **only one of the two orders will actually exit the position.** If the stop loss fills, the target exit is still resting on 50 shares that no longer exist — and the other 50 shares were never covered by a stop loss. If the target exit fills, the stop loss is still resting on 50 shares that no longer exist — and the other 50 shares are now unprotected. Either way, you end up with half a position open and the wrong order still resting.

The stop loss is the safety net — it must cover the **full position**. That means the target exit cannot be a resting order on the same shares.

## Target exit monitoring options

The RH MCP has **no websockets or streaming data** — all "real-time" data is via polling `get_equity_quotes` (snapshot). The discovery doc recommends polling no more frequently than every 30 seconds and preferring scheduled snapshots over continuous polling.

Industry standard techniques for target exit monitoring:

- **Broker-side OCO (One-Cancels-Other):** The broker natively links stop loss and target exit — when one fills, it cancels the other. Gold standard, but Robinhood does not support OCO orders.
- **Broker-side bracket orders:** Similar to OCO with a third leg (entry + stop + target). Also not supported by Robinhood.
- **Server-side polling:** A scheduled job checks current price vs target at intervals. When target is hit, places a market sell and cancels the stop loss. Simple, reliable, works unattended.
- **Client-side polling:** The app polls quotes while open. Lower latency when actively watching, but stops when the tab is closed. Not reliable for unattended exits.
- **WebSocket/streaming quotes:** Subscribe to real-time price updates. Lowest latency, but requires a persistent connection. Not available via RH MCP.
- **Alert-triggered execution:** Set a price alert with the broker, trigger an order when it fires. Robinhood has price alerts but they're notification-only (no auto-execute).

### Recommended approach for Savant Trader

**Cloud Function polling** is the natural fit given the existing architecture:

1. A scheduled Cloud Function runs every 1-5 minutes during market hours.
2. Calls `get_equity_quotes` for symbols with open positions + pending target exits.
3. If the target price is hit, places a market sell for the full position.
4. Cancels the resting stop loss order to avoid a sell on shares that no longer exist.
5. Works even when the user's browser is closed.

The auth path is already proven — a Firebase Cloud Function can authenticate and call the RH MCP directly (proven in `RH-AGENT-DIRECT-MCP-AUTH-PROOF-2607-01.md` Phase 4, 2026-08-14).

A **client-side polling fallback** could provide lower-latency exits when the app is open, with the Cloud Function as a safety net when it's not.

The PRD's open question is resolved: **simultaneous resting sell orders are NOT practical for stop loss + target exit on the same position.** The stop loss gets the full position as a resting order; the target exit must be achieved through Cloud Function polling that cancels the stop loss when it fires.
