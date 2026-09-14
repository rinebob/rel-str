**Topic:** Portfolio Dashboard
**Topic Slug:** portfolio-dashboard<br>
**Thread:** Portfolio Dashboard — Analytics Suite
**Thread Slug:** portfolio-dashboard-analytics-suite<br>
**Issue:** #276
**Thread Parent:** #219
**Topic Parent:** #219
**Task:** #314<br>
**Domain:** PORTFOLIO
**Type:** Code Review
**Status:** Complete
**Last Updated:** 2026-09-14

## Summary

Task #314 wires the `get_pnl_trade_history` MCP tool into the Portfolio Dashboard so the Show Closed toggle on the equity positions table actually displays closed positions. The implementation adds a typed `getPnlTradeHistory()` client method, a `closedTrades` section to `AccountState`, on-demand loading when the user toggles Show Closed, a `closedTradesWithPnL` computed that maps trade history into `EquityPositionWithPnL` rows (deriving average buy price and PnL% from sale price, quantity, and realized gain), and a `displayedEquityPositions` store selector that merges open positions with closed trades.

Two review axes ran in parallel: Standards and Spec. No Critical issues. Two Major findings were fixed before finalizing.

## Findings by Severity

### Critical

None.

### Major

| # | Finding | Status |
|---|---------|--------|
| 1 | **Business logic in component** — The merge of open positions with closed trades lived in a `computed()` inside `PortfolioDashboardComponent`, violating the repo rule that data transformations belong in the store. | **Fixed** — Moved to `displayedEquityPositions` computed in the store's `withComputed` block. Component now reads `this.store.displayedEquityPositions` directly. |
| 2 | **No client tests for `getPnlTradeHistory`** — The new client method had no unit tests covering response parsing, argument passing, failure handling, or edge cases. | **Fixed** — Added 8 tests to `robinhood-mcp-client.service.spec.ts`: normal response, empty trades, pagination cursor, span arg passing, span omission, failure, missing trades array, empty-side trades. |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 3 | **`SectionName` union out of sync** — `closedTrades` was added to `AccountState` but not to `SectionName`, and `retrySection()` had no case for it — so a failed closed-trades load could not be retried. | **Fixed** — Added `'closedTrades'` to `SectionName` and a `closedTrades` case to `retrySection()`. |
| 4 | **`EquityPositionWithPnL.closed` invariant contradicted** — The JSDoc said "True when position is closed (quantity === 0)" but `closedTradesWithPnL` sets `closed: true` for trades with non-zero quantity. | **Fixed** — Updated JSDoc to "True when the position is closed (quantity === 0) or this is a closed trade from history." |
| 5 | **Equity-only filter is a heuristic** — The filter `side === 'sell' && symbol` excludes options assignments (which have empty `side`) but cannot distinguish equities from crypto/prediction markets because the MCP response has no `asset_class` field. | **Accepted limitation** — Probed all 3 accounts (127 trades total); all trades are equity symbols. The MCP tool's response shape has only 6 fields (`timestamp`, `symbol`, `side`, `quantity`, `price`, `realized_gain`) with no asset-class metadata. `side === 'sell'` is the best available filter. Documented in code. |

### Nit

| # | Finding | Status |
|---|---------|--------|
| 6 | **`PnlTradeHistory.span` typed as `string`** — Should use the `PnlTradeSpan` union. | **Fixed** — Changed to `span: PnlTradeSpan`; client casts the parsed string. |
| 7 | **`getPnlTradeHistory` doesn't reuse `extractList` helper** — Uses manual `Array.isArray` + cast instead. | **Accepted** — The response nests trades under `data.trades`, and `extractList` expects a top-level container key. The manual extraction is clearer for this shape. |

## Spec Coverage

All Task #314 acceptance criteria:
- **MET** — Add `getPnlTradeHistory()` method to `RobinhoodMcpClient` with typed response
- **MET** — Define response types by probing the actual response shape (confirmed: `{ data: { account_number, span, trades: [{ timestamp, symbol, side, quantity, price, realized_gain }], next_cursor } }`)
- **MET** — Add closed trade history section to `AccountState`
- **MET** — Load trade history on-demand when Show Closed is toggled (not on initial dashboard load)
- **MET** — Map trade history records into the equity positions table's closed-position display
- **MET** — Show closed positions with symbol, quantity sold, sale price, realized PnL, and PnL% (avg buy price and cost basis derived from sale price + realized gain)
- **MET (with limitation)** — Filter to equity-only rows; the MCP response has no `asset_class` field, so filtering uses `side === 'sell'` which excludes options assignments (empty `side`). All probed trades across 3 accounts were equity trades.
- **MET** — Support span selection (default `3month`); UI span selector deferred to a follow-up
- **MET** — Tests for client method (8 new), store loading (5 new), table display (2 new)
- **MET** — `ng build` passes

## Test Results

- `robinhood-mcp-client.service.spec.ts`: **46/46 SUCCESS** (38 original + 8 new)
- `portfolio-dashboard.store.spec.ts`: **31/31 SUCCESS** (26 original + 5 new)
- `portfolio-dashboard.component.spec.ts`: **35/35 SUCCESS** (33 original + 2 new)
- `portfolio-dashboard.store.selectors.spec.ts`: **16/16 SUCCESS**
- `equity-positions-table.component.spec.ts`: **23/23 SUCCESS**
- `portfolio-pnl.util.spec.ts`: **41/41 SUCCESS**
- `ng build`: **SUCCESS** (10.5s)

## Verdict

**PASS**
