**Topic:** Portfolio Dashboard
**Topic Slug:** portfolio-dashboard<br>
**Thread:** Portfolio Dashboard — Order Placement
**Thread Slug:** portfolio-dashboard-order-placement<br>
**Issue:** #292
**Thread Parent:** #279
**Topic Parent:** #219
**Task:** #295<br>
**Domain:** PORTFOLIO
**Type:** Code Review
**Status:** Complete
**Last Updated:** 2026-09-13

## Summary

Task #295 wires the Close action into the equity positions table. It adds a `closePosition` output to `EquityPositionsTableComponent` with a Close button visible only on open positions, and wires `PortfolioDashboardComponent` to open `ClosePositionDialogComponent` with position data and refresh the store on successful close.

Three review axes ran in parallel: Standards, Spec, and Thermo-nuclear. The initial review found major findings. The actionable findings were fixed and tests re-run. The remaining findings are minor/nit or deferred with justification.

## Findings by Severity

### Critical

None.

### Major

| # | Finding | Status |
|---|---------|--------|
| 1 | **Unconditional refresh on dialog dismiss** — `afterClosed().subscribe(() => store.refresh())` refreshed even when the user cancelled the dialog. | **Fixed** — Now checks `result === true` before refreshing. Added test for cancel path. |
| 2 | **Silent fallback to empty `accountNumber`** — `account?.accountNumber ?? ''` silently passed an empty string to the dialog. | **Fixed** — Early return if `selectedAccount()` is null. Uses `account.accountNumber` directly. |

### Minor

| # | Finding | Status |
|---|---------|--------|
| 3 | **Duplicated position object literal in spec** — The same `EquityPositionWithPnL` was declared inline in two tests. | **Fixed** — Extracted `makeEquityPosition()` helper. |
| 4 | **Integration tests called handler directly** — Tests called `component.onClosePosition(pos)` instead of triggering the output via the table debug element. | **Fixed** — First test now uses `fixture.debugElement.query(...).triggerEventHandler('closePosition', pos)`. |
| 5 | **Silent fallback to `0` for `currentPrice`** — `position.currentPrice ?? 0` defaults to 0 when quote is missing. | **Noted** — The dialog's `canSubmit` guard blocks submission at price 0. Acceptable for now; a future enhancement could disable the Close button when `currentPrice` is null. |
| 6 | **`any[]` from `jasmine.Spy` calls** — `dialog.open.calls.mostRecent().args` is `any[]`. | **Noted** — Standard Jasmine limitation. The `as ClosePositionDialogData` cast is the project convention. |
| 7 | **`formatCurrency` duplication** — Two changed components each define a private `Intl.NumberFormat` currency formatter. | **Deferred** — Pre-existing pattern across `portfolio-dashboard/components`. Not introduced by this task. |

### Nit

| # | Finding | Status |
|---|---------|--------|
| 8 | **`closePosition` output name** — Sounds like a method rather than an event. | **Noted** — Consistent with existing `retry` and `toggleClosed` outputs in the same component. |
| 9 | **`afterClosed()` not `take(1)`-ed** — Observable completes on dismissal, so not a real leak. | **Noted** — `afterClosed()` is a single-value observable by contract. |
| 10 | **Short positions not handled** — `quantity > 0` guard excludes short positions. | **Deferred** — Long-only is the current scope. Short position support belongs in a future task. |
| 11 | **`sharesHeldForSells` not considered** — Close button appears even if shares are held for open sell orders. | **Deferred** — The dashboard's `EquityPositionWithPnL` doesn't currently expose sellable quantity. A future task could add this. |
| 12 | **Spec file > 400 lines** — `portfolio-dashboard.component.spec.ts` is 487 lines. | **Deferred** — Pre-existing growth. Not introduced by this task (added ~50 lines). |

## Spec Coverage

All Task #295 acceptance criteria:
- **MET** — Close action appears on open equity position rows (non-zero quantity)
- **MET** — Close action does not appear on closed positions (zero quantity)
- **MET** — Clicking Close opens `ClosePositionDialogComponent` with position data (symbol, quantity, current price, account number)
- **MET** — Dialog dismiss (success only) triggers `PortfolioDashboardStore.refresh()`
- **MET (indirect)** — After successful close, refresh re-fetches positions; position disappears or shows reduced quantity
- **MET (indirect)** — After successful close, refresh re-fetches orders; sell order appears in open orders
- **MET** — `ng build` passes

Criteria 5 and 6 are covered indirectly through the store's `refresh()` behavior, which re-fetches both equity positions and equity orders. The store's refresh behavior has its own dedicated tests in `portfolio-dashboard.store.spec.ts`. Adding a full end-to-end integration test (dialog submit → store refresh → table re-render) would require mocking the entire MCP service chain and is beyond the scope of this wiring task.

## Test Results

- `equity-positions-table.component.spec.ts`: **17/17 SUCCESS**
- `portfolio-dashboard.component.spec.ts`: **30/30 SUCCESS** (27 original + 3 new)
- `ng build`: **SUCCESS** (13.2s)

## Verdict

**PASS**

All major findings were fixed. The deferred findings are pre-existing patterns, edge cases for future tasks, or integration-level concerns covered indirectly by the store's own tests. The implementation is complete, tested, and the build passes.
