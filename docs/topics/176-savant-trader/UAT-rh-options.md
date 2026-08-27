# User Acceptance Testing — RH & Options

**Status:** In Progress
**Created:** 2026-08-26
**Tester:** bob
**App:** rel-str (Savant Trader + Options)

## Process

1. Start dev server (`npm start`) and open the app in the browser
2. For each flow below, execute the test steps and mark the result
3. For any FAIL, note what happened vs what was expected
4. Create triage issues for bugs
5. Fix and re-test until all flows PASS
6. Sign off when complete

## Legend

- [ ] = Not tested
- [x] = PASS
- [!] = FAIL (note what happened)
- [~] = BLOCKED (note why — e.g., no data, no RH auth, market closed)

---

## A. Run Dashboard (`/run-dashboard`)

### A1. View Agent Status and Schedule
- [ ] Navigate to Run Dashboard
- [ ] Agent status displays (running/idle)
- [ ] Last run time and type display (nightly/pdr/manual)
- [ ] Next scheduled run times display
- [ ] Run metrics strip displays (signals generated, symbols processed)

### A2. Trigger Manual Run
- [ ] Click "Trigger Manual Run" button
- [ ] System enqueues a manual run
- [ ] Run status updates in real-time
- [ ] Run appears in run history panel

### A3. Review Run History
- [ ] Run history panel loads with recent runs
- [ ] Click on a specific run to view details
- [ ] Run metrics display (signals, symbols processed, status)
- [ ] Click "Review Signals" navigates to signal review for that run

### A4. Navigate to Signal Review
- [ ] Click "Go to Signal Review" button
- [ ] System pre-seeds active run from latest completed run
- [ ] Navigates to `/signal-review` with run context

### A5. Trigger Overview Sync
- [ ] Click "Sync Overview" button
- [ ] Snackbar confirmation displays with symbols enqueued count

---

## B. Signal Review (`/signal-review`)

### B1. Load and Filter Signals
- [ ] Navigate to Signal Review
- [ ] Symbols with signals from active run load
- [ ] Select group dimension (Sector/Industry/Market Cap) — groups update
- [ ] Apply list filter (PRIMARY/SECONDARY/NEUTRAL/AVOID/HIDE/PAST_SIGNALS/ALL) — list updates
- [ ] Apply timeframe filter (Daily/Weekly/All) — filter updates
- [ ] Apply direction filter (Long/Short/All) — filter updates

### B2. Expand/Collapse Groups
- [ ] Click "Expand All" — all groups expand, signal history preloads
- [ ] Click "Collapse All" — all groups collapse
- [ ] Click individual group header — toggles expand/collapse

### B3. Review Individual Symbol
- [ ] Click on a symbol row to select it
- [ ] Signal detail panel displays with chart
- [ ] Signal history for the symbol displays
- [ ] Toggle quick charts panel — panel shows/hides

### B4. Make Signal Decisions
- [ ] Click "Mark for Review" — status changes to REVIEW
- [ ] Click "Accept" — status changes to ACCEPT (persists to Firestore)
- [ ] Click "Consider" — status changes to CONSIDER
- [ ] Click "Reject" — status changes to REJECT (persists to Firestore)
- [ ] Click "Watch" — adds to PAST_SIGNALS list
- [ ] Click "Reset" — status clears back to PENDING
- [ ] Status counts in header update after each action

### B5. Manage Symbol Lists
- [ ] Click list toggle buttons (PRIMARY, SECONDARY, etc.)
- [ ] Symbol added/removed from list
- [ ] Firestore updates with list membership

### B6. Navigate Between Symbols
- [ ] Click "Previous" — moves to previous visible symbol, scrolls into view
- [ ] Click "Next" — moves to next visible symbol, scrolls into view
- [ ] Quick chart updates to selected symbol

### B7. Clear Review Flags
- [ ] Click "Clear Review Flags" button
- [ ] All REVIEW status flags cleared from queue
- [ ] Status counts update in header

### B8. Stage Accepted Intents
- [ ] Have at least one ACCEPT decision
- [ ] Click "Stage Accepted" button
- [ ] System converts ACCEPT decisions to order intents
- [ ] Navigates to `/signal-order` page

### B9. Navigate to Triage Report
- [ ] Click "Go to Triage Report" button
- [ ] Navigates to `/signal-action-report`

### B10. Toggle Fullscreen
- [ ] Click fullscreen toggle
- [ ] App enters fullscreen mode
- [ ] Click again — exits fullscreen

---

## C. Chart Review (`/chart-review`)

### C1. Load Review Queue
- [ ] Navigate to Chart Review
- [ ] Symbols with REVIEW status load in sidebar
- [ ] First symbol auto-selects for chart display
- [ ] Chart renders with signal overlays

### C2. Review Queue Mode Navigation
- [ ] Select symbol from review queue sidebar
- [ ] Chart updates with signals overlay
- [ ] Signal detail panel displays
- [ ] Click "Accept" — accepts signal, queue advances to next
- [ ] Click "Watch" — watches signal, queue advances
- [ ] Click "Reject" — rejects signal, queue advances
- [ ] Queue auto-advances correctly

### C3. Browse Mode (Manual Symbol)
- [ ] Toggle to "Browse" mode
- [ ] Enter symbol manually (e.g., AAPL)
- [ ] Press Enter — chart loads
- [ ] Historical signals display on chart
- [ ] Browse does not affect review queue

### C4. Viewport Mode Toggle
- [ ] Toggle between "Signals" and "Browse" modes
- [ ] Signals mode shows only REVIEW status symbols
- [ ] Browse mode allows manual symbol entry

### C5. Add New Symbols
- [ ] Click "Add Symbols" button
- [ ] New symbols dialog opens
- [ ] Enter symbols (comma-separated)
- [ ] System adds symbols to review queue
- [ ] Newly added symbols appear in viewport

### C6. Viewport List Selection
- [ ] Select viewport list from dropdown (Newly Added, Unbackfilled, etc.)
- [ ] Review queue filters by selected list

### C7. Stage Accepted Intents (from Chart Review)
- [ ] Have at least one ACCEPT decision
- [ ] Click "Stage Accepted" button
- [ ] System converts ACCEPT decisions to order intents
- [ ] Navigates to `/signal-order`

### C8. Navigate Back to Dashboard
- [ ] Click "Back to Dashboard" button
- [ ] Navigates to `/run-dashboard`

---

## D. Signal Order (`/signal-order`)

### D1. Load Staged Intents
- [ ] Navigate to Signal Order
- [ ] Non-terminal order intents load from Firestore
- [ ] Intents grouped by status display correctly
- [ ] Intent count displays in header

### D2. Select Intent for Review
- [ ] Click on an intent in the order queue
- [ ] Intent details display in order ticket panel
- [ ] Order parameters display (symbol, side, quantity, price, etc.)

### D3. Configure Order Intent
- [ ] Select an intent
- [ ] Modify order parameters in order ticket
- [ ] Click "Update" — changes save to Firestore
- [ ] Updated values reflect in queue

### D4. Submit Order to Robinhood
- [ ] Select a STAGED or READY intent
- [ ] Click "Submit" button
- [ ] Order confirmation dialog opens
- [ ] Order details display in dialog
- [ ] Click "Confirm" — submission begins
- [ ] Intent status transitions to SUBMITTING
- [ ] Intent status transitions to SUBMITTED or FAILED
- [ ] Result displays in order queue

### D5. Retry Failed Order
- [ ] Have a FAILED intent
- [ ] Click "Retry" button
- [ ] System re-submits with same ref_id
- [ ] Intent status transitions to SUBMITTING
- [ ] Updated status displays in queue

### D6. Cancel Order
- [ ] Have a SUBMITTED intent
- [ ] Click "Cancel" button
- [ ] System calls cancel_equity_order
- [ ] Intent status transitions to CANCELLED
- [ ] Updated status displays in queue

### D7. Remove Intent
- [ ] Select an intent
- [ ] Click "Remove" button
- [ ] Intent deleted from Firestore
- [ ] Intent removed from queue

### D8. Batch Remove Intents
- [ ] Select multiple intents (checkboxes)
- [ ] Click "Remove Selected" button
- [ ] All selected intents deleted from Firestore
- [ ] All selected intents removed from queue

### D9. Reconcile Stuck Order
- [ ] Have an intent stuck in SUBMITTING status
- [ ] System automatically calls reconcileOrder
- [ ] Intent status updates based on actual broker state
- [ ] Reconciled status displays in queue

### D10. Navigate Back to Signal Review
- [ ] Click "Back" button
- [ ] Navigates to `/signal-review`

---

## E. Signal Action Report (`/signal-action-report`)

### E1. Load Report
- [ ] Navigate to Signal Action Report
- [ ] Decisions for default date range (last 30 days) load
- [ ] Table displays with columns (date, symbol, status, source, notes)

### E2. Filter by Date Range
- [ ] Change start date using datepicker
- [ ] Change end date using datepicker
- [ ] Table reloads for new date range

### E3. Filter by Status
- [ ] Click status chips (ACCEPT, REJECT) to toggle
- [ ] Table filters by selected statuses
- [ ] Status counts in chips update

### E4. Export CSV
- [ ] Click "Export CSV" button
- [ ] CSV file downloads
- [ ] Filename format: `triage-report-{start}-to-{end}.csv`
- [ ] CSV contents include: date, symbol, status, source, notes

### E5. Navigate Back to Signal Review
- [ ] Click "Back" button
- [ ] Navigates to `/signal-review`

---

## F. RH Account Inquiry (`/rh-account-inquiry`)

### F1. Load Available Tools
- [ ] Navigate to RH Account Inquiry
- [ ] Available Robinhood MCP tools load in dropdown
- [ ] Default tool: get_accounts

### F2. Select Tool
- [ ] Select tool from dropdown (e.g., get_equity_positions)
- [ ] System rebuilds argument form for selected tool
- [ ] Required and optional arguments display

### F3. Configure Tool Arguments
- [ ] Fill in required arguments (account_number, symbol, etc.)
- [ ] Account numbers auto-populate from get_accounts
- [ ] System validates required fields

### F4. Execute Tool
- [ ] Click "Execute" button
- [ ] System validates all required arguments
- [ ] Calls Robinhood MCP observation service
- [ ] Result displays in result panel
- [ ] Success/error status displays

### F5. View Raw Response
- [ ] Click "Show Raw" toggle
- [ ] Raw JSON response displays
- [ ] Click again — raw view hides

### F6. View Execution History
- [ ] Click "Show History" toggle
- [ ] Call history panel displays with timestamps
- [ ] Click history entry — reloads that execution

### F7. Pagination with Cursor
- [ ] Execute a paginated tool
- [ ] Cursor auto-populates with next page token
- [ ] Click "Execute" again — next page loads

### F8. Clear History
- [ ] Click "Clear History" button
- [ ] History panel clears

### F9. Redact Sensitive Fields
- [ ] Enter field names in "Extra Redact Fields" input
- [ ] Specified fields redacted from result display

---

## G. Signal History (`/signal-history`)

### G1. Load Historical Signals
- [ ] Navigate to Signal History
- [ ] Enter symbol (e.g., AAPL)
- [ ] Press Enter or click "Load"
- [ ] D/W/M chart data fetches
- [ ] ST-Zone and ST-Trend-Strength signals generate
- [ ] Signals display in table

### G2. Filter by Timeframe
- [ ] Select timeframe filter (All/Daily/Weekly/Monthly)
- [ ] Signal table filters

### G3. Filter by Direction
- [ ] Select direction filter (All/Long/Short)
- [ ] Signal table filters

### G4. Filter by Source
- [ ] Select source filter (All/Zone/Trend-Strength)
- [ ] Signal table filters

### G5. View Summary Counts
- [ ] Summary panel displays counts (total, long, short, zone, trend-strength)

### G6. Navigate Back to Dashboard
- [ ] Click "Back" button
- [ ] Navigates to `/run-dashboard`

---

## H. Option Chart (`/option-chart`)

### H1. Search by OCC ID
- [ ] Navigate to Option Chart
- [ ] Enter OCC contract ID (e.g., QQQ250117C00450000)
- [ ] Click "Search"
- [ ] Historical time-series for contract loads
- [ ] Chart displays with underlying price overlay, Greeks, volume/OI

### H2. Build Contract ID
- [ ] Use builder panel to construct OCC ID
- [ ] Enter symbol (e.g., QQQ)
- [ ] Select expiration date
- [ ] Select strike price
- [ ] Select type (Call/Put)
- [ ] OCC ID auto-generates
- [ ] Click "Search" — contract loads

### H3. Query Contract Catalog
- [ ] Enter symbol in builder
- [ ] Set expiration range (from/to dates)
- [ ] Select length buckets (DTE ranges)
- [ ] Click "Query Catalog"
- [ ] Available contracts load in table
- [ ] Multi-column sort works

### H4. Filter Catalog Results
- [ ] Apply type filter (Call/Put/All)
- [ ] Apply strike range (min/max)
- [ ] Apply expiration range
- [ ] Apply length bucket multi-select
- [ ] Apply expiration multi-select
- [ ] Table filters correctly

### H5. Sort Catalog Table
- [ ] Click column headers to sort
- [ ] Multi-column sort works (click to add, cycle to remove)
- [ ] Sort indicators display (priority, direction)

### H6. Select Contract from Catalog
- [ ] Click row in catalog table
- [ ] Contract chart loads
- [ ] Contract details and historical data display

### H7. Toggle Control Panel
- [ ] Click control panel toggle
- [ ] Panel opens/closes
- [ ] Chart expands when panel closed

### H8. View Contract Details
- [ ] Contract metadata displays (symbol, expiration, strike, type)
- [ ] Latest price, Greeks, volume, open interest display
- [ ] Historical time-series displays on chart

---

## I. Spread Chart (`/spread-chart`)

### I1. Load Spreads for Symbol
- [ ] Navigate to Spread Chart
- [ ] Enter symbol (e.g., QQQ)
- [ ] Press Enter
- [ ] Recent spreads for symbol load
- [ ] Spreads display in chart

### I2. Build Custom Spreads
- [ ] Click "Build Spreads" button
- [ ] Spread builder dialog opens
- [ ] Configure spread parameters (legs, expirations, strikes)
- [ ] Submit batch of spreads
- [ ] Time-series for all spreads load
- [ ] Spreads display in chart

### I3. Clear All Spreads
- [ ] Click "Clear All" button
- [ ] All spreads cleared from view
- [ ] Chart empties

### I4. Load Named List
- [ ] Click "Load List" menu
- [ ] Select named list from dropdown
- [ ] Spreads from list load
- [ ] Spreads display in chart

### I5. Load Recent Spreads
- [ ] Click "Load Recent" button
- [ ] Recently viewed spreads load
- [ ] Spreads display in chart

### I6. Save Spreads as List
- [ ] Click "Save List" button
- [ ] Save list dialog opens
- [ ] Enter list name
- [ ] System saves current spreads as named list

### I7. Delete Named List
- [ ] Click "Load List" menu
- [ ] Click delete icon next to list name
- [ ] List deleted from dropdown

### I8. Paginate Spreads
- [ ] Click "Previous" — previous page of spreads displays
- [ ] Click "Next" — next page of spreads displays

### I9. Toggle Underlying
- [ ] Click "Show Underlying" toggle
- [ ] Underlying price chart overlay appears
- [ ] Click again — overlay hides

### I10. Change Chart Mode
- [ ] Select chart mode (Absolute/Normalized)
- [ ] Absolute shows raw prices
- [ ] Normalized shows percentage changes

---

## J. Options Strategy Dashboard (`/options-strategy-dashboard`)

### J1. Load Strategy Positions
- [ ] Navigate to Options Strategy Dashboard
- [ ] All strategy positions load
- [ ] Open positions table displays
- [ ] Closed positions table displays
- [ ] Equity curve chart displays

### J2. Filter by Strategy Instance
- [ ] Navigate with query parameter: `?instance={instanceId}`
- [ ] Positions filter by strategy instance
- [ ] Filtered positions and equity curve display

### J3. View Open Positions
- [ ] Open positions table displays columns:
  - Strategy instance, Symbol, Status, Primary leg, DTE, P&L, Premium collected
- [ ] Click position row — details display (if available)

### J4. View Closed Positions
- [ ] Closed positions table displays
- [ ] Columns include realized P&L

### J5. View Equity Curve
- [ ] Equity curve chart displays
- [ ] Toggle between per-symbol and combined view
- [ ] Cumulative P&L over time displays
- [ ] Hover tooltip displays date/value

### J6. Navigate to Strategy Builder
- [ ] Click "Strategy Builder" link
- [ ] Navigates to `/strategy-builder`

---

## K. Strategy Builder (`/strategy-builder`)

### K1. Load Strategy Instances
- [ ] Navigate to Strategy Builder
- [ ] Existing strategy instances load
- [ ] Instances display in list/table

### K2. Create New Strategy Instance
- [ ] Click "New Strategy" or equivalent
- [ ] Configuration form opens
- [ ] Fill in strategy parameters (name, symbol, rules, etc.)
- [ ] Save strategy instance
- [ ] Instance appears in list

### K3. Edit Strategy Instance
- [ ] Select existing strategy instance
- [ ] Click "Edit"
- [ ] Modify parameters
- [ ] Save changes
- [ ] Updated values display

### K4. Delete Strategy Instance
- [ ] Select existing strategy instance
- [ ] Click "Delete"
- [ ] Confirm deletion
- [ ] Instance removed from list

### K5. Activate/Deactivate Strategy
- [ ] Toggle strategy active state
- [ ] Status updates in list

### K6. Navigate to Strategy Dashboard
- [ ] Click link to Options Strategy Dashboard
- [ ] Navigates to `/options-strategy-dashboard`

---

## L. Strategy Backtest (`/strategy-backtest`)

### L1. Load Backtest Runs
- [ ] Navigate to Strategy Backtest
- [ ] Existing backtest runs load
- [ ] Runs display in list/table

### L2. Create New Backtest
- [ ] Click "New Backtest" or equivalent
- [ ] Configure backtest parameters (date range, strategy, symbols)
- [ ] Run backtest
- [ ] Results display (equity curve, trades, metrics)

### L3. View Backtest Results
- [ ] Select existing backtest run
- [ ] Results display (equity curve, trade list, performance metrics)
- [ ] Charts render correctly

### L4. Compare Backtests
- [ ] Select multiple backtest runs (if supported)
- [ ] Comparison view displays

### L5. Delete Backtest Run
- [ ] Select backtest run
- [ ] Click "Delete"
- [ ] Run removed from list

---

## M. Cross-Cutting

### M1. Navigation Between Pages
- [ ] All routes in the nav menu are accessible
- [ ] No broken links or 404s
- [ ] Browser back/forward works

### M2. Authentication
- [ ] App requires login
- [ ] After login, user-specific data loads
- [ ] Logout returns to login screen

### M3. Error Handling
- [ ] Network errors display user-friendly messages
- [ ] Firestore permission errors handled gracefully
- [ ] RH MCP errors display in UI (not silent failures)

### M4. Responsive Layout
- [ ] App renders correctly on desktop (1920px)
- [ ] App renders correctly on laptop (1366px)
- [ ] No horizontal scroll on standard widths

---

## Bug Log

| # | Flow | Severity | Description | Expected | Actual | Triage Issue |
|---|------|----------|-------------|----------|--------|-------------|
| | | | | | | |

---

## Sign-Off

- [ ] All flows tested
- [ ] All critical bugs fixed
- [ ] All flows re-tested after fixes
- [ ] UAT approved

**Approved by:** _______________  **Date:** ___________
