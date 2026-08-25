**Topic:** Savant Trader — FE-B2: Order execution service
**Issue:** #197
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-B2 (#197): OrderExecutionService wrapping RobinhoodMcpObservationService for equity order placement, cancellation, and reconciliation. 2 new files, 19 tests.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-B2 | #197 | Order execution service | 6_REVIEW |

**Verdict: PASS** — all valid findings discovered during review were fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Preflight exception hardcoded retryable: true (NIT → fixed)**
- **File:** `src/app/features/savant-trader/services/order-execution.service.ts:90-99`
- Preflight catch block hardcoded `retryable: true` without checking non-retryable patterns.
- **Fix:** Changed to use `isRetryableException(err)` for consistent classification.

**2. Misleading JSDoc comment about confirmation (NIT → fixed)**
- **File:** `src/app/features/savant-trader/services/order-execution.service.ts:1-14`
- Comment said "Does NOT handle confirmation" but service does call `review_equity_order` preflight.
- **Fix:** Clarified that user-facing confirmation dialogs are the UI's responsibility; the preflight is a simulation, not a confirmation gate.

**3. Missing test assertion for ref_id exclusion from review call (MINOR → fixed)**
- **File:** `src/app/features/savant-trader/services/order-execution.service.spec.ts:75-80`
- Test verified ref_id is in place call but didn't verify it's absent from review call.
- **Fix:** Added assertion that `reviewCall[1].args.ref_id` is `undefined`.

### Findings accepted (no fix needed)

**4. No state check before cancel (MAJOR → accepted/documented)**
- **File:** `src/app/features/savant-trader/services/order-execution.service.ts:135`
- The service does not check order state before calling `cancel_equity_order`. Robinhood will reject cancels on terminal orders, but this wastes an API call.
- **Resolution:** Added JSDoc note that caller should verify state before calling. The store (`OrderStagingStore.cancelIntent`) only allows cancel on SUBMITTED intents, so the caller already guards this.

**5. Default to retryable for unknown errors (MAJOR → accepted/documented)**
- **File:** `src/app/features/savant-trader/services/order-execution.service.ts:225-227`
- Unknown errors default to `retryable: true`. Could cause infinite loops without retry limits.
- **Resolution:** Added comment that callers MUST implement retry limits. The store's `retryIntent` method is user-triggered (not automatic), so infinite loops are not possible — the user decides when to retry.

**6. Error patterns may miss some Robinhood messages (MINOR → accepted)**
- **File:** `src/app/features/savant-trader/services/order-execution.service.ts:44-71`
- Patterns don't cover "market closed", "outside trading hours", etc.
- **Resolution:** Accepted — the default-to-retryable behavior means missed non-retryable patterns result in a retryable classification, which is safe (user can decide). Patterns can be expanded based on production error logs.

### Findings rejected

**7. Test framework inconsistency — Jasmine vs Jest (CRITICAL → rejected)**
- The subagent claimed the project uses Jest and the tests should use `jest.fn()` instead of `jasmine.createSpy()`.
- **Evidence:** `angular.json` configures `@angular-devkit/build-angular:karma` as the test builder. All 13 existing savant-trader spec files use `jasmine.createSpy()`. The `ng test` command uses Karma + Jasmine. The Jest config exists but is not used by the savant-trader tests.
- **Conclusion:** The tests correctly follow the project standard (Jasmine via Karma).

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | submitEquityOrder: review_equity_order preflight + place_equity_order with ref_id | MET | order-execution.service.ts:78-131 |
| 2 | cancelEquityOrder: calls cancel_equity_order | MET | order-execution.service.ts:135-155 |
| 3 | reconcileOrder: queries get_equity_orders with ref_id | MET | order-execution.service.ts:158-184 |
| 4 | Error classification: retryable vs non-retryable | MET | order-execution.service.ts:44-71, 213-236 |
| 5 | Tests: submit success, submit failure (retryable), submit failure (non-retryable), cancel, reconcile | MET | 19 tests covering all paths + error classification |

---

## Thermo-Nuclear

### Pattern adherence
Service is stateless — no store dependency. It wraps `RobinhoodMcpObservationService.executeTool()` and returns `ExecutionResult` / `ReconciliationResult` interfaces for the store to consume. This correctly separates broker communication (service) from state management (store).

### Preflight flow
`submitEquityOrder` correctly calls `review_equity_order` first (simulation), then `place_equity_order` with `ref_id`. The `ref_id` is only passed on the place call, not the review call — verified by test assertion.

### Error classification
Non-retryable patterns: insufficient buying power, insufficient funds, invalid symbol, not tradable, not agentic, PDT, fractional disabled. Retryable patterns: timeout, network, connection, rate limit, 5xx. Default: retryable (safe — user decides). Preflight exceptions now use `isRetryableException` for consistent classification.

### Reconciliation
`reconcileOrder` queries `get_equity_orders` and finds the order by `ref_id`. The unverified `ref_id_pk` field was removed — only `ref_id` (the documented idempotency key) is used.

### Cancel safety
`cancelEquityOrder` does not check order state before calling `cancel_equity_order`. This is acceptable because:
1. The store's `cancelIntent` method only allows cancel on SUBMITTED intents
2. Robinhood will reject cancels on terminal orders anyway
3. JSDoc documents that caller should verify state

### Test coverage
Tests cover: submit success (with preflight + place), submit failure on preflight (retryable + non-retryable), submit failure on place (retryable + non-retryable), preflight exception, limit/stop order args, cancel success, cancel failure, cancel exception, reconcile found, reconcile not found, reconcile query failure, reconcile exception, empty results, error classification (PDT, rate limit, non-agentic, unknown).

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 19/19 PASS (order-execution.service.spec.ts)

---

## Files created

| File | Lines | Description |
|---|---|---|
| `services/order-execution.service.ts` | 238 | Wraps RobinhoodMcpObservationService for order placement, cancellation, reconciliation |
| `services/order-execution.service.spec.ts` | 354 | 19 tests covering submit, cancel, reconcile, error classification |
