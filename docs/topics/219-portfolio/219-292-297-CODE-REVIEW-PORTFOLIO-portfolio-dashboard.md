**Topic:** Portfolio Dashboard
**Topic Slug:** portfolio-dashboard<br>
**Thread:** Portfolio Dashboard — Order Placement
**Thread Slug:** portfolio-dashboard-order-placement<br>
**Issue:** #292
**Thread Parent:** #279
**Topic Parent:** #219
**Task:** #297<br>
**Domain:** PORTFOLIO
**Type:** Code Review
**Status:** Complete
**Last Updated:** 2026-09-14

## Summary

Task #297 wires the Add Stop action into the equity positions table. It adds `protectedSymbols` and `agenticAllowed` inputs to `EquityPositionsTableComponent`, an `addStopLoss` output, and wires the dashboard to open `StopLossDialogComponent` with refresh on success. It also fixes `isProtectiveStopOrder` to detect Robinhood stop orders (which return as `type: 'market'` with a `stopPrice` set), adds agent-enabled gating, and sorts the primary agentic account to the first tab.

Two review axes ran in parallel: Standards and Spec. Both found no Critical issues. Two Major findings were fixed before finalizing.

## Findings by Severity

### Critical

None.

### Major

| # | Finding | Status |
|---|---------|--------|
| 1 | **Hardcoded account number in store sorting** — `677616245` was embedded as a literal in `loadAccounts`. | **Fixed** — Extracted to `PRIMARY_AGENTIC_ACCOUNT_NUMBER` constant at the top of the store file. |
| 2 | **`matTooltip` on disabled button won't display** — Disabled buttons don't receive pointer/focus events, so the tooltip was unreachable. | **Fixed** — Restructured to `@if`/`@else`: unprotected renders the button normally; protected renders a `<span matTooltip>` wrapping a `disabled` button, matching the pattern in `open-orders-table.component.html`. |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 3 | **Stale JSDoc for `isStopLossProtecting`** — Listed only `stop_market`/`stop_limit` types, didn't mention `stopPrice`-based detection. | **Fixed** — Updated doc to mention both detection paths. |
| 4 | **Stale JSDoc for `computeProtectedSymbols`** — Same issue. | **Fixed** — Updated doc. |
| 5 | **Duplicated dialog-open/refresh logic** — `onClosePosition` and `onAddStopLoss` are nearly identical. | **Deferred** — Acceptable with 2 siblings. Extract a helper when a 3rd dialog is added. |
| 6 | **File-size guideline violations** — Store (444 lines), dashboard spec (528 lines), pnl util spec (414 lines) exceed 300/400-line targets. | **Deferred** — Pre-existing; additions are small. Decompose in a follow-up cleanup. |
| 7 | **No store test for account sorting** — The `677616245` sort behavior is untested at the store level. | **Deferred** — The sort is a simple constant-based comparator; the constant is named and documented. |

### Nit

| # | Finding | Status |
|---|---------|--------|
| 8 | **Missing JSDoc on new table members** — `protectedSymbols` and `addStopLoss` lacked doc blocks. | **Fixed** — Added JSDoc. |
| 9 | **Overly explicit null/undefined check** — `order.stopPrice !== null && order.stopPrice !== undefined` instead of `!= null`. | **Fixed** — Changed to `order.stopPrice != null`. |
| 10 | **Unnecessary `?? false` on `agenticAllowed`** — `AccountState.agenticAllowed` is non-optional. | **Noted** — Defensive but harmless; kept for null-safety on the optional `selectedAccount()` chain. |

## Spec Coverage

All Task #297 acceptance criteria:
- **MET** — Add Stop action appears on unprotected open equity position rows
- **MET (modified)** — Add Stop action is **disabled** (not hidden) on protected positions, with tooltip — per user request during implementation
- **MET** — Add Stop action does not appear on closed positions (zero quantity)
- **MET** — Clicking Add Stop opens `StopLossDialogComponent` with position data (symbol, quantity, current price, account number)
- **MET** — Dialog dismiss with success triggers `PortfolioDashboardStore.refresh()`; cancel does not refresh
- **MET** — After successful stop-loss placement, position shows as protected after refresh
- **MET** — `ng build` passes

Additional user-requested changes:
- **MET** — Buttons only displayed for agent-enabled accounts
- **MET** — Account `677616245` sorted to first tab
- **MET** — Add Stop button disabled (not hidden) when protected, with tooltip
- **MET** — Actions column hidden entirely for non-agentic accounts
- **MET** — `isProtectiveStopOrder` detects Robinhood stop orders (`type: 'market'` with `stopPrice`)

## Test Results

- `portfolio-pnl.util.spec.ts`: **41/41 SUCCESS** (37 original + 4 new)
- `equity-positions-table.component.spec.ts`: **23/23 SUCCESS** (17 original + 6 new)
- `portfolio-dashboard.component.spec.ts`: **33/33 SUCCESS** (30 original + 3 new)
- `portfolio-dashboard.store.spec.ts`: **26/26 SUCCESS**
- `portfolio-dashboard.store.selectors.spec.ts`: **16/16 SUCCESS**
- `ng build`: **SUCCESS** (19.0s)

## Verdict

**PASS**

Both Major findings were fixed before finalizing. The deferred findings are pre-existing or acceptable at the current scale. The implementation is complete, tested, and the build passes.
