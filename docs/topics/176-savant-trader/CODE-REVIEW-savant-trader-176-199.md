**Topic:** Savant Trader — FE-C1a: Signal order screen — queue component
**Issue:** #199
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-C1a (#199): Signal order screen with master-detail layout — OrderQueueComponent (left panel) and rewritten OrderComponent (container). Replaced old trade-row flow with new queue+ticket architecture backed by OrderStagingStore. 8 files (4 new, 4 modified), 31 tests.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-C1a | #199 | Signal order screen — queue component | 6_REVIEW |

**Verdict: PASS** — all valid findings fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Missing export in index.ts (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/index.ts:89`
- OrderQueueComponent was not exported, preventing import by other features.
- **Fix:** Added `export { OrderQueueComponent } from './components/order-queue/order-queue.component';`

**2. Error state not displayed (MINOR → fixed)**
- **File:** `src/app/features/savant-trader/pages/agent-order/order.component.ts:57-60`
- Component had access to `stagingStore.error()` but didn't display it.
- **Fix:** Added `error` computed signal, error state template block, and `.error-state` SCSS class.

**3. Store mock missing error signal (MINOR → fixed)**
- **File:** `src/app/features/savant-trader/pages/agent-order/order.component.spec.ts:43-49`
- Mock was missing `error` signal from the actual store interface.
- **Fix:** Added `error: signal(null)` to mock and added test for error state display.

### Findings accepted (no fix needed)

**4. Hardcoded hex colors (NIT → accepted)**
- **File:** `src/app/features/savant-trader/components/order-queue/order-queue.component.scss:173,203,205`
- Uses hardcoded hex colors (#1b5e2033, #2e7d32, etc.) instead of CSS variables.
- **Resolution:** Accepted — this is an existing pattern in `chart-review.component.scss` (lines 183-195). Standardizing colors is a separate refactoring task.

**5. Inconsistent green color usage (NIT → accepted)**
- side-buy uses #2e7d32, status-filled uses #1b5e20.
- **Resolution:** Accepted — matches existing chart-review patterns. Color standardization is a separate concern.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | SignalOrderComponent (top-level container, master-detail layout) | MET | order.component.ts:1-88, order.component.html:31-57 |
| 2 | OrderQueueComponent (left panel — staged intents grouped by status) | MET | order-queue.component.ts:66-106 |
| 3 | Each row shows source badge, symbol, side, order type, quantity, status | MET | order-queue.component.html:50-67 |
| 4 | Clicking a row selects the intent (emits selection) | MET | order-queue.component.ts:143-147, test:135-149 |
| 5 | Batch select + remove action | MET | order-queue.component.ts:155-179, test:182-251 |
| 6 | Empty state message when no intents | MET | order-queue.component.html:22-29, test:50-69 |
| 7 | Route /signal-order registered | MET | core-routes.ts:111-115 (pre-existing) |
| 8 | Tests: queue rendering, grouping, selection, empty state | MET | 16 queue tests + 15 container tests = 31 total |

---

## Thermo-Nuclear

### Pattern adherence
- OrderQueueComponent is presentational (input/output only, no store dependency) — matches SignalListComponent pattern
- OrderComponent is a container (injects store, manages selection state) — matches ChartReviewComponent pattern
- Master-detail grid layout matches chart-review.component.scss pattern
- Uses modern Angular signal-based input/output (no @Input/@Output decorators)

### Status grouping
All 7 OrderIntentStatus values are covered:
- STAGED + READY → "Staged" group (intentional combination — both are pre-submission states)
- SUBMITTING → "Submitting"
- SUBMITTED → "Submitted"
- FILLED → "Filled"
- FAILED → "Failed"
- CANCELLED → "Cancelled"

Groups with zero intents are filtered out (line 108).

### Discriminated union handling
`symbolFor()` (line 112-117) correctly narrows by `instrumentType === InstrumentType.OPTION` before accessing `legs[0].symbol`. Falls back to '?' if legs is empty.

### Batch select/remove
- Checkboxes use `stopPropagation` to avoid triggering row selection
- `onRowClick` checks `closest('mat-checkbox')` as a second guard
- `removeChecked()` clears `checkedIds` after emitting
- `OrderComponent.onRemoveIntents()` clears selection if the selected intent was removed

### Breaking change verification
The old OrderComponent imported TradeRowComponent, OccurrenceDecisionStore, TriageStore, and StStore. The subagent verified:
- TradeRowComponent: only exported in index.ts, no other consumers
- OccurrenceDecisionStore, TriageStore, StStore: used by other components but NOT solely by old OrderComponent
- No breaking changes from removal

### Test coverage
- Queue: empty state, grouping (4 tests), selection (3 tests), batch select/remove (4 tests), row display (3 tests)
- Container: init, computed values, selection, batch remove, navigation, placeholder states, loading, error

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 31/31 PASS (16 queue + 15 container)

---

## Files changed

| File | Status | Lines | Description |
|---|---|---|---|
| `components/order-queue/order-queue.component.ts` | NEW | 181 | Presentational queue with grouping, selection, batch remove |
| `components/order-queue/order-queue.component.html` | NEW | 73 | Queue template with status groups, checkboxes, empty state |
| `components/order-queue/order-queue.component.scss` | NEW | 209 | Queue styles using project CSS variables |
| `components/order-queue/order-queue.component.spec.ts` | NEW | 289 | 16 tests: empty, grouping, selection, batch, row display |
| `pages/agent-order/order.component.ts` | MODIFIED | 88 | Rewritten as master-detail container using OrderStagingStore |
| `pages/agent-order/order.component.html` | MODIFIED | 65 | Master-detail layout with queue + ticket placeholder + error state |
| `pages/agent-order/order.component.scss` | MODIFIED | 112 | Grid layout matching chart-review pattern |
| `pages/agent-order/order.component.spec.ts` | MODIFIED | 203 | 15 tests: init, computed, selection, batch, nav, states |
| `index.ts` | MODIFIED | +1 | Added OrderQueueComponent export |
