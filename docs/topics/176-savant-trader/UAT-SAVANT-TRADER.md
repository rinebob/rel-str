# Savant Trader UAT — Page-by-Page Feature Inventory

**Topic:** Savant Trader — Order Placement Refactor  
**Issue:** #212  
**Domain:** SAVANT-TRADER  
**Status:** IN PROGRESS  
**Last Updated:** 2026-08-30

---

## How to use this doc

This is a page-by-page inventory of the Savant Trader UI. For each page we record:

- **Route** — how to navigate there
- **Purpose** — what the page is for
- **What the user sees** — visible elements, data, and state
- **What the user can do** — all actions and interactions, with the expected result of each
- **Page-level invariants** — behavior that should hold regardless of the specific action

The goal is to provide a complete reference for manual acceptance testing. Findings should be logged against the relevant QA issue.

**Known gaps from #203b review (not UAT scenarios but tracked):**
- `signal-review.facade.spec.ts` was deleted (334 lines) with no replacement tests — test regression, pending
- Target exit staging obsolete (Robinhood doesn't allow simultaneous resting exit orders)
- SDS changes mixed into 203b commits — need commit split (user action)

---

## 1. Run Dashboard

**Route:** `/run-dashboard`  
**Component:** `pages/run-dashboard/dashboard.component.ts`  
**Purpose:** Monitor agent runs, trigger runs manually, and enter the signal review workflow.

| # | Section | Step / Action | Expected result | Pass/Fail | Notes |
|---|---------|--------------|-----------------|-----------|-------|
| 1.1 | Page load | Open `/run-dashboard` | Page title **"Savant Trader"** is shown with the `smart_toy` icon; the latest run loads | [x] | Removed: Enabled/Disabled badge (always enabled, no toggle needed) |
| 1.2 | Page load | Wait for initial load | Run status bar, run control card, metrics strip, and run history panel are all populated | [x] | |
| 1.3 | Header — Review Latest Signals | Click **Review Latest Signals** (`account_tree`) | The latest completed run is set as the active run in `GroupStore`; the app navigates to `/signal-review` | [x] | Fixed: button height matched to 32px |
| 1.4 | Header — Observation | Click **Observation** (`query_stats`) | The app navigates to `/rh-account-inquiry` | [x] | Fixed: button height matched to 32px to match Review Latest Signals |
| 1.5 | Header — Overview Sync | Hover the **Sync company overview** (`business`) icon, then click it | A tooltip appears on hover; the icon shows a spinner while the sync is in flight; on success a snackbar shows `Overview sync enqueued: {count} symbols`; on error a snackbar shows `Sync failed: {message}` | [x] | Fixed: added MatTooltipModule import so tooltips render |
| 1.6 | Header — Bars Backfill | Hover the **Backfill symbol data** (`download`) icon, then click it | A tooltip appears on hover; the backfill request is sent to the agent; no immediate success UI is shown unless an error is returned | [x] | Fixed: added MatTooltipModule import so tooltips render |
| 1.7 | Status Bar | Verify after page load | A `schedule` icon chip shows the **Last Run** timestamp (or **"Never"**); a status badge for the last run status is shown when one exists; a `touch_app`/`schedule` chip shows **Triggered By** (`manual`, `pdr`, `nightly`, or `—`); a `repeat` chip shows the **Schedule** summary with last and next scheduled run times | [x] | |
| 1.8 | Status Bar | Wait for a run to complete | The last run status badge updates to the terminal status | [x] | |
| 1.9 | Run Control — Run Now | Click **Run Now** (`play_arrow`) | The button disables and its label changes to **"Running…"**; a manual run is enqueued for the active run date; when the agent starts the run it appears in the history table with status `RUNNING` | [x] | |
| 1.10 | Run Control — Run Now | Wait for the manual run to finish | The **Run Now** button re-enables; the run status bar, metrics strip, and history table update to reflect the completed run | [x] | |
| 1.11 | Run Control — Refresh | Click the **Refresh** icon | The refresh icon is centered in the button; the agent status and run list are re-fetched; the run history, status bar, and metrics strip reflect the latest state | [x] | Fixed: icon centering with flex layout |
| 1.12 | Run Control — Trigger filter | Click each **Trigger** pill (`All`, `Manual`, `PDR`, `Nightly`) | The selected pill becomes visually active; the run history table updates to show only matching runs | [x] | |
| 1.13 | Run Control — Date filter | Click each **Date** pill (`Today`, `7 Days`, `All`) | The selected pill becomes visually active; the run history table updates to the matching date range | [x] | |
| 1.14 | Run Control — Status filter | Click each **Status** pill (`All`, `Running`, `Success`, `Partial`, `Failed`) | The selected pill becomes visually active; the run history table updates to show only matching statuses | [x] | |
| 1.15 | Run Control — Combined filters | Select a combination of trigger, date, and status | The run history table shows only runs matching all three selected filters | [x] | |
| 1.16 | Metrics Strip — no selection | Load the page and clear any run selection | Aggregate metrics show **Runs Loaded**, **Running** count, **Today** count, and the latest run summary | [x] | |
| 1.17 | Metrics Strip — selected run | Click a run row in the history table | The metrics strip switches to the selected run and shows **Status**, **Market Date**, **Symbols** (`processedCount / totalSymbols`), **Signals**, **Duration**, and **Trigger** | [x] | Fixed: row click now updates selectedRunId via runClicked output |
| 1.18 | Run History — row select | Click a run row | The clicked row is highlighted; the row's detail section expands (or collapses if it was already open); the run metrics strip switches to the selected run's data; the selected run is stored in the page's UI state | [x] | Fixed: added runClicked output to update metrics strip without navigating |
| 1.19 | Run History — row expand | Click the same row again | The detail collapses | [x] | |
| 1.20 | Run History — review signals | Click **Review Signals** (`manage_search`) on any run row | The selected run is set as the active run in `GroupStore`; the app navigates to `/signal-review`; the signal review page loads the symbols and signals for that run | [x] | |
| 1.21 | Run History — empty state | Apply filters that match nothing | Empty state appears with the `inbox` icon and the message *"No runs match the current filters"* | [x] | |
| 1.22 | Run History — PDR message received | When a PDR message is received from SA, a row appears in the run table showing **Running** status and details from the PDR message | [ ] | **FAIL / FEATURE GAP** — PDR-initiated runs are not surfaced in the UI when the message is received. Runs sometimes don't happen (e.g. 0800 intraday run missed today, unclear if 1000 run is going). User has no visibility into whether a scheduled run actually started. Needs design: should PDR message add a new row, or update an existing placeholder row? What data from the PDR message should be shown? |

### Page-level invariants

| # | Invariant | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| 1.23 | The dashboard loads the latest agent status, schedule, and run list automatically | [x] | |
| 1.24 | The metrics strip defaults to the latest completed run on first load | [x] | |
| 1.25 | Filters apply to the run history immediately | [x] | |
| 1.26 | "Run Now" does not queue a date range; it triggers a single manual run | [x] | |
| 1.27 | Navigating to signal review via any "Review" action sets the active run in `GroupStore` so the review page shows the correct symbols | [x] | |
| 1.28 | Empty state appears only when the filtered run list is empty, not when data is still loading | [x] | |
| 1.29 | Scheduled runs (PDR, nightly, intraday) that are expected but not yet started are visible or indicated | [ ] | **FAIL / FEATURE GAP** — no visibility into missed or pending scheduled runs |

---

## 2. Signal Review

**Route:** `/signal-review`  
**Component:** `pages/signal-review/signal-review.component.ts`  
**Purpose:** Review symbol-level signals for the active run, accept/reject/consider them, and stage accepted symbols as order intents.

| # | Section | Step / Action | Expected result | Pass/Fail | Notes |
|---|---------|--------------|-----------------|-----------|-------|
| 2.1 | Page load | Open `/signal-review` | Header shows **Back**, title **"Signal Review"** with `psychology` icon, total signal count, **Weekly (`W`)** and **Daily (`D`)** counts, **Long / Short** counts, timeframe/direction filter pills, status summary chips, pipeline actions, **Group** and **List** dropdowns, **Previous / Next** chevrons, show-all/signals-only toggle, expand/collapse toggle, and **Refresh** / **Fullscreen** icon buttons; the **List** dropdown defaults to **PRIMARY** | [x] | Fixed: default list filter changed from `ALL` to `PRIMARY` |
| 2.2 | Active Run Context | Verify after page load | `app-run-metrics-strip` displays the currently viewed run's **Status**, **Market Date**, progress, **Signals**, and **Duration** | [x] | |
| 2.3 | Groups Panel | Verify after symbols load | A list of expandable `mat-expansion-panel` groups is shown keyed by the selected dimension; each group header shows the group key, count of visible symbols, long/short counts, and an expand/collapse icon button | [x] | |
| 2.4 | Groups Panel — empty state | Load a run with no signals | Empty state appears with the `inbox` icon, the message *"No signals found for this date"*, and a hint to run the agent or select a different date | [x] | |
| 2.5 | Symbol Row | Verify a visible row | Each row shows the **Symbol** ticker, today's signal direction badges (`LONG`, `SHORT`), **Quick Charts** button (`bar_chart`), ACR actions (**Accept / Consider / Reject / Reset / Mark for Review**), symbol list actions, and symbol meta (name, sector, exchange, market-cap tier, beta, P/E); the expanded row shows `app-symbol-signal-history` | [ ] | **FAIL** — signal direction badges (dots) render inconsistently. Some symbols' badges never appear on initial load; revisiting the symbol later shows them (cached). Root cause: `loadSymbolsWithSignals` called twice (once from `setActiveRun`, once from `enterPage`), causing a race. Fix applied: `enterPage` now checks `symbolsLoading()` before reloading. Pending verification. |
| 2.6 | Quick Charts Panel | Verify after opening | A closable right-side panel shows `app-quick-charts` for the selected symbol; before selection a placeholder with the `bar_chart` icon and the text *"Select a symbol to view signal charts"* is shown | [x] | |
| 2.7 | Loading / Error States | Verify during load and on error | A spinner overlay is shown while symbols are loading; on error an `error_outline` icon, message, and **Retry** button are shown | [x] | |
| 2.8 | Header — Go back | Click **Back** | The app navigates to `/run-dashboard`; fullscreen mode is exited if active | [x] | |
| 2.9 | Header — Change grouping | Select `sector`, `industry`, or `market cap` from the **Group** dropdown | The groups panel re-renders with symbols grouped by the new dimension; the visible counts in each group header update; the currently selected quick-chart symbol remains selected if it is still visible | [x] | |
| 2.10 | Header — Change list filter | Select a saved symbol list or `ALL` from the **List** dropdown | The dropdown updates to the selected list; the groups panel shows only symbols in the selected list; counts and empty state update accordingly | [x] | |
| 2.11 | Header — Filter by timeframe and direction | Click a timeframe or direction pill | The selected pill becomes active; the visible signal count (`W` / `D`, long / short) updates; the groups panel shows only symbols with at least one signal matching the filters | [x] | |
| 2.12 | Header — Expand/collapse all | Click the **Expand all / Collapse all** toggle | All group panels simultaneously expand or collapse; the toggle icon changes to `unfold_less` / `unfold_more` | [x] | |
| 2.13 | Header — Show all symbols / signal symbols only | Click the toggle (`filter_list` / `filter_list_off`) | The toggle icon changes; the groups panel shows either all symbols in the active run or only those with at least one signal | [x] | Fixed: toggle button removed, default is signals-only |
| 2.14 | Symbol Row — Select symbol | Click a symbol row | The row expands to show its signal history; the row is visually marked as selected; the row scrolls into view if needed | [x] | |
| 2.15 | Symbol Row — Open quick charts | Click the **Quick Charts** (`bar_chart`) button | The quick charts panel opens on the right side; the selected symbol is loaded into `app-quick-charts`; the row is marked as the active chart symbol; the **Previous / Next** chevron buttons become enabled when the symbol is not the first/last visible symbol | [x] | |
| 2.16 | Header — Navigate quick charts | Click **Previous** / **Next** | The quick charts panel switches to the previous or next visible symbol; the newly selected symbol's row scrolls into view; navigation is disabled at the first and last visible symbols | [x] | Fixed: prev/next now follows grouped list order top-to-bottom instead of alphabetical |
| 2.17 | Quick Charts Panel — Close | Click to close the right-side panel | The panel collapses; the chart placeholder reappears; no symbol is marked as the active chart symbol | [ ] | **FAIL** — remove close button and all associated logic. No reason to ever close the charts panel; just click a new symbol. |
| 2.18 | Symbol Row — Accept symbol | Click **Accept** | For an actionable run, one or more `EquityOrderIntent`s are staged for the symbol in `OrderStagingStore`; the symbol's status changes to `ACCEPT`; the **Accept** count in the status summary chips increases; the **Order** button becomes enabled when at least one symbol is accepted; if the symbol is already accepted, re-accepting resets/clears the previous staged intent for that symbol | [ ] | **SKIP #205** — accept becomes toggle |
| 2.19 | Symbol Row — Consider symbol | Click **Consider** | The symbol's status changes to `CONSIDER`; the **Consider** count in the status summary chips increases; any previously staged order intent for the symbol is removed | [ ] | **SKIP #205** — CONSIDER removed |
| 2.20 | Symbol Row — Reject symbol | Click **Reject** | The symbol's status changes to `REJECT`; any staged order intent for the symbol is removed; the **Reject** count in the status summary chips increases | [ ] | **SKIP #205** — REJECT removed |
| 2.21 | Symbol Row — Reset symbol | Click **Reset** | The symbol's status returns to `PENDING`; any staged order intent for the symbol is removed; the status summary chips update | [ ] | **SKIP #205** — RESET removed (accept is toggle) |
| 2.22 | Symbol Row — Mark for review | Click **Mark for Review** | The symbol's status changes to `REVIEW`; the **Review** count increases; the symbol appears in the review-only view | [x] | Fixed: review button now toggles (click again to unflag), CSS highlighting works, symbol keys normalized to uppercase |
| 2.23 | Symbol Row — Add or remove from saved list | Use the symbol list actions | The symbol is added to or removed from the selected list; the list filter, if active, updates the visible symbols | [x] | |
| 2.24 | Symbol Row — Toggle PAST_SIGNALS monitor | Use the monitor list action | The symbol is added to or removed from the monitor list; the list filter updates if it is active | [ ] | **QUESTION** — PAST_SIGNALS vs Monitor naming. PAST_SIGNALS implies "all signals in the past" while Monitor implies "symbols I'm watching for future signals." Need to standardize on one name. Currently the Firestore list is named PAST_SIGNALS but the UI calls it Monitor. |
| 2.25 | Header — Clear review flags | Click **Clear review flags** (`playlist_remove`) | All symbols with status `REVIEW` are reset to `PENDING`; the **Review** count goes to zero; the action is disabled when the run is not actionable | [ ] | **FIX LATER** — button implementation doesn't fit with the others. Add to fix list. |
| 2.26 | Header — Go to Review | Click **Review** (`visibility`) | The app navigates to the review-only view of `/signal-review` filtered to `REVIEW` status | [x] | Fixed: removed clearDecisions() from setActiveRun so review flags persist across navigation |
| 2.27 | Header — Go to Order | Click **Order** (`shopping_cart`) | The app navigates to `/signal-order`; the button is disabled if no symbols are accepted or the run is not actionable | [x] | Fixed: removed clearDecisions() from setActiveRun so accepted decisions persist across navigation |
| 2.28 | Header — Go to Triage Report | Click **Report** (`assignment`) | The app navigates to `/signal-action-report` | [x] | |
| 2.29 | Header — Open Observation | Click **Observation** (`query_stats`) | The app navigates to `/rh-account-inquiry` | [x] | |
| 2.30 | Header — Refresh | Click the **Refresh** icon | The symbol and group data are re-fetched for the active run; loading, error, and empty states are shown appropriately | [x] | |
| 2.31 | Header — Toggle fullscreen | Click the **Fullscreen** icon | The page expands to or exits fullscreen layout; the icon changes between `fullscreen` and `fullscreen_exit` | [x] | |

### Page-level invariants

| # | Invariant | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| 2.32 | The active run from the run dashboard is used to load the symbol list | [x] | |
| 2.33 | Groups collapse/expand and do not interfere with scroll or selection state | [x] | |
| 2.34 | Filters and grouping update the visible rows immediately without a full page reload | [x] | |
| 2.35 | The **Order** button is disabled until at least one symbol is accepted and the run is actionable | [ ] | **SKIP #205** — mechanism changes |
| 2.36 | Accepting a symbol stages one or more `EquityOrderIntent`s for the symbol; rejecting/resetting removes them | [ ] | **SKIP #205** — mechanism changes |
| 2.37 | Quick chart navigation wraps/clamps at the first and last visible symbols | [ ] | Unclear wording — navigation clamps (disables) at first/last, doesn't wrap. Already covered by 2.16. |
| 2.38 | Row expansion displays historical signals for that symbol; selecting a new symbol scrolls it into view | [ ] | Redundant — the only way to select a symbol is clicking its row, which is already in view. Scroll-into-view matters for prev/next nav (2.16), not row click. |
| 2.39 | ACR actions are disabled when the run is not actionable | [x] | |

---

## 3. Signal Order

**Route:** `/signal-order`  
**Component:** `pages/signal-order/order.component.ts`  
**Purpose:** Review and manage staged order intents, edit order details, submit to the broker, and place stop-loss orders.

| # | Section | Step / Action | Expected result | Pass/Fail | Notes |
|---|---------|--------------|-----------------|-----------|-------|
| 3.1 | Page load | Open `/signal-order` | Header shows **Back**, title **"Signal Order"** with `account_balance` icon, **Scoreboard** (**Acct**, **Value**, **Alloc**, **Pos**, **Units**, **Cash**), **Settings** icon button, and **Re-authenticate Robinhood** (`sync_lock`) icon button | [x] | |
| 3.2 | Header — Go back | Click **Back** | The app navigates to `/signal-review`; the active run remains selected | [x] | |
| 3.3 | Header — Open trading settings | Click the **Settings** icon | The `trading-config-dialog` opens; the dialog loads the current trading config and account snapshot; changes to account, dollar amount, max units, and max allocation percent are persisted; closing the dialog refreshes the scoreboard and guardrail context | [x] | |
| 3.4 | Header — Re-authenticate Robinhood | Click the **Re-authenticate Robinhood** (`sync_lock`) icon | The icon begins spinning; the component calls the Robinhood re-auth endpoint; on success the account snapshot and broker status are refreshed; on failure an error snackbar is shown; the button is disabled while re-auth is in progress | [ ] | **NOTE** — `Re-auth failed: listen EADDRINUSE: address already in use 127.0.0.1:3456`. Likely because a local RH MCP session is already running on that port. Not a code bug — environment conflict. |
| 3.5 | Master-Detail Layout | Verify page layout | The left side shows `app-order-queue`; the right side shows `app-order-ticket` | [x] | |
| 3.6 | Order Queue | Verify after load | The queue shows a title with a total count badge; a batch actions bar with **Select all** and **Clear** links; a grouped list of order intents by status with each group labeled by count; each row shows a checkbox, **Source** badge (`signal_pipeline`, `manual`, or `position_management`), **Symbol**, **status badge**, **price**, **side**, **order type**, and **quantity**; rows are highlighted when selected; when no staged orders exist an empty state with the `inbox` icon and *"No staged orders"* is shown | [x] | |
| 3.7 | Order Queue — Select intent | Click a queue row | The row is highlighted; the order ticket loads the selected intent and its live price; the guardrail context is computed for the selected intent | [ ] | |
| 3.8 | Order Queue — Select all / clear | Click **Select all** or **Clear** | All visible queue row checkboxes become checked or unchecked; the **Remove selected** button appears or disappears accordingly | [x] | |
| 3.9 | Order Queue — Check/uncheck individual rows | Click a row checkbox | The row checkbox toggles without selecting the intent; the **Remove selected** button appears if at least one row is checked | [x] | |
| 3.10 | Order Queue — Remove selected | With one or more rows checked, click the **Remove selected** (`delete_outline`) icon | The checked intents are removed from `OrderStagingStore`; the queue and scoreboard update; the ticket shows the no-selection state if the removed intent was selected | [x] | |
| 3.11 | Order Ticket — New manual order | Click the **New manual order** (`add`) icon button | A new, blank `manual` order intent is created and staged; the new intent appears in the queue and is selected | [ ] | **FAIL / DEFERRED** — shows "manual orders coming soon" toast. Add to fix list (F3). |
| 3.12 | Order Ticket (No Selection) | Verify with no intent selected | The ticket shows the `pan_tool` icon with *"Select an order from the queue"* and a hint to click a row | [ ] | **FAIL / DEFERRED** — no-selection state shows but manual order button shows "coming soon" toast. Linked to F3. |
| 3.13 | Order Ticket (Selected) — Header | Select an intent and verify the ticket header | The header shows the **Symbol**, **Price** (current quote, or `—` if none), **Side** (`BUY` / `SELL`), **Status** badge, broker **Order ID** prefix if the order has been submitted, and the **New manual order** button | [x] | |
| 3.14 | Order Ticket (Selected) — Error display | Select an intent in `FAILED` state | An error message is shown along with a hint whether the error is retryable | [ ] | Cannot repro — no failed orders yet. Will revisit after placing orders. |
| 3.15 | Order Ticket (Selected) — Entry form | Verify editable entry form | The form shows a **Type** pill group (`Mkt` / `Limit` / `Stop Mkt` / `Stop Lmt`), **Qty** stepper input, **Limit $** stepper when type is `limit` or `stop_limit`, **Stop $** stepper when type is `stop_market` or `stop_limit`, inline **Cost** and **Units** stats, **TIF** pill group (`gfd` / `gtc`), and **Hours** pill group (`Regular` / `Extended` / `All Day`) | [x] | |
| 3.16 | Order Ticket (Selected) — Entry confirmation | Select an intent whose entry order is filled or submitted | The confirmation shows order type, qty, fill price (if filled), limit, TIF, and order ID | [ ] | Haven't placed orders yet — will revisit. |
| 3.17 | Order Ticket (Selected) — Stop loss form | Select a filled/submitted equity/ETF buy entry without a stop loss | The stop loss form shows a **$** stop price stepper, a **%** stop percent stepper (default 8%), and a **Risk** currency value | [ ] | Haven't placed orders yet — will revisit. |
| 3.18 | Order Ticket (Selected) — Stop loss confirmation | After a stop loss is placed or filled | The confirmation shows stop price, quantity, fill price (if filled), and order ID | [ ] | Haven't placed orders yet — will revisit. |
| 3.19 | Order Ticket (Selected) — Order Preview JSON | Verify when the entry is not filled | An **Order Preview** JSON block is shown | [x] | |
| 3.20 | Order Ticket (Selected) — Stop Loss Preview JSON | Verify when the entry is filled and a stop loss is not yet placed | A **Stop Loss Preview** JSON block is shown | [ ] | Haven't placed orders yet — will revisit. |
| 3.21 | Order Ticket (Selected) — Action buttons | Verify contextual buttons | The ticket shows **Submit Order** (primary, disabled if no account), **Retry** (for failed, retryable orders), **Modify** (for submitted orders), **Cancel** (for submitted orders), **Submit Stop Loss Order** (primary, for filled entries without a stop loss), **Cancel Stop Loss** (for submitted stop losses), and submitting spinners for entry and stop-loss states | [ ] | Haven't placed orders yet — will revisit. |
| 3.22 | Confirm Order Dialog | Verify dialog contents | The dialog shows the `warning_amber` title **"Confirm Order"**, summary rows (Symbol, Side, Order Type, Quantity, Limit Price, Stop Price, TIF, Market Hours, Account), guardrail warnings with severity `warning` or `block`, and **Cancel** / **Submit Order** buttons where Submit is disabled if any `block` warning exists | [ ] | Haven't placed orders yet — will revisit. |
| 3.23 | Entry form — Edit order type | Click a **Type** pill | The active pill changes to the selected order type; the available form fields update (limit price, stop price); the order preview updates | [x] | |
| 3.24 | Entry form — Edit quantity | Type in the **Qty** stepper | The input accepts positive integers only; non-numeric, decimal, or negative input is coerced to a whole number; the cost, units, and guardrail calculations update | [ ] | **FAIL** — letters and negative numbers can be entered in the field. They don't affect the model but shouldn't be rendered in the control. Add to fix list (F5). |
| 3.25 | Entry form — Step quantity | Click the **Qty** up/down arrows | The quantity increases or decreases by one share; the cost, units, and guardrails recalculate | [x] | |
| 3.26 | Entry form — Edit limit price | Use the **Limit $** stepper | The limit price updates; the order preview and guardrail context update | [ ] | **FAIL** — (1) default value is 0, should default to current price (F4). (2) field too narrow, can't type full price (F6). |
| 3.27 | Entry form — Edit stop price (entry stop) | Use the **Stop $** stepper | The entry stop price updates; the order preview updates | [ ] | **FAIL** — (1) default value is 0, should default to current price (F4). (2) field too narrow (F6). |
| 3.28 | Entry form — Select TIF | Click a **TIF** pill | The active pill changes to `gfd` (Day) or `gtc` (GTC); the order preview updates | [x] | |
| 3.29 | Entry form — Select market hours | Click an **Hours** pill | The active pill changes to `regular_hours`, `extended_hours`, or `all_day_hours`; the order preview updates | [x] | |
| 3.30 | Stop loss form — Edit stop loss price | Use the **$** stop price stepper | The stop loss price updates; the percent field stays in sync relative to the entry price; the risk value recalculates | [ ] | **FAIL** — field too narrow (F6). Haven't placed orders yet for full test. |
| 3.31 | Stop loss form — Edit stop loss percent | Use the **%** stop percent stepper | The percent updates; the stop loss price recalculates from the entry price; the risk value recalculates | [ ] | Haven't placed orders yet — will revisit. |
| 3.32 | Action buttons — Submit order | Click **Submit Order** | The order-confirm dialog opens with order summary and guardrail warnings; if the user confirms and no `block` warning exists, `OrderStagingStore.submitIntent` is called; the intent status moves through `SUBMITTING` to `SUBMITTED` or `FAILED`; on success the queue row status updates, a broker order ID is recorded, and the account snapshot refreshes; on failure the error display appears with retry guidance | [ ] | Haven't placed orders yet — will revisit. |
| 3.33 | Action buttons — Retry failed order | Click **Retry** on a failed, retryable order | `OrderStagingStore.retryIntent` is called; the status returns to `SUBMITTING` and then to `SUBMITTED` or `FAILED`; the queue and ticket update accordingly | [ ] | Haven't placed orders yet — will revisit. |
| 3.34 | Action buttons — Modify submitted order | Click **Modify** on a submitted order | `OrderStagingStore.modifyIntent` is called; the broker attempts to modify the live order; the intent and queue update with the result | [ ] | Haven't placed orders yet — will revisit. |
| 3.35 | Action buttons — Cancel submitted order | Click **Cancel** on a submitted order | `OrderStagingStore.cancelIntent` is called; the broker attempts to cancel the live order; on success the intent status moves to `CANCELLED`; the account snapshot refreshes | [ ] | Haven't placed orders yet — will revisit. |
| 3.36 | Action buttons — Place stop loss order | Click **Submit Stop Loss Order** | A new sell `stop_market` or `stop_limit` `EquityOrderIntent` is created; `OrderStagingStore` submits the stop loss order; on success the stop loss confirmation appears and the stop loss order ID is recorded; the stop-loss quantity matches the filled entry quantity | [ ] | Haven't placed orders yet — will revisit. |
| 3.37 | Action buttons — Cancel submitted stop loss | Click **Cancel Stop Loss** | `OrderStagingStore.cancelIntent` is called for the stop loss; the stop loss status moves to `CANCELLED`; the ticket returns to the stop-loss form state | [ ] | Haven't placed orders yet — will revisit. |
| 3.38 | Confirm Order Dialog — Confirm via dialog | Click **Submit Order** or **Cancel** in the confirm dialog | If **Submit Order** is clicked and not blocked, the order is submitted; if **Cancel** is clicked, the dialog closes and the ticket remains in its current state | [ ] | Haven't placed orders yet — will revisit. |

### Page-level invariants

| # | Invariant | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| 3.39 | The queue is grouped by `OrderIntentStatus` and ordered so the most actionable intents are accessible | [ ] | **FAIL** — (1) Need signal date in the order and group by date (F7). (2) All intents show "staged" status — may not be necessary unless other statuses appear after placing orders. |
| 3.40 | Selecting an intent always loads its price and guardrail context | [x] | |
| 3.41 | The scoreboard reflects the canonical Robinhood account snapshot, not local intent state | [ ] | Unclear what "local intent state" means here. Scoreboard reads from Robinhood account snapshot — need to verify after placing orders. |
| 3.42 | The account snapshot refreshes when an intent status changes to `FILLED`, `CANCELLED`, `FAILED`, or terminal | [ ] | Haven't placed orders yet — will revisit. |
| 3.43 | Quantity is always a positive whole share; zero or invalid quantities cannot be submitted | [ ] | Haven't placed orders yet — will revisit. |
| 3.44 | Guardrails are side-aware: buys check allocation/cash; sells check available position/exposure | [ ] | Haven't placed orders yet — will revisit. |
| 3.45 | A stop loss order can only be placed for a filled equity/ETF buy entry and uses the filled quantity | [ ] | Haven't placed orders yet — will revisit. |
| 3.46 | The confirm dialog blocks submission if any guardrail has severity `block` | [ ] | Haven't placed orders yet — will revisit. |
| 3.47 | Broker order IDs are recorded in `intent.result.orderId` after successful submission | [ ] | Haven't placed orders yet — will revisit. |

---

## 4. Chart Review

**Route:** `/chart-review`  
**Component:** `pages/chart-review/chart-review.component.ts`  
**Purpose:** A master-detail chart review page for triaging symbols with current-run signals or for ad-hoc chart browsing.

| # | Section | Step / Action | Expected result | Pass/Fail | Notes |
|---|---------|--------------|-----------------|-----------|-------|
| 4.1 | Page load | Open `/chart-review` | The header (`review-header`) shows **Back**, **Signal History** (`history`), and **Observation** (`query_stats`) buttons; for the active symbol it shows **Accept / Watch / Reject** circular ACR buttons, the **Symbol**, company name (if loaded), and a **reason** tag (`Queued for review` or `Manual chart`); if no symbol is active it shows the **"Review"** title with `psychology` icon; the header also shows a viewport mode toggle (`filter_alt` / `list`), a **List** dropdown, **New symbols** (`new_releases`) icon button, **Order** (`shopping_cart`) button with accepted count, and a manual symbol input with **Load chart** (`trending_up`) button | [ ] | |
| 4.2 | Active Run Context | Verify after page load | `app-run-metrics-strip` is shown in `signals` mode with the viewed run's metrics | [ ] | |
| 4.3 | Master-Detail Layout | Verify page layout | The left side shows `app-signal-list`; the right side shows `app-signal-detail` | [ ] | |
| 4.4 | Signal List | Verify the left panel | The panel shows a title and count; for a manual symbol it shows **All / D / W** timeframe filter pills; a **Collapse sidebar** (`chevron_left`) button; a list of symbols with direction icon (`arrow_upward` / `arrow_downward`), symbol, `NEW` chip for newly added symbols, and recent signal trail; history rows show date, signal type, timeframe, and status; empty state shows *"Enter a symbol above to review"* | [ ] | |
| 4.5 | Signal Detail | Verify the right panel | `app-chart-toolbar` shows interval, range, zoom, layout, fullscreen, log scale, and indicator controls; `app-symbol-list-actions` is present; the chart area shows a loading spinner while data is fetched, a **Triple chart layout** (`W` top-left, `M` bottom-left, `D` right) or **Single chart layout**, `app-flex-chart` with crosshair sync, and an empty state *"Enter a symbol to view charts"* | [ ] | |
| 4.6 | Header — Go back to signal review | Click **Back** | The app navigates to `/signal-review` | [ ] | |
| 4.7 | Header — Go to signal history | Click the **Signal History** (`history`) icon | The app navigates to `/signal-history` for the active symbol | [ ] | |
| 4.8 | Header — Open observation dashboard | Click the **Observation** (`query_stats`) icon | The app navigates to `/rh-account-inquiry` | [ ] | |
| 4.9 | Header — Accept the active symbol | Click **Accept** | `SignalReviewFacade.acceptSymbol` is called; the symbol is staged as an order intent if the run is actionable; the viewport advances to the next symbol | [ ] | **SKIP #205** — ACR buttons moving to toolbar |
| 4.10 | Header — Watch the active symbol | Click **Watch** | `TriageStore.setScreeningStatus` sets the symbol to `WATCH`; the viewport advances to the next symbol | [ ] | **SKIP #205** — WATCH removed, Monitor in toolbar |
| 4.11 | Header — Reject the active symbol | Click **Reject** | `SignalReviewFacade.rejectSymbol` is called; any staged order intent for the symbol is removed; the viewport advances to the next symbol | [ ] | **SKIP #205** — REJECT removed |
| 4.12 | Header — Toggle viewport mode | Click the viewport mode toggle (`filter_alt` / `list`) | `signals` mode shows the current-run review queue; `browse` mode shows all symbols from the selected list; the active symbol and manual symbol are cleared on mode change | [ ] | |
| 4.13 | Header — Change the list filter | Select a list from the **List** dropdown | The viewport updates to symbols in the selected list; the manual symbol is cleared | [ ] | |
| 4.14 | Header — Find newly added symbols | Click the **New symbols** (`new_releases`) icon | A dialog opens to find symbols added to `savant-trader/data/symbols` in the last N days; selected symbols are marked for review and added to the left panel; the first newly added symbol becomes the active symbol | [ ] | |
| 4.15 | Header — Go to signal order | Click the **Order** (`shopping_cart`) button | The app navigates to `/signal-order` and stages any accepted symbols; the button is disabled if no symbols are accepted or the run is not actionable | [ ] | |
| 4.16 | Header — Enter a manual symbol | Type a symbol in the manual input and press Enter or click the **Load chart** (`trending_up`) button | The symbol is loaded and shown in the chart detail; the symbol is converted to uppercase and trimmed | [ ] | |
| 4.17 | Signal List — Select symbol | Click a row in the left panel | The selected symbol becomes active; its chart and signal history load in the detail panel; for manual mode, the timeframe filter (`All` / `D` / `W`) updates the visible signals | [ ] | |
| 4.18 | Signal List — Navigate previous / next symbol | Click the previous/next chevrons | The active symbol moves to the previous or next symbol in the viewport; the chart and history update; navigation is clamped at the first and last symbols | [ ] | |
| 4.19 | Signal List — Collapse / expand sidebar | Click the **Collapse sidebar** (`chevron_left`) button | The left signal list collapses to a `chevron_right` button; the chart detail area expands to fill the space | [ ] | |
| 4.20 | Chart Toolbar — Add active symbol to list or monitor it | Use `app-symbol-list-actions` | The active symbol can be added to or removed from saved lists; toggling `PAST_SIGNALS` adds or removes the monitor | [ ] | |
| 4.21 | Chart Toolbar — Change chart interval and range | Select an interval or range | The active chart (`D` / `W` / `M`) updates to the selected interval; the visible date range changes to the selected range | [ ] | |
| 4.22 | Chart Toolbar — Toggle zoom toolbar, layout, fullscreen, and log scale | Click the toolbar buttons | The chart toolbar shows/hides zoom controls; the layout switches between single and triple chart; fullscreen toggles the page-level fullscreen state; log scale toggles the y-axis log scale | [ ] | |
| 4.23 | Chart Toolbar — Toggle technical indicators | Select indicators | Selected indicators are overlaid on the active chart; `activeChartIndicatorOptions` and `activeSelectedIndicatorIds` update | [ ] | |

### Page-level invariants

| # | Invariant | Pass/Fail | Notes |
|---|-----------|-----------|-------|
| 4.24 | The active run from signal review is used when the viewport is in `signals` mode | [ ] | |
| 4.25 | ACR actions are disabled when the run is not actionable | [ ] | **SKIP #205** — mechanism changes |
| 4.26 | Accepting a symbol from chart review also stages an order intent and updates the accepted count | [ ] | **SKIP #205** — mechanism changes |
| 4.27 | The viewport auto-selects the first symbol on load | [ ] | |
| 4.28 | Manual symbols are loaded without requiring an active run | [ ] | |
| 4.29 | The chart detail loads historical bar data and renders `app-flex-chart` with syncfusion | [ ] | |
| 4.30 | Triple layout crosshairs are synced across the three panes | [ ] | |

---

## Fix List (Post-UAT)

| # | Item | Notes |
|---|------|-------|
| F1 | Rename PAST_SIGNALS → Monitor | The Firestore list constant and all references should use "Monitor" to match the UI. PAST_SIGNALS implies historical signals, but the list is for symbols to watch for future signals. |
| F2 | Redesign "Clear review flags" button (2.25) | Current implementation doesn't fit with the other header buttons. Needs redesign. |
| F3 | Implement manual order creation (3.11, 3.12) | Currently shows "manual orders coming soon" toast. Need dialog to create a blank manual order. |
| F4 | Default limit/stop prices to current price (3.26, 3.27) | Limit and stop fields default to 0. Should default to the current price so user doesn't have to manually enter. |
| F5 | Filter non-numeric/negative input in Qty field (3.24) | Letters and negative numbers can be typed in the qty stepper. They don't affect the model but shouldn't be rendered in the control. |
| F6 | Widen limit/stop fields — put each on its own line (3.26, 3.27, 3.30) | Fields are too narrow to type full price. Each should be on its own line. Will be converted to cards next, so need predictable width. |
| F7 | Add signal date to order, group queue by date (3.39) | Queue currently groups by status only. Need signal date in the order and grouping by date. |
| F8 | Rename "intent" → "order ticket" throughout | "Intent" is unnecessary jargon. The thing is just an order that hasn't been placed yet. Use "order ticket" or just "order." |

---

## Next page

TBD
