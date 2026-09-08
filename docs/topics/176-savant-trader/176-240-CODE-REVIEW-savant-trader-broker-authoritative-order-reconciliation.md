**topic:** savant trader — broker-authoritative order reconciliation  
**issue:** #237 (BE Blueprint)  
**topic parent:** #176  
**domain:** savant-trader  
**type:** code review  
**status:** complete — reviewed BE normalization remains valid under ADR-008  
**verdict:** PASS  
**review pass:** 2 (re-review after fixes)  
**created:** 2026-09-06  
**last updated:** 2026-09-07

---

> **Note on ADR-008:** The BE normalization adapter reviewed in this document (task #240) **remains valid** under [ADR-008](../../adr/ADR-008_signal-entry-record.md). ADR-008 supersedes the Trading Case / reconciliation module model on the frontend, but the BE broker adapter that normalizes RH order and position responses is independent and continues to be used.

---

# Code Review: Task #240 — BE Normalize Robinhood orders and positions

## Scope

Reviewed the Task #240 BE implementation after two review passes. Pass 1 found 2 critical and 11 major findings. All were fixed. Pass 2 found 2 major and 5 minor findings. All were fixed. This is the final verdict.

**Files reviewed:**
- `functions/src/rh-agent-mcp/broker/broker-adapter-errors.ts` (17 lines)
- `functions/src/rh-agent-mcp/broker/broker-adapter-helpers.ts` (38 lines)
- `functions/src/rh-agent-mcp/broker/broker-order-normalizer.ts` (173 lines)
- `functions/src/rh-agent-mcp/broker/broker-position-normalizer.ts` (113 lines)
- `functions/src/rh-agent-mcp/broker/broker-order-adapter.ts` (170 lines)
- `tests/functions/broker-order-normalizer.test.ts` (270 lines)
- `tests/functions/broker-position-normalizer.test.ts` (103 lines)
- `tests/functions/broker-order-adapter-integration.test.ts` (228 lines)
- `tests/functions/broker-position-adapter-integration.test.ts` (149 lines)
- `shared/robinhood-mcp-utils.ts` (added `isPlainObject`)
- `shared/trading-case/broker-order.ts` (added `skipped` field)
- `functions/src/rh-agent-mcp/tools/robinhood-tool-executor.ts` (imports shared `isPlainObject`)
- `functions/src/options-strategy-engine/mcp/robinhood-mcp-session-manager.ts` (imports shared `isPlainObject`)
- `functions/src/options-strategy-engine/quote-providers/rh-mcp-option-quote-provider.ts` (imports shared `isPlainObject`)
- `functions/package.json` (updated test script)

## Test results

- 48/48 tests pass (9 suites)
- Typecheck: passed
- Functions build: passed
- Existing `test:rh-agent-mcp-tools`: 20/20 pass (no regressions)
- All files under 300 lines

## Summary

The implementation correctly normalizes Robinhood broker order and position responses into the shared contracts. Pass 1 critical findings (unredacted PII retention, silent side coercion) and all major findings (filter mappings, error categories, dispatch by shape, skipped count, timeout tests, code duplication, file size) have been fixed and verified in pass 2.

## Pass 1 findings — all fixed

### Critical (fixed)
- **C1:** `rawResponse` now uses `result.redacted` — no PII leakage. Integration test verifies `account_number` is masked.
- **C2:** `normalizeBrokerOrder` validates `side` is `'buy'` or `'sell'`; throws `BrokerAdapterError` on unknown values.

### Major (fixed)
- **M1:** `agent` filter mapped to `placed_agent` (matches tool schema).
- **M2:** `since` filter mapped to `created_at_gte`.
- **M3:** `limit` filter removed (not in tool schema).
- **M4:** `getToolLevelErrorMessage` reads nested error messages from `parsed.data.error`.
- **M5:** `BrokerAdapterError` carries `category` field; adapter propagates from executor.
- **M6:** `listOrders` dispatches by shape via `extractOrderList` — empty lists aren't masked.
- **M7:** `skipped` count surfaced in `BrokerOrderPage` and `RawSymbolPositionPage`.
- **M8:** Timeout test added — races `withTimeout` against a never-resolving promise.
- **M9:** `isPlainObject` extracted to `shared/robinhood-mcp-utils.ts`; 3 duplicates removed.
- **M10:** Placeholder `broker-order-adapter.test.ts` deleted.
- **M11:** Normalizer split into `broker-order-normalizer.ts` and `broker-position-normalizer.ts`.

## Pass 2 findings — all fixed

### Major (fixed)
- **P2-1:** Duplicated helpers (`optionalString`, `extractCursor`, `inferInstrumentType`) extracted to `broker-adapter-helpers.ts`.
- **P2-2:** Unused `normalizeSymbolPosition` import removed from adapter.
- **P2-3:** Integration test file split — position/timeout tests moved to `broker-position-adapter-integration.test.ts` (149 lines). Order integration test is now 228 lines.

### Minor (fixed)
- **P2-4:** `getOrder` now uses `extractOrderList` for all list shapes (not just `results`).
- **P2-5:** Dead `AdapterToolResult.parsed` field removed.
- **P2-6:** Unnecessary type assertion on error category removed.
- **P2-7:** Non-object list elements now flow through to normalizer where they're caught and counted in `skipped`.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| Nested `parsed.data.order` responses normalize correctly. | MET |
| Embedded MCP `isError` responses are rejected. | MET |
| Broker order IDs are required for successful order mirrors. | MET |
| Pagination and timeout behavior are tested. | MET |
| Raw broker responses are retained without sensitive data leakage. | MET |

## BE test plan status

| Criterion | Status |
|---|---|
| Broker adapter output is independent of MCP response nesting. | MET |
| A tool-level error never creates a Broker Order mirror. | MET |
| A successful broker order always has a broker order ID. | MET |
| Repeated identical broker responses are idempotent. | DEFERRED (reconciliation layer) |
| Pagination produces a complete source snapshot. | DEFERRED (reconciliation layer) |
| Redaction rules prevent account and credential leakage. | MET |

The two DEFERRED items belong to the reconciliation/Firestore layer, not the adapter/normalizer scope of Task #240.

## Out of scope (noted, not blocking)

- Frontend `isPlainObject` duplication in `observation-dashboard.model.ts` — outside Task #240 scope.
- `rh-mcp-option-quote-provider.ts` file size (315 lines) — pre-existing, only import line changed.
- `withTimeout` pattern similarity between adapter and executor — different error types, acceptable.
- Adapter file naming (`broker-order-adapter.ts` contains `listPositions`) — matches the shared `BrokerOrderAdapter` interface.

## Verdict

**PASS** — All critical and major findings from both review passes have been fixed and verified. All acceptance criteria within the adapter/normalizer scope are MET. The implementation is ready for QA.

## File structure

```
functions/src/rh-agent-mcp/broker/
├── broker-adapter-errors.ts       (17 lines)  — BrokerAdapterError with category
├── broker-adapter-helpers.ts      (38 lines)  — shared helpers (optionalString, extractCursor, inferInstrumentType)
├── broker-order-normalizer.ts     (173 lines) — order normalization
├── broker-position-normalizer.ts  (113 lines) — position normalization
└── broker-order-adapter.ts        (170 lines) — adapter wrapping executor

tests/functions/
├── broker-order-normalizer.test.ts              (270 lines) — order normalizer unit tests
├── broker-position-normalizer.test.ts           (103 lines) — position normalizer unit tests
├── broker-order-adapter-integration.test.ts     (228 lines) — order adapter integration tests
└── broker-position-adapter-integration.test.ts  (149 lines) — position/timeout integration tests
```
