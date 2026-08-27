# Position Sizing & Units Model

## Problem

We want uniform trade sizes across all equity/ETF orders. Fractional shares would
solve this neatly (e.g. always buy exactly $100 of AAPL), but **stop loss orders
require whole shares**. So we need to compute the nearest whole-share count that
gets us closest to a target dollar amount.

When the share price exceeds the target dollar amount, we can't buy a fraction of
a share. Instead we buy 1 share and account for the "overspend" using **units** —
a normalized measure of position size relative to the target dollar amount.

## Core Concepts

### Default Dollar Amount

The target dollar value for a single trade. Configurable, default $100.

### Unit

A normalized measure of position size: **1 unit = defaultDollarAmount**.

- A $100 trade = 1.0 units
- A $325 trade (1 share at $325, default $100) = 3.25 units
- A $90 trade (3 shares at $30, default $100) = 0.9 units

### Max Units

A guardrail on total open exposure. If max units = 200 and default = $100,
total open exposure is capped at ~$20,000. This is a **warning, not a wall** —
the user can exceed it but will be notified.

### Account Value

The current total value of the account (cash + positions), loaded on demand
from Robinhood `get_portfolio.data.total_value`. The same account snapshot
provides equity exposure, cash, buying power, and the open-position count;
local order intents are not used as a substitute for brokerage portfolio state.

All allocation calculations flow from the live account snapshot, not from a
separate "starting" field:

```
allocationCap = accountValue * (maxAllocationPercent / 100)
availableCash = accountValue - currentExposure
```

### Max Allocation Percent

The maximum percentage of the account that can be allocated to open
positions. The remainder stays in cash as a buffer. For example, with a
$10,000 account value and 80% max allocation, up to $8,000 can be in
positions and at least $2,000 stays in cash.

This is a policy setting, not a hard wall — but it should produce a warning
when a new order would push the allocation above the limit.

### Account Value Over Time

As trades are opened and closed, the account value changes (gains, losses,
dividends). The allocation percentage is based on the **current account value**.
However, the max allocation percent and default dollar amount should not be
adjusted frequently — instead, the system adjusts the **number of positions**
(or suggests adjusting it) to stay within limits.

Example:
- Account value: $10,000
- Max allocation: 80% → $8,000 available for positions
- Default dollar amount: $100, max units: 200 → $20,000 theoretical max
- The binding constraint is the $8,000 allocation cap, not the 200 unit cap
- If the account grows to $12,000, the allocation cap becomes $9,600
- If the account shrinks to $8,000, the allocation cap becomes $6,400
- The user does NOT change the max allocation percent or default dollar amount
  in response to normal fluctuations — instead, the number of open positions
  naturally adjusts as trades close and new ones are gated by the cap

## Position Sizing Formula

```
shares = max(1, round(defaultDollarAmount / sharePrice))
actualCost = shares * sharePrice
units = round(actualCost / defaultDollarAmount, 2)
```

### Examples (default = $100)

| Share Price | Shares | Actual Cost | Units |
|-------------|--------|-------------|-------|
| $30         | 3      | $90         | 0.9   |
| $49         | 2      | $98         | 0.98  |
| $51         | 2      | $102        | 1.02  |
| $100        | 1      | $100        | 1.0   |
| $150        | 1      | $150        | 1.5   |
| $200        | 1      | $200        | 2.0   |
| $325        | 1      | $325        | 3.25  |
| $500        | 1      | $500        | 5.0   |

### Rounding Rules

- **Shares**: `Math.round(default / price)`, floored to 1. Standard rounding
  (0.5 rounds up).
- **Units**: Rounded to 2 decimal places. 0.9999 → 1.0, 3.25 → 3.25.
- **User override**: The user can manually override the share count. Units are
  recalculated from the override.

## Stop Loss Orders

Stop loss orders use the **same share count** as the entry order. If entry is
3 shares, stop loss is 3 shares. No fractional shares — this is the constraint
that drives the whole-share rounding above.

### Stop Loss Price Input

The order form includes a stop loss section with two linked fields:

- **Stop Price ($)** — the absolute price at which the stop loss triggers
- **Stop Percent (%)** — the percentage below the entry price

These are bidirectionally linked: editing one updates the other.

```
stopPercent = ((entryPrice - stopPrice) / entryPrice) * 100
stopPrice = entryPrice * (1 - stopPercent / 100)
```

Each field has **up/down stepper buttons** so the user can nudge the value
without typing. The stepper increments:

- **Price field**: increments by $0.05 (5 cents)
- **Percent field**: increments by 0.5%

Default stop percent: 8%. The stop-loss editor is shown by default for applicable equity/ETF buy orders without an enable/disable checkbox.

### Example

- Entry price: $100
- Stop percent: 5% → stop price = $95.00
- User clicks up arrow on percent → 5.5% → stop price = $94.50
- User clicks down arrow on price → $94.49 → percent = 5.51%

When the user submits the entry order, the stop loss order is submitted
simultaneously (or immediately after fill confirmation) with the same share
count and the configured stop price.

## Position Adjustments

### Adding Shares to an Existing Position

The user can add shares to a position they already hold. This creates a new
buy order for the additional shares. After the add fills:

1. **Total shares** = existing shares + new shares
2. **Stop loss** must be updated to the new total share count
3. **Units** increase by the new shares' unit cost

The stop loss update requires cancelling the existing stop loss order and
submitting a new one with the updated share count. This is a multi-step
operation:
- Cancel existing stop loss → submit new stop loss with new quantity

### Partial Exit (Selling a Portion)

The user can sell a portion of an existing position (e.g. "exit 50%"). This
creates a sell order for the specified number of shares. After the partial
exit fills:

1. **Remaining shares** = previous shares - sold shares
2. **Stop loss** must be reduced to match the remaining share count
3. **Units** decrease by the sold shares' unit cost

The stop loss update is the same cancel-and-resubmit pattern as adding shares.

### Stop Loss Adjustment Flow

Both adding shares and partial exits require the same stop loss adjustment:

```
1. User submits add/partial-exit order
2. Order fills (or is confirmed)
3. System cancels the existing stop loss order
4. System submits a new stop loss with the updated share count
5. Position record updated with new share count and unit total
```

If the stop loss cancel or re-submit fails, the user is notified — the
position is still adjusted but the stop loss may be stale until manually
fixed or retried.

## Configuration

### Trading Config Document

The existing trading config doc (Firestore) gains new fields:

```
defaultDollarAmount: number      // e.g. 100 — target per trade
maxUnits: number                 // e.g. 200 — guardrail on open exposure
accountValue: number             // last saved value; live UI value comes from Robinhood portfolio
maxAllocationPercent: number     // e.g. 80 — max % of account in positions
```

### Config UI

A settings button on the signal-order page opens a small dialog with:
- Default Dollar Amount ($)
- Max Units
- Account Value ($), refreshed from the selected Robinhood account
- Max Allocation Percent (%)

Policy values are editable and saved to the trading config doc. The displayed
account value is refreshed from Robinhood rather than treated as authoritative
local configuration.

## Scoreboard

A header bar at the top of the signal-order page showing the key portfolio
metrics at a glance:

```
Account Value: $10,000  |  Allocation: $7,900 / $8,000 (79%)  |  Units: 79 / 200  |  Cash: $2,100  |  Positions: 12
```

Values shown:
- **Account Value** — from config
- **Allocation** — current exposure / allocation cap (with %)
- **Units** — current open units / max units
- **Cash** — account value minus current exposure
- **Positions** — count of open positions

The scoreboard updates live as orders are submitted/filled. A settings gear
icon on the right opens the config dialog.

## Price Fetching

When the user navigates to the signal-order page, fetch the current price for
each staged order's symbol via the RH quote API. Display the price in the order
queue (left panel).

The price is used to:
1. Auto-calculate the suggested share count
2. Show the unit cost in the order ticket
3. Show the actual dollar cost

### Left Panel (Order Queue) Changes

Widen the panel to ~300px. Each queue item shows:
- Symbol + side (existing)
- **Price** (new — e.g. "$325.40")
- Order type + qty (existing)

### Order Ticket Changes

When an intent is selected and the price is loaded:
- Auto-calculate `shares` from `defaultDollarAmount / price`
- Show the calculated shares in the Qty field (user can override)
- Show read-only computed values:
  - **Unit cost**: `(shares * price) / defaultDollarAmount` → e.g. "3.25 units"
  - **Actual cost**: `shares * price` → e.g. "$325.40"
- If user overrides qty, recalculate unit cost and actual cost live

## Guardrails

### Max Units Warning

When submitting an order, check total current open units + new order units
against `maxUnits`:

- If `currentUnits + newUnits > maxUnits`: show a warning in the confirm dialog
  ("This order will exceed your max units limit of 200. Current: 198, After: 201.25")
- **Do not block the submit** — the user can proceed past the warning

### Max Allocation Warning

When submitting an order, check total current open position value + new order
cost against the allocation cap:

```
allocationCap = currentAccountValue * (maxAllocationPercent / 100)
currentExposure = sum of all open position values
newExposure = currentExposure + (shares * sharePrice)
```

- If `newExposure > allocationCap`: show a warning in the confirm dialog
  ("This order will exceed your max allocation of 80%. Current: $7,900, After: $8,250, Cap: $8,000")
- **Do not block the submit** — the user can proceed past the warning

### Cash Ceiling (Hard Block)

When submitting an order, check that the user has sufficient cash:

- If `newExposure > availableCash`: **block the submit** — cannot spend money
  that isn't in the account
- Show error: "Insufficient cash for this order. Available: $X, Required: $Y"

### Units Tracking (TBD)

How to track current open units is not yet decided. Options:
1. Compute on-the-fly from open positions in Firestore
2. Maintain a running counter updated on each fill

This will be discussed separately.

## Implementation Plan

1. **Add config fields** — `defaultDollarAmount`, `maxUnits`, `accountValue`, `maxAllocationPercent` to trading config
2. **Config dialog** — settings gear button + dialog on signal-order page
3. **Scoreboard** — header bar showing account value, allocation, units, cash, positions
4. **Price fetching** — batch quote API call for all staged symbols on page load
5. **Queue display** — show price in each queue item, widen panel to ~300px
6. **Auto-calc shares** — in order ticket, compute from price + defaultDollarAmount
7. **Unit cost display** — show units and actual cost in ticket
8. **Stop loss input** — bidirectional price/percent fields with stepper buttons
9. **Max units warning** — in confirm dialog, show warning if exceeding maxUnits
10. **Max allocation warning** — in confirm dialog, show warning if exceeding allocation cap
11. **Cash ceiling block** — block submit if insufficient cash (hard stop)
12. **Add shares to position** — buy order for existing symbol, update stop loss after fill
13. **Partial exit** — sell order for portion of position, adjust stop loss to remaining shares
14. **Stop loss adjustment** — cancel + resubmit stop loss when share count changes
15. **Units & exposure tracking** — separate follow-up (how to compute current open units/exposure)
