# AS-BUILT — Portfolio Dashboard — Init Impl

**Topic Slug:** portfolio-dashboard
**Issue:** #290 (QA)
**Topic Parent:** #219
**Last Updated:** 2026-09-12
**Status:** Complete

## Overview

The Portfolio Dashboard is a broker-authoritative, view-only single screen showing all open positions, open orders, and on-demand order history across multiple Robinhood accounts.

## What was built

### Robinhood MCP client (`src/app/core/robinhood-mcp/`)

- `RobinhoodMcpClient` — typed wrapper over the Robinhood MCP observation service
  - `getAccounts()` — returns all accounts (no agentic filtering)
  - `getPortfolio(accountNumber)` — portfolio summary (buying power, market value)
  - `getEquityPositions(accountNumber)` — open equity positions
  - `getOptionPositions(accountNumber)` — open option positions
  - `getEquityQuotes(symbols)` — batched equity quotes (nested `quote` object unwrapping)
  - `getOptionQuotes(instrumentIds)` — batched option quotes
  - `getEquityOrders(accountNumber)` — equity orders (`orders` container key)
  - `getOptionOrders(accountNumber)` — option orders (falls back to `processed_quantity`)
- Response parsing via `extractList()` supporting `data.results`, `data.quotes`, `data.orders`, `data.positions`, and nested `quote` objects

### Pure utilities (`src/app/features/portfolio-dashboard/utils/`)

- `portfolio-pnl.util.ts` — `computePnL()`, `computeAccountPnL()`, stop-loss protection detection
- `order-states.util.ts` — `LIVE_ORDER_STATES` (new, queued, confirmed, unconfirmed, partially_filled, pending_cancelled) and `TERMINAL_ORDER_STATES` (filled, cancelled, rejected, failed, voided, unknown)

### Portfolio dashboard store (`portfolio-dashboard.store.ts`)

- NgRx SignalStore with `AccountState` per account
- Two-phase loading: phase 1 (accounts, portfolio, positions), phase 2 (quotes, orders)
- `refresh()` owns `globalLoading` lifecycle (no flicker between phases)
- Combined `'orders'` SectionName for retry of both equity and option orders
- Computed selectors: `equityPositionsWithPnL`, `optionPositionsWithPnL`, `openOrders`, `orderHistory`, `aggregateSummary`
- Aggregate PnL guard uses `||` so single-asset-class accounts show PnL

### Section components (`src/app/features/portfolio-dashboard/components/`)

- `AccountSummaryComponent` — buying power, market value, PnL
- `EquityPositionsTableComponent` — Symbol, Quantity, Avg Cost, Cost Basis, Current Price, Value, PnL, PnL% with totals footer and Show Closed toggle
- `OptionPositionsTableComponent` — Underlying, Type, Strike, Expiration, Qty, Avg Cost, Cost Basis, Current, Value, PnL, PnL% with totals footer and Show Closed toggle
- `OpenOrdersTableComponent` — open orders with stop-loss protection indicator
- `OrderHistoryTableComponent` — terminal orders

### Dashboard shell (`portfolio-dashboard.component.ts`)

- Per-account tabs with account name + account number
- Store-to-component wiring with signal inputs
- Per-section loading/error/empty states with retry
- Closed positions toggle (wired to both equity and option tables)
- Order history toggle (ARIA-expanded and ARIA-pressed bound)
- Aggregate summary bar

## Architecture decisions

1. **Robinhood MCP as source of truth** — no legacy Firestore `PositionsStore` dependency
2. **Two-phase loading** — phase 1 loads accounts/positions, phase 2 loads quotes/orders after positions are available (quotes need symbols from positions)
3. **Per-account tabs** — all data pre-fetched globally; tab switching is synchronous with no network calls
4. **Combined orders retry** — single `'orders'` SectionName retries both equity and option orders
5. **Closed-position toggle** — `hasAnyPositions` computed ensures toggle persists even when all positions are closed
6. **Totals footer** — sum of Cost Basis, Value, PnL, and weighted-avg PnL% (totalPnL / totalCostBasis × 100)

## Deviations from original design

- **Option positions closed support** — added `closed` field to `OptionPositionWithPnL` and Show Closed toggle to option table (not in original PRD but needed for parity with equity table)
- **`unconfirmed` order state** — added to `LIVE_ORDER_STATES` after discovering orders in this state were vanishing from both open and history
- **Nested quote parsing** — Robinhood MCP returns quotes nested under a `quote` key; parser updated to unwrap
- **`processed_quantity` fallback** — option orders use `processed_quantity` instead of `cumulative_quantity`; normalizer updated

## Verification

- **Tests:** 189/189 pass (portfolio-dashboard + robinhood-mcp suites)
- **Build:** Angular production build passes
- **UI:** Verified at `http://localhost:4300/portfolio-dashboard`

## Commits

- `f484b60` 219-287_FE-BUG-PORTFOLIO: Fix quote, order, and option position parsing
- `3227084` 219-287_FE-IMPL-PORTFOLIO: Add Cost Basis, Value columns, totals footer, and closed-position toggle to position tables
- `b308b93` 219-287_FE-IMPL-PORTFOLIO: Wire section components into dashboard shell with store signals
- `c24cf05` 219-287_FE-BUG-PORTFOLIO: Add unconfirmed to LIVE_ORDER_STATES
- `c2bb137` 219-287_DOCS-PORTFOLIO: Add code review doc for Task #287 integration + wiring
- `28a75cc` 219-287_DOCS-PORTFOLIO: Update changelog for Task #287 ship
- `99b5466` 219-287_DOCS-PORTFOLIO: Mark Task #287 review doc as complete
