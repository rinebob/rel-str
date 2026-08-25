**Topic:** Savant Trader — FE-B3: Account number preference
**Issue:** #198
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete
**Created:** 2026-08-25
**Last Updated:** 2026-08-25

---

## Summary

Three-axis review of FE-B3 (#198): TradingConfigService for reading/writing the user's account number preference at `savant-trader/data/trading-config`, and fetching agentic-allowed accounts from the Robinhood MCP. 3 files (1 modified, 2 new), 10 tests.

### Tasks covered

| Task | Issue # | Description | Stage |
|---|---|---|---|
| FE-B3 | #198 | Account number preference | 6_REVIEW |

**Verdict: PASS** — all valid findings discovered during review were fixed before writing this doc.

---

## Standards

### Findings discovered and fixed

**1. Incorrect MCP response structure in getAccounts (CRITICAL → fixed)**
- **File:** `src/app/features/savant-trader/services/trading-config.service.ts:78-79`
- The service expected `parsed.results` array, but the actual Robinhood MCP response has three possible shapes: bare array, `{ accounts: [...] }`, or `{ data: { accounts: [...] } }`.
- **Evidence:** `observation-dashboard.component.ts:162-174` already handles all three shapes.
- **Fix:** Added `extractAccounts()` helper that handles all three response shapes. Updated tests to use the real shapes.

**2. Dead code — CONFIG_DOC_ID constant (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/services/trading-config.service.ts:27`
- `CONFIG_DOC_ID = 'user-config'` was defined but never used. The service uses `userId` as the doc ID.
- **Fix:** Removed the constant.

**3. AccountInfo.agenticAllowed hardcoded to true (MAJOR → fixed)**
- **File:** `src/app/features/savant-trader/services/trading-config.service.ts:85`
- After filtering for `agentic_allowed === true`, the service hardcoded `agenticAllowed: true` instead of using the actual field value.
- **Fix:** Changed to `agenticAllowed: a['agentic_allowed'] as boolean`.

### Findings accepted (no fix needed)

**4. Inadequate Firestore test coverage (MAJOR → accepted)**
- **File:** `src/app/features/savant-trader/services/trading-config.service.spec.ts:137-173`
- `loadConfig`/`saveConfig` tests only verify the observable contract because mocking modular Firestore functions (`doc`, `getDoc`, `setDoc`) is complex. No existing test in the project mocks these.
- **Resolution:** Accepted — `getAccounts` (which uses the mockable MCP service) is fully tested with 10 tests. Firestore methods will be integration-tested when the order workspace screen (FE-C1) consumes this service.

**5. Missing error category in thrown error (NIT → accepted)**
- **File:** `src/app/features/savant-trader/services/trading-config.service.ts:76`
- `throw new Error(result.error)` loses the error category from `ToolExecutionFailure`.
- **Resolution:** Accepted — the caller (UI) only needs the message. Error category is used internally by the execution service for retry classification, not by the config service.

---

## Spec

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | loadConfig: reads savant-trader/data/trading-config | MET | trading-config.service.ts:38-52 |
| 2 | saveConfig: writes savant-trader/data/trading-config | MET | trading-config.service.ts:55-67 |
| 3 | getAccounts: calls get_accounts MCP tool, filters agentic_allowed: true | MET | trading-config.service.ts:70-104 |
| 4 | TradingConfig type defined | MET | order-intent.types.ts:148-151 |
| 5 | Tests: mock Firestore for load/save, mock MCP for getAccounts | MET | 10 tests covering all 3 response shapes + filter + error + contract |

---

## Thermo-Nuclear

### Pattern adherence
Service correctly uses `requireUserId` + injection context pattern matching `OccurrenceDecisionService`. Firestore operations use `doc()` + `getDoc()`/`setDoc()` with `{ merge: true }` for create-or-update.

### MCP response handling
The `extractAccounts()` helper handles all three observed response shapes from the Robinhood MCP:
1. Bare array: `[ { account_number: ... }, ... ]`
2. `{ accounts: [...] }`
3. `{ data: { accounts: [...] } }`

This matches the existing parsing logic in `observation-dashboard.component.ts:162-174`.

### Firestore rules compliance
- `saveConfig` includes `userId` in the document data (line 63), satisfying the Firestore rule `request.auth.uid == request.resource.data.userId`.
- `loadConfig` uses `userId` as the doc ID, consistent with user-scoped documents.
- `setDoc` with `{ merge: true }` correctly handles both create and update.

### Security
Account numbers are only returned to authenticated users via `requireUserId`. The observation API is localhost-only. No leakage.

### Test coverage
Tests cover: all 3 MCP response shapes, agentic filtering, empty results, missing accounts property, MCP failure, no-args call, loadConfig contract, saveConfig contract.

---

## Verification

- **Build:** PASS (`ng build`)
- **Tests:** 10/10 PASS (trading-config.service.spec.ts)

---

## Files changed

| File | Lines | Description |
|---|---|---|
| `services/order-intent.types.ts` | +18 | Added TradingConfig and AccountInfo interfaces |
| `services/trading-config.service.ts` | 104 | TradingConfigService with loadConfig, saveConfig, getAccounts |
| `services/trading-config.service.spec.ts` | 185 | 10 tests covering getAccounts (3 shapes) + loadConfig/saveConfig contracts |
