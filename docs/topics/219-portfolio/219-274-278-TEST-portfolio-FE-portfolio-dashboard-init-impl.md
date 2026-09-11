**Topic:** Portfolio Dashboard — Init Impl  
**Topic Slug:** `portfolio-dashboard`  
**Thread:** Portfolio Dashboard — Init Impl  
**Thread Slug:** `init-impl`  
**Issue:** #278  
**Thread Parent:** #274  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** Test Plan  
**Status:** Draft  
**Created:** 2026-07-18  
**Last Updated:** 2026-07-18  

---

# Test Plan: Portfolio Dashboard — Init Impl (FE)

## E2E User Journeys

1. **Page load with multiple accounts** — user navigates to `/portfolio-dashboard` → aggregate summary bar shows totals across all accounts → first account tab is selected → account summary, equity positions, option positions load → quotes load (PnL appears) → orders pre-fetch in background → switching tabs shows pre-fetched data instantly.
2. **Default route** — user navigates to `/` → redirects to `/portfolio-dashboard` → dashboard loads.
3. **Manual refresh** — user clicks refresh button → all sections show loading → data re-fetches → sections update with latest data.
4. **Per-section error + retry** — one account's `get_equity_orders` fails → that section shows inline error with retry button → other sections and accounts are unaffected → user clicks retry → section re-fetches successfully.
5. **Closed positions toggle** — user toggles "Show closed positions" → closed positions appear in equity and option tables with muted styling → toggle off → closed positions hidden.
6. **Order history toggle** — order history is not visible by default → user toggles "Show order history" → history table appears below open orders → toggle off → hidden.
7. **Stop-loss indicator** — an open stop_market sell order for AAPL exists, and an open long position in AAPL exists → the open orders table shows a stop-loss indicator on that order row.
8. **Empty state** — account with no open positions → positions tables show "No open positions" → orders tables show "No open orders".

## Integration Tests

### Store + Client interaction
- `loadAccounts()` calls `client.getAccounts()` → store initializes `AccountState[]` with correct account count
- `loadPhase1()` calls `client.getPortfolio()` + `client.getEquityPositions()` + `client.getOptionPositions()` for each account in parallel → each account's sections populate
- `loadPhase2()` collects unique symbols across all accounts → calls `client.getEquityQuotes()` once → distributes quotes to each account's section
- `loadPhase2()` calls `client.getEquityOrders()` + `client.getOptionOrders()` for each account → order sections populate
- `refresh()` re-runs the full load sequence
- `retrySection(accountIndex, 'equityOrders')` re-fetches only that section for that account

### Store computed selectors
- `aggregateSummary` correctly sums value, exposure, cash, PnL across all accounts
- `equityPositionsWithPnL` joins positions with quotes → each position has PnL
- `optionPositionsWithPnL` joins option positions with option quotes → each position has PnL
- `openOrders` filters to live states only (new, queued, confirmed, partially_filled, pending_cancelled)
- `orderHistory` filters to terminal states (filled, cancelled, rejected, failed)
- `stopLossProtectedSymbols` returns correct set of symbols with stop-loss orders matching open positions

### Component + Store interaction
- Shell component subscribes to store → renders aggregate bar, tabs, sections
- Tab selection updates `selectedAccountIndex` → section components receive correct account data
- Toggle handlers update store state → UI reflects toggle state
- Retry output from section component triggers `store.retrySection()` → section re-fetches

## Unit Tests

### Pure functions
- `computePnL(150, 155, 100, false)` → `{ pnl: 500, pnlPercent: 3.33 }`
- `computePnL(150, 145, 100, false)` → `{ pnl: -500, pnlPercent: -3.33 }`
- `computePnL(150, 155, 100, true)` → `{ pnl: -500, pnlPercent: -3.33 }` (short inverts)
- `computePnL(150, null, 100, false)` → `{ pnl: null, pnlPercent: null }` (missing price)
- `computePnL(0, 155, 100, false)` → `{ pnl: null, pnlPercent: null }` (zero cost basis)
- `isStopLossProtecting({ type: 'stop_market', side: 'sell', symbol: 'AAPL' }, [{ symbol: 'AAPL', quantity: '100' }])` → `true`
- `isStopLossProtecting({ type: 'limit', side: 'sell', symbol: 'AAPL' }, [{ symbol: 'AAPL', quantity: '100' }])` → `false` (not stop type)
- `isStopLossProtecting({ type: 'stop_market', side: 'buy', symbol: 'AAPL' }, [{ symbol: 'AAPL', quantity: '100' }])` → `false` (buy stop doesn't protect a long)
- `isStopLossProtecting({ type: 'stop_market', side: 'sell', symbol: 'MSFT' }, [{ symbol: 'AAPL', quantity: '100' }])` → `false` (symbol mismatch)
- `computeProtectedSymbols` — O(n+m) single pass, returns correct Set

### RobinhoodMcpClient
- `getAccounts()` — parses response, filters to `agentic_allowed === true`, returns `AccountInfo[]`
- `getAccounts()` — throws `RobinhoodMcpError` when `result.success === false`
- `getEquityQuotes(['AAPL', 'NVDA', 'GOOG', ...25 symbols])` — splits into 2 batches (20 + 5), parallel fetch, merges into one map
- `getEquityQuotes(['AAPL', 'AAPL', 'NVDA'])` — deduplicates to 2 symbols, single batch
- `getOptionQuotes(instrumentIds)` — same batching + dedup pattern
- Each method throws typed error on `result.success === false`

### PortfolioDashboardStore
- Initial state: empty accounts, `selectedAccountIndex: 0`, toggles false, `globalLoading: false`
- `loadAccounts()` populates `accounts[]` with correct count and names
- `loadPhase1()` sets per-section loading → then data or error
- `loadPhase2()` distributes quotes to correct accounts
- `selectAccount(2)` updates `selectedAccountIndex`
- `toggleClosedPositions()` flips `showClosedPositions`
- `toggleOrderHistory()` flips `showOrderHistory`
- `retrySection()` re-fetches only the specified section

## Test Seams

- **Highest seam: component test harness (Angular TestBed)** — render section components with mocked `@Input` data, verify template renders correctly (columns, loading states, error states, empty states).
- **Service mock: `RobinhoodMcpClient`** — mock the client in store tests. The store never calls `RobinhoodMcpObservationService` directly.
- **Pure function calls** — `computePnL`, `isStopLossProtecting`, `computeProtectedSymbols` are pure functions tested directly with no dependencies.

## Existing Test Coverage

- `positions.store.spec.ts` — prior art for SignalStore testing pattern (mocked Firestore, computed selector assertions)
- `spread-viewer.store.spec.ts` — prior art for store with service injection
- `portfolio.service.spec.ts` — prior art for MCP service mocking
- `trading-config.service.spec.ts` — prior art for `get_accounts` response parsing

## Edge Cases

- **No agentic-allowed accounts** — `getAccounts()` returns empty → dashboard shows "No accounts available"
- **Single account** — no tab switching needed, aggregate bar equals the single account summary
- **Account with no positions** — positions tables show empty state, account summary shows zero values
- **Account with no open orders** — open orders table shows "No open orders"
- **Quote fetch fails for some symbols** — positions without quotes show PnL as "N/A", positions with quotes show computed PnL
- **All quotes fail** — all positions show PnL as "N/A", other sections unaffected
- **Position held across multiple accounts** — quote fetched once (dedup), PnL computed per account
- **Stop-loss order with no matching position** — not marked as protecting (order exists but position was already closed)
- **Option position with missing instrument ID** — cannot fetch quote, PnL shows "N/A"
- **MCP timeout** — section shows error with retry, does not hang indefinitely
- **Rapid tab switching** — pre-fetch handles race conditions (later response doesn't overwrite earlier one if user switched away)
