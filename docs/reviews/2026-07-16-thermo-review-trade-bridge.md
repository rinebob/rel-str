# Thermo-Nuclear Code Review — RH Agent Trade Bridge and Trade Management

> **Superseded legacy-source policy — 2026-07-17:** This review is retained as historical evidence of the working bridge and its hardening. Later owner direction requires the exact implementation to be preserved in archive documents and executable copies to be deleted from the active tree. Any recommendation below to retain or isolate executable legacy source is superseded by `RH-AGENT-LEGACY-CLAUDE-BRIDGE-ARCHIVE-2607-01.md` and `RH-AGENT-LEGACY-CLAUDE-BRIDGE-SOURCE-ARCHIVE-2607-01.md`.

**Date:** 2026-07-16  
**Scope:** All current working-tree changes, with emphasis on the local Claude Code + Robinhood MCP trade bridge, Order-page execution flow, trade persistence, Firestore rules, and Trade Management page.  
**Review framework:** `.devin/skills/thermo-nuclear-code-review.md`, `.devin/skills/rh-agent-coding-guidelines.md`, and `.devin/skills/rel-str-coding-guidelines.md`.  
**Historical status at review time:** **Items #1 and #2 complete; simplified direct MCP Phase A for #3–#8 remained.**
**Current status:** The secured legacy Claude implementation, Order-page execution/persistence integration, and legacy tests are preserved in exact archive snapshots and deleted from the active tree. Direct execution, account-wide monitoring, persistence, protection, UI, and tests are not implemented yet.

---

## Review Summary

The implementation successfully placed a real Robinhood order through the local bridge, and the latest result-validation change correctly requires an order ID and broker state before marking the bridge result confirmed. The Angular build and Functions typecheck pass.

The review originally identified three critical blockers:

1. The local bridge could accept unauthorized live-trade requests. **Resolved on 2026-07-16.**
2. Sensitive live order/account data was written to an unignored local file. **Resolved on 2026-07-16.**
3. A queued/submitted broker order is persisted as an open trade with locally fabricated fill data. **Open; direct MCP design is now established.**

Authenticated discovery found 49 deterministic Robinhood MCP tools. The required broker-sync resources exist: order lookup/history, current positions, open tax lots, closed/realizing trade history, aggregate realized P&L, portfolio values, and caller-generated `ref_id` idempotency. This selects the minimal broker-synchronized Path A in `docs/implementations/RH-AGENT-BROKER-SYNC-SPIKE-2607-01.md`.

The agreed product scope is defined in `docs/implementations/RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`: one human-authorized whole-share market entry at a time, account-wide monitoring and capacity, broker-held stop protection, simple manual exits, and a one-minute synthetic target. Rare broker exceptions are shown for direct Robinhood intervention rather than handled by a general recovery engine.

The production path calls exact MCP tools with exact JSON arguments and typed parsers; it does not send a prompt to an LLM. The existing secured Claude subprocess implementation is retained without being invoked by the normal UI, backend exports, schedulers, or policies. Robinhood itself is the emergency fallback.

---

## Validation Performed

- [x] Angular development build passed:
  - `npm run build -- --configuration development --no-progress`
- [x] Functions TypeScript typecheck passed:
  - `npm --prefix functions run typecheck`
- [x] `git diff --check` passed, with line-ending warnings only.
- [ ] Functions lint did not run successfully.
  - Existing issue: `functions/.eslintrc.js` uses CommonJS while `functions/package.json` declares `"type": "module"`.
- [x] Bridge security and request-validation regression tests now pass.
- [ ] Regression tests are still missing for execution persistence, broker lifecycle, and Trade Management behavior.

---

# Blockers

## 1. Secure the local bridge against unauthorized live-trade requests

**Resolution:** **Fixed; both focused re-review rounds completed and validated on 2026-07-16.**  
**Severity:** Critical  
**Files:**

- `functions/src/rh-agent/trade-bridge-server.ts:47-53`
- `functions/src/rh-agent/trade-bridge-server.ts:134-165`
- `functions/src/rh-agent/trade-bridge-server.ts:240`

### Finding

At review time, the bridge:

- Sent `Access-Control-Allow-Origin: *`.
- Did not authenticate requests.
- Did not validate the `Origin` header.
- Did not enforce `Content-Type: application/json`.
- Did not limit request-body size.
- Did not strictly validate side, order type, amount range, or limit-price requirements.
- Called `server.listen(PORT)` without explicitly binding to loopback.
- Treated the request as final authorization for real orders.

CORS is not authentication. A malicious website can potentially send a simple request without needing to read the response. If Node binds beyond loopback, another LAN client may also reach the bridge.

### Required design

- Bind only to `127.0.0.1`.
- Maintain an explicit frontend-origin allowlist.
- Reject missing or unapproved origins.
- Require a high-entropy per-session bridge token.
- Require `Content-Type: application/json`.
- Add a strict body-size limit.
- Validate the full request contract.
- Add a maximum batch size and maximum dollar amount.
- Reject unsupported request fields.
- Serialize or otherwise protect concurrent execution requests.
- Handle browser private-network preflight only for approved origins.

### Acceptance checklist

- [x] Server binds only to `127.0.0.1`.
- [x] Wildcard CORS is removed.
- [x] Only approved local/deployed app origins are accepted.
- [x] Missing or invalid `Origin` is rejected for browser trade requests.
- [x] A per-session secret is required and verified with constant-time comparison.
- [x] Invalid content type is rejected.
- [x] Oversized bodies are rejected before JSON parsing.
- [x] Invalid symbol, side, amount, order type, limit price, or batch size is rejected.
- [x] Concurrent duplicate submissions cannot place duplicate orders.
- [x] Security tests cover allowed and denied origins, missing token, invalid token, invalid input, and oversized input.

### Implementation evidence

- The bridge reuses the canonical `RH_AGENT_ALLOWED_ORIGINS` list.
- A fresh 256-bit token is generated at every bridge startup and compared with `timingSafeEqual`.
- The token is printed only in the local bridge terminal and retained by the Angular app in `sessionStorage`.
- The Angular request sends the token through `X-Trade-Bridge-Token`; a 401 response clears the stale browser token.
- Browser private-network preflight is supported only for approved origins.
- Validation is isolated in `functions/src/rh-agent/trade-bridge-security.ts`.
- The bridge execution gate rejects a second concurrent request with HTTP 409.
- The bridge now has a single request handler, which also resolves the duplicate `/health` response bug from finding #11.

### Validation

- [x] 25 bridge security tests passed: 14 policy tests, 10 real HTTP-boundary integration tests, and 1 startup-output regression test.
- [x] Live HTTP smoke checks passed: approved preflight `204`, denied origin `403`, and missing token `401`.
- [x] Functions TypeScript typecheck passed.
- [x] Angular development build passed.
- [x] `git diff --check` passed with line-ending warnings only.
- [x] Canonical `npm run validate` passed: Angular build, Functions typecheck, 8 frontend bridge-client tests, and all 25 backend bridge tests.

### Focused re-review follow-ups

The runtime authorization controls passed focused review, and the following ordered follow-ups are now complete.

#### 1A. Test the actual HTTP security boundary

**Severity:** High  
**Status:** Completed on 2026-07-16

The original suite tested pure helper functions but did not instantiate the HTTP handler. It could not detect regressions in loopback binding, route ordering, CORS/private-network headers, token enforcement, streamed body limits, HTTP status mapping, execution-gate wiring, or the guarantee that rejected requests never invoke the executor.

**Implemented fix:**

- Extract a `createTradeBridgeServer()` factory.
- Inject the expected token, allowed origins, trade executor, and result logger.
- Start integration tests on an ephemeral loopback port.
- Use a fake executor that records invocations and can never place a live order.

**Acceptance checklist:**

- [x] Tests prove the server binds to loopback for the production entrypoint.
- [x] Approved preflight returns the exact CORS and private-network headers.
- [x] Missing and denied origins return `403` and never call the executor.
- [x] Missing and invalid tokens return `401` and never call the executor.
- [x] Invalid content type returns `415` and never calls the executor.
- [x] Oversized streamed bodies return `413` and never calls the executor.
- [x] A concurrent request returns `409` while the first request is active.
- [x] The gate is released after validation, executor, and result-logging failures.
- [x] No integration test can invoke Claude or Robinhood MCP.

**Implementation evidence:**

- `createTradeBridgeServer()` requires injected token, origin list, executor, and log writer dependencies.
- `listenTradeBridgeServer()` is shared by production and tests and always binds `127.0.0.1`.
- Integration tests start on ephemeral ports and inject fake executors and loggers.
- Importing the server module does not start production because startup is guarded by the direct-entry check.

#### 1B. Wire security tests into standard test execution

**Severity:** High  
**Status:** Completed on 2026-07-16

The security files intentionally use `*.test.ts`, while the repository Jest configuration discovers Angular `*.spec.ts` tests. Originally, no Functions or root npm script invoked the Node test command, so routine validation could omit the suites.

**Acceptance checklist:**

- [x] A canonical npm script runs all trade-bridge security tests.
- [x] The script exits nonzero on a failing test.
- [x] The script is included in the standard project validation workflow.
- [x] Test naming and runner choice are consistent and documented.

**Implementation evidence:**

- Functions owns `test:trade-bridge`, using its local `tsx` dependency and both explicit `*.test.ts` files.
- The repository root exposes `test:trade-bridge` as the canonical forwarding command.
- The repository root exposes `validate`, which runs the Angular development build, Functions typecheck, and bridge suites in a fail-fast command chain.
- The usage guide documents the Node test runner and its intentional separation from Angular `*.spec.ts` tests.

#### 1C. Enforce the canonical minimum trade amount

**Severity:** Medium  
**Status:** Completed on 2026-07-16

The UI declared a `$1` minimum, but the server originally accepted every finite amount greater than zero.

**Acceptance checklist:**

- [x] A canonical minimum amount constant is `$1`.
- [x] The server enforces `1 <= amount <= 100`.
- [x] Tests reject `$0.99` and accept `$1` and `$100`.
- [x] The usage guide documents both minimum and maximum amounts.

**Implementation evidence:**

- `TRADE_BRIDGE_MIN_TRADE_AMOUNT` and `TRADE_BRIDGE_MAX_TRADE_AMOUNT` define the inclusive server range.
- Policy tests cover rejection at `$0.99` and acceptance at exactly `$1` and `$100`.
- An HTTP integration test proves `$0.99` returns `400` without invoking the executor.
- The usage guide and `400 Bad Request` troubleshooting section document the inclusive range.

#### 1D. Print the startup token only once

**Severity:** Medium  
**Status:** Completed on 2026-07-16

The startup token was originally printed once as the session token and twice more inside curl examples, increasing exposure in terminal captures and diagnostic output.

**Acceptance checklist:**

- [x] The live token is printed exactly once at startup.
- [x] Curl examples use `<SESSION_TOKEN>` or an equivalent placeholder.
- [x] No request, response, or error log records the token.

**Implementation evidence:**

- `formatTradeBridgeStartupMessages()` contains the sole generated-token interpolation on the `Session token:` line.
- Both curl examples use the literal `<SESSION_TOKEN>` placeholder.
- A regression test asserts one generated-token occurrence, two placeholder headers, and no token-bearing curl header.
- The usage guide documents the one-time output and placeholder behavior.

#### 1E. Extract frontend bridge transport into a service

**Severity:** Medium / structural  
**Status:** Completed on 2026-07-16

Token prompting, session storage, endpoint/header constants, HTTP transport, stale-token handling, and bridge response contracts were embedded in the 448-line `RhAgentOrderComponent`.

**Acceptance checklist:**

- [x] A focused bridge client service owns token acquisition and clearing.
- [x] The service owns endpoint/header constants and HTTP transport.
- [x] The service exposes typed success and transport-error results.
- [x] The Order component handles bridge user intent, persistence decisions, and presentation state rather than transport.
- [x] Frontend tests cover token reuse, prompt cancellation, `401` clearing, and request headers.
- [x] `RhAgentOrderComponent` returns below the 400-line strong-smell threshold.

**Implementation evidence:**

- `TradeBridgeClientService` owns browser adapters, token lifecycle, endpoint/header constants, HTTP transport, and typed result normalization.
- Eight focused ChromeHeadless tests cover stored-token reuse, prompt cancellation, prompt trimming/storage and headers, `401` clearing, and browser storage/prompt failures.
- `RhAgentOrderComponent` delegates transport to the service and remains below the 400-line threshold.
- `test:trade-bridge-client` uses an isolated Karma/Jasmine TypeScript config so unrelated legacy specs do not block focused validation.
- The frontend suite is included in the fail-fast `npm run validate` chain.

### Second focused re-review follow-ups

#### 1F. Reject every repeated symbol in a batch

**Severity:** Medium  
**Status:** Completed on 2026-07-16

The prior duplicate fingerprint included side, order type, and limit price, permitting contradictory or multiple live orders for the same normalized symbol.

**Acceptance checklist:**

- [x] A batch permits at most one trade per normalized symbol.
- [x] Opposite-side duplicates are rejected.
- [x] Market/limit duplicates are rejected.
- [x] Different-limit-price duplicates are rejected.
- [x] HTTP rejection occurs before the executor is invoked.

**Implementation evidence:**

- Batch validation now uses a normalized-symbol set.
- Policy tests cover same-side, opposite-side, mixed-order-type, and different-limit-price variants.
- An HTTP integration test proves a conflicting same-symbol batch returns `400` without invoking the executor.

#### 1G. Normalize browser storage failures into typed results

**Severity:** Medium  
**Status:** Completed on 2026-07-16

Token acquisition previously occurred synchronously before the HTTP observable, and storage access during acquisition or `401` clearing could throw instead of returning a typed client result. The Order component could remain in its executing state when that happened.

**Acceptance checklist:**

- [x] Token acquisition and clearing execute inside the observable error boundary.
- [x] Storage and prompt exceptions return a typed `request` error.
- [x] The Order component always clears `bridgeExecuting`.
- [x] Tests cover `getItem`, `setItem`, and `removeItem` failures.

**Implementation evidence:**

- `executeTrades()` uses `defer` so synchronous token acquisition failures enter the RxJS error boundary.
- HTTP, storage, and prompt failures are normalized through the typed `TradeBridgeTransportError` contract.
- Stale-token removal failures return a typed `request` result rather than rethrowing.
- `RhAgentOrderComponent` uses `finalize` to clear `bridgeExecuting` on completion, failure, or unsubscription.
- Four additional ChromeHeadless tests cover `getItem`, prompt, `setItem`, and `removeItem` exceptions.

**Low-severity observation:** Production composition is visibly correct but is not directly instantiated by tests; integration tests exercise the shared factory and loopback listener with injected test configuration.

### Item #1 focused approval bar

- [x] Runtime loopback, origin, token, content-type, size, and concurrency controls are implemented.
- [x] 1A. Actual HTTP boundary is covered by automated integration tests.
- [x] 1B. Security tests run through canonical project tooling.
- [x] 1C. Minimum trade amount is enforced consistently.
- [x] 1D. Startup token is printed only once.
- [x] 1E. Frontend bridge transport is isolated and tested.
- [x] 1F. Every repeated normalized symbol is rejected before execution.
- [x] 1G. Browser storage failures are normalized and execution state always clears.

**Focused re-review status: Approved.**

---

## 2. Remove and ignore sensitive local execution artifacts

**Resolution:** **Fixed and validated on 2026-07-16.**
**Severity:** Critical  
**Files:**

- `functions/.trade-results.json`
- `functions/.gitignore:12-16`
- `functions/src/rh-agent/trade-bridge-server.ts:18`
- `functions/src/rh-agent/trade-bridge-server.ts:192-205`

### Finding

The untracked `.trade-results.json` file contains sensitive live execution data, including account-identifying information and a real broker order ID. The file is not ignored by Git.

The bridge writes complete request objects and raw Claude/Robinhood output. Raw output can include account-specific URLs and identifiers.

### Required design

- Delete the current sensitive artifact from the working tree.
- Ignore `.trade-results.json` and `.trade-prompt.txt`.
- Do not persist raw broker/Claude output in local bridge artifacts by default.
- Keep raw local bridge artifacts separate from durable typed Firestore domain records. Broker orders, errors, fills, positions, and closed trades may require canonical typed persistence under items #3–#7.
- If a local diagnostic log is required, write only a redacted typed record with bounded rotation.

### Acceptance checklist

- [x] Current `.trade-results.json` is removed.
- [x] `.trade-results.json` is added to `functions/.gitignore`.
- [x] `.trade-prompt.txt` is added to `functions/.gitignore`.
- [x] Raw account-specific output is no longer persisted to local bridge files.
- [x] No local bridge audit log is retained; redaction is therefore not applicable.
- [x] No persistent local raw-log artifact exists, so unbounded local growth is eliminated.
- [x] Removal of the local artifact does not remove Firestore trade records or prohibit typed canonical broker/trade persistence.
- [x] `git status --short` shows no sensitive execution artifacts.

### Implementation evidence

- The bridge no longer imports filesystem APIs or defines a result-log path, log-entry contract, or log writer.
- Claude prompts remain in process memory and are sent directly through child-process stdin.
- The HTTP server no longer accepts or invokes a persistence callback after execution.
- Both legacy artifact names are ignored in the Functions-local ignore file as defense in depth.
- The existing sensitive result artifact was physically deleted from the working tree.
- The operating guide now documents the no-persistent-log design and safe troubleshooting path.

### Validation

- [x] `npm run validate` passed: Angular build, Functions typecheck, 8 frontend tests, and 26 backend tests.
- [x] Regression tests verify both legacy artifact names remain ignored and filesystem persistence is not reintroduced.
- [x] `git check-ignore -v --no-index` resolves both names to `functions/.gitignore`.
- [x] Filesystem checks report both legacy artifacts absent.
- [x] Source inspection finds no `writeFile`, `appendFile`, legacy artifact path, `writeLog`, or `TradeBridgeLogEntry` symbol.
- [x] Focused `git diff --check` passed with line-ending warnings only.

---

## 3. Model broker order submission separately from an open/filled trade

**Severity:** Critical  
**Files:**

- `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:363-373`
- `src/app/features/rh-agent/services/rh-agent-execution.service.ts:102-130`
- `src/app/features/rh-agent/services/rh-agent.types.ts:118-151`

### Finding

The bridge returns broker data such as `orderId`, `state`, and estimated shares, but the frontend discards those fields and passes the original UI row to persistence.

Persistence then creates an `OPEN` trade with:

- `entryAt` set to the submission time.
- `entryPrice` set to the signal close or estimated UI price.
- `quantity` calculated as whole shares with `Math.floor(positionSize / entryPrice)`.
- No broker order ID.
- No broker order state.

This is incorrect for queued, pending, rejected, cancelled, partially filled, or fractional dollar orders. A queued order is broker-accepted but not filled.

### MCP discovery decision — 2026-07-17

The capability spike and full 49-tool inventory are complete at the schema level. Path A is selected for the simplified Phase A bridge:

```text
persist exact authorized intent and ref_id
→ call place_equity_order directly with exact typed arguments
→ persist broker acknowledgement or ambiguous state
→ refresh relevant orders across the configured account
→ synchronize the complete account position snapshot
→ synchronize required closed/realizing history
```

Relevant broker states are `new`, `queued`, `confirmed`, `unconfirmed`, `partially_filled`, `filled`, `cancelled`, `rejected`, `failed`, and `voided`. Preserve them rather than collapsing submission into an open trade.

Persist separate concepts:

- Local execution attempt, source-run linkage, and persisted `ref_id`.
- Broker order projection keyed by Robinhood order UUID.
- Current broker position projection from complete paginated snapshots.
- Closed/realizing broker trade projection from `get_pnl_trade_history`.
- Optional replaceable tax-lot projection or on-demand lot reads.

A queued, confirmed, or partial order remains an order. A position is created or updated only from Robinhood-reported position/fill facts. Signal close and locally calculated whole shares remain estimates and are never stored as actual broker fill price or quantity.

On-demand refresh is implemented first. One-minute cloud stop/target monitoring remains deferred until unattended backend Robinhood OAuth and token refresh are proven. Phase A does not recreate a local order-event ledger, tax-lot engine, automatic replacement flow, or rare-state recovery engine.

### Acceptance checklist

- [ ] Submitted orders and open positions are separate concepts.
- [ ] Broker order ID is persisted.
- [ ] Broker order state is persisted.
- [ ] Queued/pending orders are not represented as filled/open trades.
- [ ] Signal close is not persisted as actual entry price.
- [ ] Locally calculated whole-share quantity is not persisted as actual fractional quantity.
- [ ] Fill price and quantity come from broker reconciliation or broker-provided trade/position history.
- [ ] Rejected/cancelled orders remain visible without becoming open trades.
- [ ] Multiple orders and trades for the same symbol/day cannot overwrite one another.
- [ ] On-demand refresh is supported; an early-morning poll is added only through an authenticated backend path.
- [ ] Tests cover every state and broker data shape actually exposed by the MCP, including queued/pending and filled outcomes.

---

## 4. Make order placement and persistence idempotent and reconcilable

**Severity:** High  
**Files:**

- `src/app/features/rh-agent/services/rh-agent-firestore-helpers.ts:59-67`
- `src/app/features/rh-agent/services/rh-agent-execution.service.ts:84-130`
- `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:358-389`

### Finding

The real broker order is placed before Firestore persistence. If Firestore fails, the order exists at Robinhood but the app does not record it.

The trade document ID contains symbol, market date, timeframe, and signal type, but not the broker order ID, execution-attempt ID, or run ID. A retry can place a second real order while overwriting the same Firestore document.

### Required design

- Generate a unique execution-attempt ID and UUID `ref_id` for each logical order.
- Persist the attempt, exact decimal-string order terms, source metadata, and `ref_id` before broker submission.
- Record a pre-dispatch state such as `PREPARED`, then `DISPATCHED`, `ACKNOWLEDGED`, `AMBIGUOUS`, or `FAILED`.
- Submit `ref_id` through `place_equity_order`.
- On timeout or ambiguous transport failure, query `get_equity_orders` before permitting a retry.
- Retry only when safe and only with the original persisted `ref_id`.
- Never generate a replacement `ref_id` for the same logical order.
- Use broker order UUID as canonical post-acknowledgement identity.
- Make repeated refreshes and repeated confirmed results idempotent broker-identity upserts.
- Never automatically fall back to the legacy Claude pathway after an ambiguous direct-MCP submission; reconcile first to prevent duplicate orders.

### Acceptance checklist

- [ ] Every direct-MCP submission gets a stable execution-attempt ID and UUID `ref_id`.
- [ ] Order intent and exact order terms exist before calling the broker.
- [ ] Broker order ID is unique in storage.
- [ ] A repeated response or refresh cannot create a duplicate order record.
- [ ] A retry after timeout is blocked until reconciliation completes.
- [ ] An ambiguous retry reuses the original `ref_id`.
- [ ] Automatic fallback to legacy Claude is prohibited after ambiguous direct submission.
- [ ] Firestore failure after broker success produces a recoverable reconciliation state.
- [ ] Tests cover duplicate clicks, timeout, Firestore failure, repeated refreshes, and retry.

---

## 5. Add a separate canonical direct Robinhood MCP path; isolate and disable the legacy Claude implementation

**Severity:** High / structural  
**Disabled legacy reference location:** `functions/src/rh-agent/` and its existing Angular bridge client

**New backend location:** `functions/src/rh-agent-mcp/`

**New frontend integration location:** `src/app/features/rh-agent/services/robinhood-mcp/`

### Discovery finding

MCP calls are deterministic API operations. A direct client sends an exact tool name and JSON arguments over MCP Streamable HTTP; no natural-language prompt or LLM decision is required. The 49-tool catalog provides exact input schemas, including `review_equity_order`, `place_equity_order`, order lookup/history, positions, lots, and closed-trade history.

The current Claude bridge remains a fragile protocol because it builds prose, launches Claude, and parses model output. It is secured and tested as a local boundary, but it is not an operational fallback once direct MCP placement is available. Retaining it as an isolated, disabled reference avoids reconstruction cost without allowing it to bypass direct-path capacity, authorization, and protection.

### Required separation

Do not modify the legacy path merely to implement direct MCP. Build new code with separate contracts and entrypoints:

```text
Angular RobinhoodMcp service
→ narrow authenticated backend callable/endpoint
→ functions/src/rh-agent-mcp typed broker facade
→ authenticated MCP SDK client
→ review_equity_order / place_equity_order / read-only sync tools
→ strict response parser
→ typed broker DTO
```

The new backend location should separate responsibilities such as:

```text
functions/src/rh-agent-mcp/contracts
functions/src/rh-agent-mcp/client
functions/src/rh-agent-mcp/parsers
functions/src/rh-agent-mcp/orders
functions/src/rh-agent-mcp/sync
functions/src/rh-agent-mcp/callables
```

Exact filenames may follow repository conventions, but new direct code must not be placed inside the legacy `functions/src/rh-agent/` bridge directory.

### Execution and fallback rules

- Direct MCP is the only RH Agent execution path.
- Keep the legacy Claude implementation in isolated source, but remove/disable normal UI, backend export, scheduler, and policy entrypoints that can invoke it.
- Re-enabling legacy execution requires a separate explicit decision and security review.
- If direct MCP returns ambiguously, reconcile with Robinhood before any retry.
- Never send the same logical order through the legacy path because the direct response timed out.
- Use the Robinhood app or site for emergency manual intervention.
- Keep OAuth tokens, account numbers, and MCP sessions out of the browser.
- Do not expose a generic `{ tool, arguments }` backend proxy; expose narrow allowlisted operations.

### Acceptance checklist

- [ ] New direct-MCP code lives under `functions/src/rh-agent-mcp/`.
- [ ] New Angular integration lives under `src/app/features/rh-agent/services/robinhood-mcp/`.
- [ ] Existing `functions/src/rh-agent/` Claude implementation remains isolated but is disabled from normal execution.
- [ ] Direct MCP uses exact tool calls without a Claude subprocess or prompt.
- [ ] Direct and legacy source boundaries remain separately testable.
- [ ] Direct MCP is the only enabled RH Agent execution path.
- [ ] No automatic fallback occurs after an ambiguous response.
- [ ] Only strict typed broker responses can acknowledge direct submission.
- [ ] Invalid or unexpected broker content and states fail closed.
- [ ] Tests use injected fake MCP transports and cannot place live orders.

---

## 6. Narrow the Firestore trade schema and security rules

**Severity:** High  
**Files:**

- `firestore.rules:133-145`
- `firestore.rules:208-216`
- `src/app/features/rh-agent/services/rh-agent-trade.service.ts:38-69`

### Finding

The recursive rule `/{path=**}/trades/{tradeId}` applies to every subcollection named `trades`, including the unrelated user trade-journal hierarchy. Firestore allow rules are OR-combined, so the recursive match can authorize writes based only on document `userId` without enforcing parent-path ownership.

The generic subcollection name forced a broad security rule.

### MCP-informed required design

Path A needs distinct root collections rather than one ambiguous trade document:

```text
rh-agent-execution-attempts/{attemptId}
rh-agent-broker-orders/{brokerOrderId}
rh-agent-broker-positions/{positionId}
rh-agent-broker-trades/{brokerTradeId}
```

Optional cached lots, if needed, use a distinct broker-lot collection rather than generic `trades`.

- Order intents/attempts preserve `refId`, exact requested terms, optional run/occurrence provenance, and ambiguous-state reconciliation.
- Broker orders are upserted by Robinhood order UUID.
- Broker positions are replaceable projections from complete paginated snapshots.
- Broker trades are upserted from `get_pnl_trade_history` using a stable identity established by response discovery.
- Decimal prices and quantities remain strings in canonical broker DTOs.
- `runId` and occurrence IDs are metadata, never document identity or visibility boundaries.

The direct MCP backend should own canonical writes through Admin SDK after authentication and authorization. Client rules should allow authenticated users to read only their records and should deny direct client mutation unless a narrowly justified operation is designed separately. This avoids trusting browser-supplied broker IDs, states, fills, or `userId`.

Legacy `trades` data remains untouched during initial direct-MCP development. Define a later non-destructive migration or read-only compatibility decision after new projections are validated.

### Acceptance checklist

- [ ] Direct MCP records use unique `rh-agent-*` root collections and never the generic `trades` collection group.
- [ ] Execution attempts, broker orders, positions, and closed trades are separate schemas.
- [ ] Canonical broker writes are backend-only.
- [ ] Authenticated reads require `resource.data.userId == request.auth.uid`.
- [ ] Direct client create, update, and delete are denied for broker-authoritative projections.
- [ ] Cross-user reads and writes are denied.
- [ ] Legacy records receive a documented non-destructive compatibility or migration decision.
- [ ] Firestore emulator tests cover own-user reads, cross-user denial, and denied client mutations.
- [ ] Required indexes support user/state/time queries for each projection.

---

## 7. Make Trade Management cross-run and reactively loadable

**Severity:** High  
**Files:**

- `src/app/features/rh-agent/pages/rh-agent-trades/rh-agent-trades.component.ts:27-43`
- `src/app/features/rh-agent/services/rh-agent-trade.service.ts:38-69`
- `src/app/features/rh-agent/stores/rh-agent-trade.store.ts:62-77`

### Finding

Trade Management loads only trades whose source `runId` equals the latest completed run. A position opened from an earlier run disappears after a newer RH Agent run completes.

Direct navigation is also fragile: if `latestCompletedRun()` is unavailable during `ngOnInit`, the component returns and never retries.

Active trade management is a portfolio/order concern, not a latest-run concern. Run ID should remain source metadata rather than the page's visibility boundary.

### MCP-informed required design

Trade Management becomes a broker-state view with separate queries:

```text
open/nonterminal orders
→ rh-agent-broker-orders by userId + brokerState + broker time

current positions
→ rh-agent-broker-positions by userId + symbol

closed/realizing history
→ rh-agent-broker-trades by userId + brokerTimestamp with pagination/date filters
```

- Add **Refresh from Robinhood** through the new direct-MCP backend.
- Refresh relevant account orders with an overlapping `created_at_gte` watermark and every cursor; placement source is provenance, not a management boundary.
- Reconcile every position in the configured Agentic account only after a complete successful paginated snapshot.
- Refresh closed history independently of the latest RH Agent run.
- Use reactive initialization from authenticated user state rather than one synchronous `ngOnInit` read.
- Preserve source run and occurrence links as metadata when a synchronized broker record can be linked to a local attempt.
- Show stale, partial-refresh, authentication, throttling, and parse failures rather than silently replacing good data.
- Keep every account position and relevant order visible regardless of whether it originated in RH Agent, Robinhood, or the disabled legacy implementation.

### Acceptance checklist

- [ ] Open orders and positions from previous runs remain visible.
- [ ] RH Agent-originated and externally initiated account activity can coexist without identity collisions.
- [ ] Closed broker history is queryable independently of latest run.
- [ ] **Refresh from Robinhood** uses the new backend and reports partial/failure status.
- [ ] Direct navigation loads after authentication/store initialization.
- [ ] Loading and synchronization failures are shown to the user.
- [ ] Queries are indexed and closed history is paginated.
- [ ] Tests cover direct navigation, run transition, external account activity, complete snapshot removal, and partial snapshot safety.

---

## 8. Add regression and security tests for the live-trading path

**Severity:** High  
**Status:** Partially completed on 2026-07-16; legacy bridge security, HTTP-boundary, and frontend client coverage are implemented. Direct MCP broker lifecycle, persistence, rules, and reconciliation tests remain dependent on items #3–#7.
**Legacy test files:** `tests/functions/trade-bridge-security.test.ts`, `tests/functions/trade-bridge-http.test.ts`, and `src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts` remain intact.
**New test location:** add direct backend tests under `tests/functions/rh-agent-mcp/` and frontend tests beside `src/app/features/rh-agent/services/robinhood-mcp/`.

### Required coverage

Legacy tests continue covering:

- Loopback bridge authentication and origin enforcement.
- Legacy request schema, amount, and batch limits.
- Injected fake executor behavior with no live Claude or Robinhood calls.

New direct-MCP tests cover:

- Allowlisted typed tool boundary; generic arbitrary tool dispatch is impossible.
- Strict parsing of MCP content blocks and malformed/non-JSON content.
- Exact documented order states, including new, queued, confirmed, unconfirmed, partial, filled, cancelled, rejected, failed, and voided.
- Pagination completion and cursor failure.
- Complete position-snapshot reconciliation versus partial-snapshot safety.
- Stable broker-order and closed-trade identity upserts.
- Duplicate click, persisted `ref_id`, ambiguous timeout, reconciliation, and same-`ref_id` retry.
- Prohibition on automatic direct-to-legacy fallback.
- Firestore failure after broker success.
- Backend-only broker writes and cross-user denial.
- Trade Management direct navigation, cross-run data, external account activity, and refresh failures.
- The prior false-success regression.
- Fake MCP transport injection so no automated test can place, review, or cancel a live order.

### Acceptance checklist

- [x] Pure bridge security and request-policy tests exist.
- [ ] Separate direct-MCP broker adapter and parser tests exist under the new test location.
- [x] Legacy frontend bridge-client tests remain intact.
- [ ] New direct-MCP frontend service tests exist.
- [ ] Firestore rules emulator tests exist for the new root collections.
- [x] Legacy HTTP-boundary integration tests use an injected fake executor and cannot invoke Claude or Robinhood.
- [ ] Direct-MCP tests use an injected fake transport and cannot contact Robinhood.
- [x] No current automated test can place a live order.
- [ ] Canonical validation runs both legacy and new fake-only suites; live execution remains outside CI.

---

# Structural and Maintainability Findings

## 9. Extract bridge transport and result reconciliation from `RhAgentOrderComponent`

**Severity:** Medium / structural  
**Status:** Legacy extraction completed on 2026-07-16. `TradeBridgeClientService` remains an isolated, disabled Claude-bridge reference client. Direct MCP submission and broker synchronization must be added as separate services under `src/app/features/rh-agent/services/robinhood-mcp/`; do not expand the legacy service into a dual-path transport.
**File:** `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts`

### Finding

The component has crossed the RH Agent guideline's 400-line strong-smell threshold. It now owns:

- Run initialization.
- Decision reconciliation.
- Trade-row state.
- Prompt generation.
- Clipboard and web navigation.
- Bridge HTTP transport.
- Broker-result interpretation.
- Firestore execution dispatch.

### Required design

Keep `TradeBridgeClientService` isolated as the disabled legacy adapter. Add a separate direct-MCP facade that owns:

- Direct order review and placement requests.
- Typed backend result normalization.
- On-demand Robinhood refresh.
- Broker-result-to-projection orchestration.

The component owns user intent and presentation state. It must not parse MCP content, hold OAuth/account credentials, or expose a legacy/direct execution selector.

### Acceptance checklist

- [x] Legacy HTTP bridge details remain outside the component.
- [x] Legacy contracts remain defined in isolated `TradeBridgeClientService` source.
- [ ] Normal UI entrypoints cannot invoke the legacy adapter.
- [ ] Direct MCP contracts and transport are defined in separate `robinhood-mcp` services.
- [ ] Broker-result-to-persistence mapping is tested outside the component.
- [ ] No UI execution-path selector or automatic fallback exists.
- [x] Component remains below the 400-line smell threshold.
- [x] Component methods primarily represent user actions and presentation state.

---

## 10. Remove production debug output from the Order page

**Severity:** Medium  
**Files:**

- `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html:68-79`
- `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:133-136`

### Finding

The empty state exposes internal run IDs, decision counts, and errors. The debug computed signals add permanent component complexity.

### Acceptance checklist

- [ ] Debug `<pre>` is removed from production UI.
- [ ] Debug computed signals are removed.
- [ ] If diagnostics are still needed, they are behind an explicit development-only mechanism.

---

## 11. Fix the bridge health endpoint

**Severity:** Medium  
**Status:** Completed on 2026-07-16.
**File:** `functions/src/rh-agent/trade-bridge-server.ts`

### Finding

The primary request handler returns `404` for GET `/health`. A second request listener then attempts to write a `200` response for the same request. This can write headers twice and cause `ERR_HTTP_HEADERS_SENT`.

The response also hardcodes `claudeAvailable: true` without checking Claude or MCP connectivity.

### Acceptance checklist

- [x] A single router/request handler owns all routes.
- [x] GET `/health` returns exactly one response.
- [x] Health status no longer claims Claude is available without checking it.
- [x] Health and unknown-route behavior have HTTP-boundary integration coverage.

---

## 12. Make Trade Management discoverable

**Severity:** Medium  
**Files:**

- `src/app/core/common/interfaces.ts:37-44`
- `src/app/core/core-routes.ts:120-124`

### Finding

The route exists, but no application navigation points to it. The workflow documentation marks Trade Management complete even though it is effectively direct-URL only.

### Acceptance checklist

- [ ] RH Agent navigation includes Trade Management.
- [ ] Order page can navigate to Trade Management after submission.
- [ ] Navigation label and route use `AppRoutes.RH_AGENT_TRADES` rather than duplicated strings.

---

## 13. Remove method calls from the Trades template

**Severity:** Medium / guideline violation  
**Files:**

- `src/app/features/rh-agent/pages/rh-agent-trades/rh-agent-trades.component.html:51`
- `src/app/features/rh-agent/pages/rh-agent-trades/rh-agent-trades.component.html:85`
- `src/app/features/rh-agent/pages/rh-agent-trades/rh-agent-trades.component.ts:45-47`

### Finding

Both `@for` blocks call `trackByTradeId()`, violating the project's no-template-method rule. The method is an identity wrapper and adds no value.

The template also uses `matTooltip` without importing `MatTooltipModule`, so the tooltip directive may not activate.

### Acceptance checklist

- [ ] `@for` uses `track trade.id` directly.
- [ ] `trackByTradeId()` is removed.
- [ ] `MatTooltipModule` is imported or the tooltip is removed.

---

## 14. Restore a working Functions lint command

**Severity:** Medium / tooling  
**Files:**

- `functions/.eslintrc.js`
- `functions/package.json`

### Finding

`npm --prefix functions run lint` fails before checking source because `.eslintrc.js` is interpreted as ESM while it uses CommonJS configuration syntax.

### Acceptance checklist

- [ ] ESLint configuration format matches the package module mode.
- [ ] `npm --prefix functions run lint` executes successfully.
- [ ] New bridge/executor files pass lint.

---

# Recommended Implementation Order

Items #1 and #2 are complete. Preserve their security and artifact protections while implementing the simplified Phase A separately.

1. **Complete — local bridge security and loopback binding.**
2. **Complete — sensitive artifact removal and `.gitignore` protection.**
3. **Response and authentication proof:** capture redacted order, quote, and position shapes and prove unattended cloud token refresh.
4. **Minimal direct boundary:** add owner/account authorization, strict DTOs, fake fixtures, broker identity, and backend-only persistence.
5. **Single human order:** preflight and place one whole-share regular-hours market entry from an accepted LONG occurrence with a pre-persisted `ref_id`.
6. **Account-wide monitoring:** synchronize every position and relevant order, derive allocation capacity, and add **Refresh from Robinhood**.
7. **Position protection:** place one broker-held stop after confirmed fill and support manual full/partial exits.
8. **Synthetic target:** add one-minute cloud evaluation only after unattended authentication is proven.
9. **Legacy retirement:** remove `EXECUTED` behavior and isolate/disable Claude bridge entrypoints without deleting the reference source.
10. **Focused regression suite:** cover the normal direct path, owner/account boundary, idempotency, broker identity, capacity, stop/exit flow, and visible exception states with fake transports.
11. **Remaining review cleanup:** production debug removal, Trade Management navigation, Trades template cleanup, and Functions lint repair.

Implement these as small commits. Do not add batch placement, limit entries, short entries, complex partial-fill recovery, path selection, or a local brokerage ledger during Phase A.

---

# Approval Bar

The direct MCP implementation is approved only when:

- [x] No untrusted local or browser client can submit trades through the legacy loopback bridge without an approved origin and current session token.
- [x] No sensitive execution artifacts can be committed accidentally.
- [ ] New direct code is isolated under `functions/src/rh-agent-mcp/` and `src/app/features/rh-agent/services/robinhood-mcp/`.
- [ ] The secured legacy Claude implementation remains isolated and disabled from normal execution.
- [ ] Direct MCP is the only RH Agent execution path and no automatic fallback occurs after an ambiguous response.
- [ ] Broker submission state is distinct from fill/open-position state.
- [ ] Broker order ID and state are persisted.
- [ ] Every direct order has a pre-persisted `ref_id`; retries reconcile and reuse it.
- [ ] Direct execution uses an exact typed, fail-closed MCP response boundary without an LLM.
- [ ] Firestore collections and rules are scoped to the separate RH Agent broker schemas with backend-only canonical writes.
- [ ] Active Trade Management works across RH Agent runs and includes all configured-account positions regardless of origin.
- [ ] Critical execution, synchronization, rules, and security regressions are tested with fake transports.
- [ ] Angular build, Functions typecheck, Functions lint, and relevant legacy and direct-path tests pass.

**Current status: Items #1 and #2 approved; simplified direct-MCP items #3–#8 and remaining cleanup require implementation.**
