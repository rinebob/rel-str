**Topic:** Savant Trader — FE-C1b: Signal order screen — ticket component
**Issue:** #200
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-C1b (#200): Order ticket component (right panel of signal order screen) with full Robinhood parameter editing, live preview, confirmation dialog, execution status feedback, error display with retry, and cancel for submitted orders. 11 files (7 new, 4 modified), 59 tests total (28 ticket + 16 queue + 15 container).

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-C1b | #200 | Signal order screen — ticket component | 6_REVIEW |

**Verdict: PASS** — all critical and major findings fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Memory leak in loadConfig subscription (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:198-209`
- `loadConfig()` subscription was not cleaned up on component destroy.
- **Fix:** Added `DestroyRef` injection and `takeUntilDestroyed(this.destroyRef)` to the subscription.

**2. Deprecated toPromise() usage (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:249`
- `.afterClosed().toPromise()` is deprecated in modern RxJS.
- **Fix:** Replaced with `firstValueFrom(dialog.open(...).afterClosed())`.

**3. Confirmation dialog receives stale intent (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:229-258`
- Dialog received `this.intent()` (original input) instead of the edited values after `saveEdits()`.
- **Fix:** Build a snapshot from `this.preview()` (which uses local edited signals) and spread it into the intent: `{ ...i, ...snapshot }`.

**4. Discriminated union narrowing incomplete (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:211-227`
- Used `i.instrumentType !== InstrumentType.OPTION` instead of positive narrowing.
- **Fix:** Changed to `i.instrumentType === InstrumentType.EQUITY || i.instrumentType === InstrumentType.ETF`.

**5. Cancel button only checks SUBMITTED, not SUBMITTING (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:103-107, 272-278`
- User couldn't cancel an order stuck in SUBMITTING state.
- **Fix:** `isSubmitted` computed now includes SUBMITTING. `onCancel()` accepts both SUBMITTED and SUBMITTING.

**6. Account check after saveEdits in onSubmit (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:229-258`
- Edits were saved even when no account was configured.
- **Fix:** Moved account check before `saveEdits()`.

**7. Unauthenticated user not handled in loadConfig (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts:205-208`
- Error handler only logged; didn't set `tradingConfig` to null, so account warning wouldn't show.
- **Fix:** Added `this.tradingConfig.set(null)` in the error handler.

### Findings accepted (no fix needed)

**8. Form field bindings use manual event binding (MINOR → accepted)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.html:72-127`
- Uses `[value]="signal()" (input)="signal.set($any($event.target).value)"` instead of `[(ngModel)]`.
- **Resolution:** Accepted — this is a deliberate pattern for signal-based components. The project doesn't use `[(ngModel)]` with signals elsewhere. Switching to `ngModel` would require `FormsModule` and lose the signal reactivity benefits.

**9. Hardcoded hex colors in SCSS (NIT → accepted)**
- **File:** `src/app/features/savant-trader/components/order-ticket/order-ticket.component.scss:62,122,124`
- Uses `#1b5e2033`, `#2e7d32`, `#e65100`, `#1b5e20` instead of CSS variables.
- **Resolution:** Accepted — this is an existing pattern in `chart-review.component.scss` and `order-queue.component.scss`. Color standardization is a separate refactoring task.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | OrderTicketComponent (right panel — full order configuration) | MET | order-ticket.component.ts:54-280 |
| 2 | All Robinhood parameters editable | MET | orderType, quantity, dollarAmount, limitPrice, stopPrice, timeInForce, marketHours — all editable in form-section |
| 3 | Live preview of order to be submitted | MET | preview computed (line 152-169), preview-section in template |
| 4 | Confirmation dialog before submit | MET | OrderConfirmDialogComponent, onSubmit opens dialog before calling submitIntent |
| 5 | Execution status feedback (staged → submitting → submitted → filled/failed) | MET | status-section with statusIcon computed, status-specific CSS classes |
| 6 | Error display with retry button (retryable errors only) | MET | error-section shows message + retryable hint, retry button only for FAILED + retryable |
| 7 | Cancel button for submitted orders | MET | Cancel button for SUBMITTED and SUBMITTING states (fixed during review) |
| 8 | Account number display + selection prompt if none configured | MET | account-section shows number when configured, account-warning when not |
| 9 | New Manual Order button placeholder (snackbar) | MET | onNewManualOrder opens snackbar "Manual order creation coming soon" |
| 10 | Tests: ticket rendering, confirm → submit flow, retry, cancel | MET | 28 ticket tests covering all flows including dialog data verification |

---

## Thermo-nuclear

### Pattern adherence
- OrderTicketComponent follows presentational pattern with `input<OrderIntent | null>` for the intent
- OrderConfirmDialogComponent follows existing MatDialog pattern (NewSymbolsDialogComponent)
- Uses `MAT_DIALOG_DATA` injection correctly
- Uses `MatDialogRef<component, boolean>` for typed close result

### Discriminated union handling
- `symbolFor()` in OrderQueueComponent narrows by `instrumentType === InstrumentType.OPTION`
- `saveEdits()` now narrows positively: `i.instrumentType === InstrumentType.EQUITY || i.instrumentType === InstrumentType.ETF`
- OrderConfirmDialogComponent has separate `limitPrice` and `stopPrice` computeds that narrow by instrumentType

### Submit flow
1. Account check first (before saveEdits)
2. saveEdits() persists edited fields to store
3. Build snapshot from preview() (uses local edited signals)
4. Open dialog with `{ ...i, ...snapshot }` (includes edited values)
5. On confirm, call `stagingStore.submitIntent(i.id)`

### Retry flow
- Only for FAILED + retryable errors
- Saves edits before retrying
- Calls `stagingStore.retryIntent(i.id)`

### Cancel flow
- Works for both SUBMITTED and SUBMITTING states (fixed during review)
- Calls `stagingStore.cancelIntent(i.id)`

### Memory management
- `loadConfig()` subscription uses `takeUntilDestroyed(this.destroyRef)`
- `effect()` in constructor is auto-cleaned by Angular
- `firstValueFrom()` for dialog observable (no subscription leak)

### Test coverage
- 28 ticket tests: no-selection, rendering, account, status, submit flow (4 tests), retry (5 tests), cancel (3 tests), new manual order, order type visibility, dialog data verification
- 16 queue tests (unchanged from FE-C1a)
- 15 container tests (updated for ticket integration)

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 59/59 PASS (28 ticket + 16 queue + 15 container)

---

## Files changed

| File | Status | Lines | Description |
|---|---|---|---|
| `components/order-confirm-dialog/order-confirm-dialog.component.ts` | NEW | 69 | Confirmation dialog with order summary |
| `components/order-confirm-dialog/order-confirm-dialog.component.html` | NEW | 59 | Dialog template with order parameters |
| `components/order-confirm-dialog/order-confirm-dialog.component.scss` | NEW | 45 | Dialog styles |
| `components/order-ticket/order-ticket.component.ts` | NEW | 280 | Full order configuration with editable fields, preview, submit/retry/cancel |
| `components/order-ticket/order-ticket.component.html` | NEW | 172 | Ticket template with form, preview, status, actions |
| `components/order-ticket/order-ticket.component.scss` | NEW | 229 | Ticket styles using project CSS variables |
| `components/order-ticket/order-ticket.component.spec.ts` | NEW | 380 | 28 tests: rendering, submit, retry, cancel, dialog data |
| `pages/agent-order/order.component.ts` | MODIFIED | 88 | Added OrderTicketComponent import |
| `pages/agent-order/order.component.html` | MODIFIED | 49 | Replaced placeholder with `<app-order-ticket>` |
| `pages/agent-order/order.component.spec.ts` | MODIFIED | 210 | Added ticket deps, updated placeholder tests |
| `index.ts` | MODIFIED | +2 | Added OrderTicketComponent and OrderConfirmDialogComponent exports |
