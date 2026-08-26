**Topic:** Savant Trader — FE-D1: Wire signal pipeline to stage intents
**Issue:** #201
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-26

---

## Summary

Three-axis review of FE-D1 (#201): Wire `SignalReviewFacade.stageAcceptedOrders()` to push accepted occurrence decisions as equity OrderIntents into the staging store, then navigate to /signal-order. Replaces the old `goToOrder` button with a "Stage Accepted" action in both signal-review and chart-review headers. 11 files (1 new, 10 modified), 18 tests.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-D1 | #201 | Wire signal pipeline to stage intents | 6_REVIEW |

**Verdict: PASS** — all critical and major findings fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Memory leak in loadConfig subscription (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts:344-410`
- `loadConfig()` subscription was not cleaned up.
- **Fix:** Rewrote `stageAcceptedOrders` as async, using `firstValueFrom()` instead of `.subscribe()`.

**2. Duplicate intent IDs cause data loss (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts:380-382`
- Two decisions with same symbol+side in the same minute would produce identical IDs, causing the second to overwrite the first.
- **Fix:** Added deduplication via `Set<string>` keyed by `${symbol}-${side}`. Only the first decision per symbol+side is staged.

**3. No user feedback on config load error (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts:355-360`
- Error handler only logged to console; user had no idea staging failed.
- **Fix:** Added `MatSnackBar` injection and error notification: "Failed to load account config — staging aborted". Method returns early without staging or navigating.

**4. Stage button in signal-review-header missing isActionableRun check (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/components/signal-review-header/signal-review-header.component.html:43`
- Button only checked `acceptedCount() === 0`, not `isActionableRun()`.
- **Fix:** Added `|| !isActionableRun()` to disabled binding.

**5. Missing test for error handling (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.spec.ts:282-294`
- No test for `loadConfig` error scenario.
- **Fix:** Added test that mocks `loadConfig` to return error, verifies no staging, no navigation, and snackbar notification.

### Findings accepted (no fix needed)

**6. SignalDirection.ALL defaults to 'buy' (MAJOR → accepted)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts:362`
- `SignalDirection.ALL` would map to 'buy'. However, `StOccurrenceDecision.direction` only contains LONG or SHORT (from signal data), never ALL. The `activeOrderDecisions` computed filters by `decisionType === ACCEPT` which comes from actual signals.
- **Resolution:** Accepted — ALL is a filter value, not a decision direction. No runtime risk.

**7. Facade method name `stageAcceptedOrders` vs `stageAcceptedIntents` (MINOR → fixed)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts:355`
- Method stages intents, not orders. Intents and orders are distinct domain concepts — an intent becomes an order only after submission to the broker.
- **Fix:** Renamed `stageAcceptedOrders` → `stageAcceptedIntents` across all files (facade, spec, signal-review component, chart-review component).

**8. Test helper `signal<T>()` duplicated (NIT → accepted)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.spec.ts:291-296`
- Same helper exists in `order.component.spec.ts`.
- **Resolution:** Accepted — extracting to a shared utility is a separate refactoring task.

**9. Intl.DateTimeFormat hour '24' defensive check (NIT → accepted)**
- **File:** `src/app/features/savant-trader/stores/signal-review.facade.ts:425`
- Defensive check for hour === '24' is unnecessary but harmless.
- **Resolution:** Accepted — harmless defensive code.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | SignalReviewFacade.stageAcceptedOrders() pushes accepted decisions as equity OrderIntents | MET | facade.ts:344-410, test:117-127 |
| 2 | Each intent has source: SIGNAL_PIPELINE, signalContext, side from direction, accountNumber from preference | MET | facade.ts:366,376-382,361,369; tests verify each field |
| 3 | Navigates to /signal-order after staging | MET | facade.ts:389; test:236-244 |
| 4 | Stage Accepted button replaces goToOrder button in signal-review | MET | signal-review-header.component.ts:77, html:42-48 |
| 5 | Same Stage Accepted action available from chart-review | MET | chart-review.component.ts:303-305, html:21; review-header.component.ts:62, html:87-93 |
| 6 | Tests: mock OrderStagingStore, verify one EquityOrderIntent per accepted decision with correct fields | MET | 18 tests covering all fields + error + dedup |

---

## Thermo-nuclear

### ID format
- Format: `{SYMBOL}-{SIDE}-{YYMMDD}-{DOW}-{HHMM}PT` (e.g., `AAPL-BUY-260825-MON-1430PT`)
- All segments uppercase via `.toUpperCase()` and `weekday: 'short'` + `.toUpperCase()`
- Uses `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'` for PT
- `refId` = same as `id` (used as RH MCP idempotency key)

### Deduplication
- Added `Set<string>` keyed by `${symbol}-${side}` to prevent duplicate staging
- If two decisions have the same symbol+side (e.g., daily and weekly AAPL LONG), only the first is staged
- Test verifies dedup behavior (test:296-308)

### Side mapping
- LONG → `buy`, SHORT → `sell` (RH MCP only accepts buy/sell)
- SignalDirection.ALL is a filter value, not a decision direction — no runtime risk

### Signal linkage
- `sourceRef: { type: 'occurrence_decision', id: decision.id }` — generic link to originating entity
- `signalContext.decisionId: decision.id` — signal-specific context
- Both saved to Firestore via `stageIntent()` → `intentService.createIntent()`

### Memory management
- `firstValueFrom()` for loadConfig — no subscription leak
- Async/await pattern — no callback nesting

### Breaking changes
- Old `goToOrder` output fully removed from signal-review-header
- No other consumers found (verified by subagent grep)
- Chart-review's `ReviewHeaderComponent` is a separate component from `SignalReviewHeaderComponent` — no conflict

### Circular dependency
- chart-review imports SignalReviewFacade; facade does not import chart-review
- No circular dependency risk

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 77/77 PASS (28 ticket + 16 queue + 15 container + 18 facade)

---

## Files changed

| File | Status | Lines | Description |
|---|---|---|---|
| `stores/signal-review.facade.spec.ts` | NEW | 296 | 18 tests: staging, fields, id format, error, dedup |
| `stores/signal-review.facade.ts` | MODIFIED | 426 | Added stageAcceptedOrders + buildIntentId, injected OrderStagingStore, TradingConfigService, MatSnackBar |
| `components/signal-review-header/signal-review-header.component.ts` | MODIFIED | 90 | Renamed goToOrder output to stageAccepted |
| `components/signal-review-header/signal-review-header.component.html` | MODIFIED | 49 | Stage button with isActionableRun check |
| `pages/signal-review/signal-review.component.ts` | MODIFIED | 166 | Renamed goToOrder to stageAcceptedOrders |
| `pages/signal-review/signal-review.component.html` | MODIFIED | 35 | Updated event binding |
| `components/review-header/review-header.component.ts` | MODIFIED | 62 | Added acceptedCount input + stageAccepted output |
| `components/review-header/review-header.component.html` | MODIFIED | 106 | Added Stage button with pill count |
| `components/review-header/review-header.component.scss` | MODIFIED | 296 | Added .stage-accepted-btn styles |
| `pages/chart-review/chart-review.component.ts` | MODIFIED | 308 | Injected SignalReviewFacade, added stageAcceptedOrders |
| `pages/chart-review/chart-review.component.html` | MODIFIED | 22 | Wired acceptedCount + stageAccepted to header |
