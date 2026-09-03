# Savant Trader UAT — Order Processing Permutations

**Topic:** Savant Trader — Order Placement Refactor  
**Issue:** #212  
**Domain:** SAVANT-TRADER  
**Status:** IN PROGRESS  
**Last Updated:** 2026-09-03  

---

## How to use this doc

This UAT exercises every order processing permutation with **live orders** against the real Robinhood account. It is organized in three parts:

1. **Order Lifecycle Reference** — what happens at each stage of an order's life, what the UI shows, and what you should do. Read this first.
2. **Sequential Batch Processing** — a realistic workflow of processing multiple orders from the queue one after another. This is the primary UAT scenario.
3. **Permutation Scenarios** — targeted tests for each order type, side, TIF, and hours combination, with lifecycle transitions called out.

**Prerequisites:**
- Trading config set (account number, default dollar amount, max units, allocation %)
- Robinhood re-authenticated (green sync icon)
- At least 3–5 signals accepted and staged in the order queue
- Live market hours (or pre/post for extended hours scenarios)

**Conventions:**
- Use small dollar amounts ($10–$20) to minimize risk during testing
- Use liquid symbols (AAPL, SPY, etc.) to ensure fills
- Record the actual fill price, order ID, and any errors in the findings log
- Close out all test positions at the end of the session

**Important: Short selling is not supported**
Robinhood's MCP API does not support short selling equities. The `place_equity_order` tool accepts `side: 'buy' | 'sell'` but a sell order only sells shares you already own — it does not open a short position. There are no borrow/locate tools in the MCP catalog. SHORT signals from the signal pipeline are currently mapped to `side: 'sell'` order intents, which will **fail** at Robinhood if you don't already own the shares. Short signals will be handled via options (buy puts) in a future milestone. For this UAT, skip any sell orders for symbols you don't own, or only test sells on symbols where you have an existing position to close.

---

# Part 1: Order Lifecycle Reference

Every order intent moves through a lifecycle. At each stage, the **queue** and the **ticket** present different information and actions. This section describes what you see and what you should do at each stage.

## Stage 1: STAGED

**What it means:** The order intent exists in Firestore but has not been sent to Robinhood. It is editable.

**Queue:**
- Row appears in the **Staged** group (with the colored dot)
- Row shows: checkbox, date, source badge (SIG/MAN/POS), symbol, price, side (BUY/SELL), type (MKT/LIMIT/etc.), and dollar amount or share count
- Group header is expandable/collapsible

**Ticket:**
- Header shows symbol, live price, side badge, and **STAGED** status badge
- Form is fully editable: Type pills, Qty stepper, Cost/Units (read-only), Limit $ (if applicable), Stop $ (if applicable), TIF pills, Hours pills
- **Submit Order** button is visible at the bottom
- No stop loss section (stop loss only appears after entry fills)
- Order preview JSON is visible below the form (account number is redacted)

**What you do:**
- Review the order parameters (type, qty, price, TIF, hours)
- Adjust any fields if needed
- Click **Submit Order** — this opens the **Order Confirm Dialog** (a Material dialog showing a summary of the order: symbol, side, type, qty, limit/stop price, TIF, hours, account number, plus any guardrail warnings). Click **Confirm** to proceed or **Cancel** to go back.

**What happens next:**
- If you confirm in the dialog → moves to **SUBMITTING**
- If you cancel the dialog → stays at **STAGED**

---

## Stage 2: SUBMITTING

**What it means:** The order is being sent to Robinhood via the MCP service. This is a transient state.

**Queue:**
- Row moves from Staged group to **Submitting** group
- Group header shows "Submitting" with a colored dot

**Ticket:**
- Form becomes read-only (no editable fields)
- **Submitting…** indicator appears with an hourglass icon
- No Submit, Modify, or Cancel buttons visible

**What you do:**
- Wait. This should take 1–5 seconds.

**What happens next:**
- If Robinhood accepts the order → moves to **SUBMITTED**
- If Robinhood rejects the order → moves to **FAILED**
- If the request times out → the reconciliation function will eventually move it to **FAILED** or **SUBMITTED** depending on what it finds

---

## Stage 3: SUBMITTED

**What it means:** Robinhood has accepted the order. It is now resting on the exchange.

**Queue:**
- Row moves to **Submitted** group
- Row shows the same info but is no longer in the Staged group

**Ticket:**
- Form switches to **read-only confirmation** view:
  - Type, Qty, Fill (if available), Limit (if applicable), TIF, and Order ID are shown as label-value rows
- **Modify** and **Cancel** buttons appear in the action section
- No editable form fields

**What you do:**
- For **market orders**: wait for the fill. Market orders usually fill within seconds.
- For **limit/stop orders**: wait for the price to trigger, or cancel/modify if you change your mind.
- Click **Modify** to revert to STAGED and edit the order → moves back to **STAGED**
- Click **Cancel** to cancel the resting order → moves to **CANCELLED**

**What happens next:**
- If the order fills → moves to **FILLED**
- If you cancel → moves to **CANCELLED**
- If you modify → moves back to **STAGED**
- If Robinhood rejects/cancels the order → moves to **FAILED** or **CANCELLED**

---

## Stage 4: FILLED

**What it means:** The order has been executed. You now own (or have sold) the shares.

**Queue:**
- Row moves to **Filled** group
- Row shows the same info but in the Filled group

**Ticket:**
- Confirmation section shows: Type, Qty, Fill Price, and Order ID
- For **buy orders only**: the **Stop Loss** form appears below the confirmation:
  - Stop Loss header with **Risk: $X.XX** next to the label
  - **$ field** — pre-filled from fill price × (1 - 8% default), editable with steppers
  - **% field** — pre-filled with 8 (default), editable with steppers
  - **Submit Stop Loss** button — disabled until the stop loss price is valid
  - Stop loss preview JSON below (account number redacted)
- For **sell orders**: no stop loss section (sells don't get stop losses)
- No Modify or Cancel buttons (the order is already filled)

**What you do (buy orders):**
- Review the stop loss price — it's anchored to your **fill price**, not the current live price
- Adjust the $ or % if you want a tighter or wider stop
- Verify the Risk amount (shares × (fill price - stop price))
- Click **Submit Stop Loss** to place the stop loss order
- If you don't want a stop loss, just move on to the next order

**What you do (sell orders):**
- Nothing further. The position is closed (you sold shares you already owned). Move on to the next order.
- Note: if you submitted a sell for shares you don't own, the order will **fail** at Robinhood (see Stage 5: FAILED).

**What happens next (buy orders with stop loss):**
- Stop loss intent is created and submitted → stop loss moves through its own lifecycle (SUBMITTING → SUBMITTED → FILLED or CANCELLED)
- The stop loss appears as a separate row in the queue with SELL side
- After the stop loss is submitted, the stop loss confirmation section replaces the form
- **Cancel Stop Loss** button appears if the stop loss is in SUBMITTED state

---

## Stage 5: FAILED

**What it means:** The order was rejected by Robinhood or encountered an error during submission.

**Queue:**
- Row moves to **Failed** group

**Ticket:**
- **Error section** appears with a red error icon:
  - Error message from Robinhood (e.g. "Insufficient buying power", "Invalid order type for this security")
  - Retryable indicator: "This error is retryable" or "This error is not retryable"
- Form is editable again (same as STAGED)
- **Retry** button appears (only if the error is retryable)
- **Submit Order** button is also visible (you can edit and re-submit)

**What you do:**
- Read the error message to understand what went wrong
- If retryable: fix the issue (e.g. adjust quantity, price) and click **Retry**
- If not retryable: you may need to cancel the intent and start fresh, or adjust parameters and submit as a new order
- Common failures: insufficient buying power, symbol not tradeable, market closed for this order type, price too far from market, **insufficient shares (sell without owning)**

**What happens next:**
- If retry succeeds → moves to **SUBMITTING** → **SUBMITTED** → **FILLED**
- If retry fails again → stays at **FAILED** with updated error

---

## Stage 6: CANCELLED

**What it means:** The order was cancelled by the user (or by Robinhood). No shares were transacted.

**Queue:**
- Row moves to **Cancelled** group

**Ticket:**
- Confirmation section shows the order details with cancelled status
- No action buttons (nothing to do — the order is gone)

**What you do:**
- Move on to the next order. The cancelled intent remains in the queue for reference but has no effect on your account.

---

## Stop Loss Sub-Lifecycle

When you submit a stop loss after an entry fill, the stop loss intent has its own lifecycle:

1. **Stop loss staged + submitted** → new row appears in Submitting group with SELL side
2. **Stop loss submitted** → row moves to Submitted group; ticket shows SL confirmation (SL Stop, SL Qty, SL ID); **Cancel Stop Loss** button appears
3. **Stop loss filled** → row moves to Filled group; SL confirmation shows fill price; no further action
4. **Stop loss cancelled** → row moves to Cancelled group; stop loss form reappears on the entry intent so you can place a new one

---

# Part 2: Sequential Batch Processing

This is the primary UAT scenario. It simulates the real workflow: you have a batch of accepted signals in the queue, and you process them one by one.

## Setup

1. Accept 3–5 LONG signals from the signal review page (mix of symbols)
2. Navigate to `/signal-order`
3. Verify all accepted signals appear in the Staged group in the queue
4. Verify Robinhood is re-authenticated (green sync icon)
5. Verify trading config is set (account number, dollar amount)

## Processing Loop

For each order in the queue, work through the following steps. Record results in the findings log.

### Order 1: Market Buy (happy path + stop loss)

| # | Step | What you see | What you do | Pass/Fail | Notes |
|---|------|-------------|-------------|-----------|-------|
| A1 | Click the first row in the Staged group | Ticket loads: symbol, live price, BUY, STAGED. Form is editable with Mkt type, auto-calculated qty, Cost/Units shown. Submit Order button at bottom. | Review the order | [ ] | |
| A2 | Click Submit Order | Confirmation dialog opens with order summary (symbol, side, qty, type, TIF, hours, redacted account). Guardrail warnings if any. | Review and click Confirm | [ ] | |
| A3 | After confirming | Row moves to Submitting group in queue. Ticket shows "Submitting…" indicator. Form is read-only. | Wait 1–5 seconds | [ ] | |
| A4 | Robinhood accepts | Row moves to Submitted group. Ticket switches to read-only confirmation: Type, Qty, TIF, Order ID. Modify and Cancel buttons appear. | Wait for fill | [ ] | |
| A5 | Market order fills | Row moves to Filled group. Confirmation shows Fill Price and filled qty. For this buy: Stop Loss form appears below confirmation with $ and % pre-filled from fill price. Risk amount shown. Submit Stop Loss button visible. | Review stop loss values | [ ] | |
| A6 | Verify stop loss $ | Stop $ = fill price × 0.92, rounded to 2 decimals. E.g. if fill = $150.00, stop = $138.00. | Check the math | [ ] | |
| A7 | Verify stop loss Risk | Risk = filled qty × (fill price - stop $). E.g. 2 shares × ($150 - $138) = $24. | Check the math | [ ] | |
| A8 | Click Submit Stop Loss | New stop loss row appears in Submitting group (SELL side). Entry ticket shows SL confirmation section replacing the form. | Wait for stop loss to submit | [ ] | |
| A9 | Stop loss submitted | Stop loss row moves to Submitted group. Ticket shows SL Stop, SL Qty, SL ID. Cancel Stop Loss button appears. | Done with this order | [ ] | |
| A10 | Move to next order | Click the next row in the Staged group. | Continue to Order 2 | [ ] | |

### Order 2: Limit Buy (resting order, then modify)

| # | Step | What you see | What you do | Pass/Fail | Notes |
|---|------|-------------|-------------|-----------|-------|
| B1 | Click the next staged row | Ticket loads with STAGED status, editable form. | Change Type to Limit | [ ] | |
| B2 | Change Type to Limit | Limit $ field appears below Cost/Units, pre-filled with current price. | Set limit a few cents below market | [ ] | |
| B3 | Adjust limit with stepper | Each click ±$0.25, never ending in 0 or 5. Set price below market so it doesn't fill immediately. | Verify stepper behavior | [ ] | |
| B4 | Click Submit Order, confirm | Row moves to Submitting → Submitted. Ticket shows read-only confirmation with limit price. Modify and Cancel buttons. | Wait — order is resting | [ ] | |
| B5 | Click Modify | Row reverts to Staged group. Ticket becomes editable again with previous values. | Change the limit price | [ ] | |
| B6 | Change limit price | Use stepper or type a new value. | Re-submit | [ ] | |
| B7 | Click Submit Order, confirm | Row moves to Submitting → Submitted again with new price. | Wait or cancel | [ ] | |
| B8 | Click Cancel | Row moves to Cancelled group. Ticket shows cancelled confirmation. No action buttons. | Done with this order | [ ] | |
| B9 | Move to next order | Click the next row in the Staged group. | Continue to Order 3 | [ ] | |

### Order 3: Market Sell — Close Existing Position (no stop loss)

> **Note:** Robinhood does not support short selling. This scenario only works if you already own shares of the symbol. If you don't own shares, the sell order will fail. SHORT signals are not actionable via equity sells — they will be handled via options (buy puts) in a future milestone.

| # | Step | What you see | What you do | Pass/Fail | Notes |
|---|------|-------------|-------------|-----------|-------|
| C1 | Buy a small position first (or use one from Order 1) | You own shares of a symbol from a previous fill. | Find the sell intent in the queue, or stage one manually | [ ] | |
| C2 | Click the sell row | Ticket loads: symbol, price, SELL badge, STAGED. Form editable. | Review — no stop loss section should be visible | [ ] | |
| C3 | Verify no stop loss | Stop Loss section does NOT appear (sells don't get stop loss). | Set qty to ≤ shares you own | [ ] | |
| C4 | Click Submit Order, confirm | Row moves to Submitting → Submitted → Filled. Confirmation shows fill price. | Verify no stop loss form after fill | [ ] | |
| C5 | Verify no stop loss after fill | Stop Loss section still does NOT appear for sell orders. | Done — move to next | [ ] | |

### Order 4: Failed Order (error handling)

| # | Step | What you see | What you do | Pass/Fail | Notes |
|---|------|-------------|-------------|-----------|-------|
| D1 | Select a staged buy intent | Ticket loads, editable. | Set quantity to an invalid value | [ ] | |
| D2 | Set qty to 0 or a very large number | Quantity field shows the invalid value. | Submit | [ ] | |
| D3 | Click Submit Order, confirm | Row moves to Submitting, then to Failed. | Click the failed row | [ ] | |
| D4 | Click the failed row | Ticket shows error section with red icon, error message, and retryable indicator. Form is editable. Retry button visible (if retryable). | Read the error | [ ] | |
| D5 | Fix the issue | Set quantity to a valid value. | Click Retry | [ ] | |
| D6 | Click Retry | Row moves to Submitting → Submitted → Filled (if the fix worked). | Verify the order fills | [ ] | |
| D7 | If stop loss appears | For buy orders that fill, stop loss form appears. Place or skip. | Done | [ ] | |

### Order 5: Stop Market Buy with GTC (advanced type)

| # | Step | What you see | What you do | Pass/Fail | Notes |
|---|------|-------------|-------------|-----------|-------|
| E1 | Select a staged buy intent | Ticket loads, editable. | Change to Stop Mkt | [ ] | |
| E2 | Change Type to Stop Mkt | Stop $ field appears, pre-filled with current price. | Set stop above market | [ ] | |
| E3 | Set stop price above market | Use stepper to set price a few cents above current. | Change TIF to GTC | [ ] | |
| E4 | Change TIF to GTC | GTC pill active. | Submit | [ ] | |
| E5 | Click Submit Order, confirm | Row moves to Submitting → Submitted. Order rests as a stop market buy with GTC. | Wait or cancel | [ ] | |
| E6 | Click Cancel (if not triggered) | Row moves to Cancelled. | Done | [ ] | |

### Wrap-up

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| W1 | Verify all processed orders are in the correct final group | Filled orders in Filled, cancelled in Cancelled, etc. | [ ] | |
| W2 | Verify stop loss orders appear as separate rows | Stop loss intents have SELL side and are linked to their entry | [ ] | |
| W3 | Close out all test positions | Sell any shares bought during testing to avoid overnight holdings | [ ] | |
| W4 | Cancel any resting stop loss orders | Clean up so no unexpected triggers tomorrow | [ ] | |

---

# Part 3: Permutation Scenarios

These are targeted tests for specific combinations. Run them if time permits or if a specific permutation is suspect. Each one references the lifecycle stages from Part 1.

## 6. Limit Buy — Day — Regular Hours

**Lifecycle: STAGED → SUBMITTING → SUBMITTED → FILLED (or CANCELLED)**

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 6.1 | Select staged buy, change Type to Limit | Limit $ field appears, defaulted to current price | [ ] | |
| 6.2 | Set limit at or near market | Use stepper — verify $0.25 increments, no round endings | [ ] | |
| 6.3 | Submit and confirm | Moves to SUBMITTING → SUBMITTED | [ ] | |
| 6.4 | Wait for fill | If price hits limit → FILLED; stop loss form appears with fill price | [ ] | |
| 6.5 | Or cancel if not filled | Click Cancel → CANCELLED | [ ] | |

## 7. Limit Sell — Day — Regular Hours (close existing position)

> **Note:** Only works if you already own shares. Robinhood does not support short selling.

**Lifecycle: STAGED → SUBMITTING → SUBMITTED → FILLED (or CANCELLED)**

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 7.1 | Select staged sell (for a symbol you own), change Type to Limit | Limit $ field appears, defaulted to current price | [ ] | |
| 7.2 | Set limit above market | Order will rest until price rises | [ ] | |
| 7.3 | Submit and confirm | Moves to SUBMITTING → SUBMITTED | [ ] | |
| 7.4 | Wait for fill or cancel | No stop loss section (sell order) | [ ] | |

## 8. Stop Market Buy — GTC — Regular Hours

**Lifecycle: STAGED → SUBMITTING → SUBMITTED → FILLED (or CANCELLED)**

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 8.1 | Select staged buy, change Type to Stop Mkt | Stop $ field appears, defaulted to current price | [ ] | |
| 8.2 | Set stop above market | Buy stop triggers when price rises to stop level | [ ] | |
| 8.3 | Change TIF to GTC | GTC pill active | [ ] | |
| 8.4 | Submit and confirm | Order rests as stop market buy, GTC | [ ] | |
| 8.5 | Wait for trigger or cancel | If triggered → becomes a market buy → FILLED. Stop loss form appears. | [ ] | |

## 9. Stop Limit Buy — GTC — Extended Hours

**Lifecycle: STAGED → SUBMITTING → SUBMITTED → FILLED (or CANCELLED)**

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 9.1 | Select staged buy, change Type to Stop Lmt | Both Limit $ and Stop $ fields appear, both defaulted to current price | [ ] | |
| 9.2 | Set stop above market, limit at or above stop | When stop triggers, a limit order is placed at the limit price | [ ] | |
| 9.3 | Change TIF to GTC, Hours to Extended | GTC + Extended pills active | [ ] | |
| 9.4 | Submit and confirm | Order rests as stop limit buy, GTC, extended hours | [ ] | |
| 9.5 | Wait for trigger or cancel | Verify behavior during extended hours session | [ ] | |

## 10. Market Buy — Day — Extended Hours

**Lifecycle: STAGED → SUBMITTING → SUBMITTED → FILLED**

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 10.1 | Select staged buy, keep Mkt, change Hours to Extended | Extended pill active | [ ] | |
| 10.2 | Submit and confirm | Order routed for extended hours | [ ] | |
| 10.3 | Wait for fill | Verify fill during extended session; stop loss form appears | [ ] | |

## 11. Market Buy — Day — All Day Hours

**Lifecycle: STAGED → SUBMITTING → SUBMITTED → FILLED**

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 11.1 | Select staged buy, change Hours to All Day | All Day pill active | [ ] | |
| 11.2 | Submit and confirm | Order routed for all day hours | [ ] | |
| 11.3 | Wait for fill | Verify fill behavior | [ ] | |

---

# Part 4: Edge Cases and Invariants

## 12. Queue Management — Batch Remove

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 12.1 | Stage multiple intents, click Select all | All checkboxes checked | [ ] | |
| 12.2 | Click Clear | All checkboxes cleared | [ ] | |
| 12.3 | Check 2-3 rows, click Remove selected | Checked intents removed from store and queue | [ ] | |
| 12.4 | If selected ticket was removed | Ticket shows no-selection placeholder with "New manual order" button | [ ] | |

## 13. Queue — Group Expand/Collapse

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 13.1 | Click a group header | Group collapses; rows hidden; chevron points down (expand_more) | [ ] | |
| 13.2 | Click again | Group expands; rows visible; chevron points up (expand_less) | [ ] | |
| 13.3 | Collapse all, expand all | All groups respond independently | [ ] | |

## 14. Queue — Sorting Within Groups

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 14.1 | Stage buy and sell intents | BUY rows appear before SELL rows within each group | [ ] | |
| 14.2 | Stage intents at different times | Within same side, older intents (by createdAt) appear first | [ ] | |

## 15. Guardrail Warnings

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 15.1 | Set maxAllocationPercent to 10 in config | | [ ] | |
| 15.2 | Submit an order exceeding allocation | Confirm dialog shows allocation warning | [ ] | |
| 15.3 | Set maxUnits to 1 | | [ ] | |
| 15.4 | Submit an order exceeding unit cap | Confirm dialog shows unit warning | [ ] | |
| 15.5 | Reset config | Warnings no longer appear | [ ] | |

## 16. Account Number Redaction

| # | Location | Expected | Pass/Fail | Notes |
|---|----------|----------|-----------|-------|
| 16.1 | Order page scoreboard | `agentic ••••XXXX` (last 4 only) | [ ] | |
| 16.2 | Trading Settings dialog | Full account number visible | [ ] | |
| 16.3 | Order confirm dialog | Full account number visible | [ ] | |
| 16.4 | Order preview JSON | `••••XXXX` | [ ] | |
| 16.5 | Stop loss preview JSON | `••••XXXX` | [ ] | |

## 17. Price Stepper Behavior

| # | Field | Expected | Pass/Fail | Notes |
|---|-------|----------|-----------|-------|
| 17.1 | Limit $ up stepper | +$0.25 per click, hundredths never 0 or 5 | [ ] | |
| 17.2 | Limit $ down stepper | -$0.25 per click, hundredths never 0 or 5 | [ ] | |
| 17.3 | Stop $ up/down | Same behavior | [ ] | |
| 17.4 | Stop Loss $ up/down | Same behavior | [ ] | |
| 17.5 | Stop Loss % up/down | ±0.5% per click | [ ] | |

## 18. Stop Loss — Cancel and Re-place

| # | Step | Expected result | Pass/Fail | Notes |
|---|------|-----------------|-----------|-------|
| 18.1 | Have a filled entry with submitted stop loss | Stop loss in SUBMITTED state | [ ] | |
| 18.2 | Click Cancel Stop Loss | Stop loss → CANCELLED; stop loss form reappears on entry intent | [ ] | |
| 18.3 | Adjust and re-submit | New stop loss intent created and submitted | [ ] | |

---

# Page-Level Invariants

| # | Invariant | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| INV.1 | The order queue never shows a horizontal scrollbar | [ ] | Panel is 380px wide |
| INV.2 | The order ticket submit button is always visible without scrolling | [ ] | Form section is compact |
| INV.3 | The account number is never shown in full in any dashboard view | [ ] | Only in dialogs |
| INV.4 | Stop loss form only appears after entry fill, not during staging | [ ] | |
| INV.5 | Stop loss price is anchored to fill price, not live price | [ ] | |
| INV.6 | All price steppers increment by $0.25 and never produce round endings | [ ] | |
| INV.7 | Limit and stop price fields default to current price when first shown | [ ] | |
| INV.8 | Queue rows are sorted by direction (buy first) then createdAt within each group | [ ] | |
| INV.9 | Group headers expand/collapse on click | [ ] | |
| INV.10 | Failed orders show error details and retry button (if retryable) | [ ] | |
| INV.11 | Moving to the next order in the queue preserves the previous order's state | [ ] | |
| INV.12 | Stop loss intents appear as separate queue rows with SELL side | [ ] | |

---

## Findings Log

| # | Scenario | Finding | Severity | Status |
|---|----------|---------|----------|--------|
| | | | | |
