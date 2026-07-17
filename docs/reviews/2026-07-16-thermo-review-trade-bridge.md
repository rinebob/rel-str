# Thermo-Nuclear Code Review — RH Agent Trade Bridge and Trade Management

**Date:** 2026-07-16  
**Scope:** All current working-tree changes, with emphasis on the local Claude Code + Robinhood MCP trade bridge, Order-page execution flow, trade persistence, Firestore rules, and Trade Management page.  
**Review framework:** `.devin/skills/thermo-nuclear-code-review.md`, `.devin/skills/rh-agent-coding-guidelines.md`, and `.devin/skills/rel-str-coding-guidelines.md`.  
**Status:** **Changes requested — not merge-ready.**  
**Primary reason:** The implementation places real orders but does not yet meet the required broker-order lifecycle, idempotency, persistence-boundary, and complete regression-test standards.

---

## Review Summary

The implementation successfully placed a real Robinhood order through the local bridge, and the latest result-validation change correctly requires an order ID and broker state before marking the bridge result confirmed. The Angular build and Functions typecheck pass.

The review originally identified three critical blockers:

1. The local bridge could accept unauthorized live-trade requests. **Resolved on 2026-07-16.**
2. Sensitive live order/account data is written to an unignored local file. **Resolved on 2026-07-16.**
3. A queued/submitted broker order is persisted as an open trade with locally fabricated fill data. **Open.**

The largest structural opportunity is to stop using Claude prose as a brokerage protocol. The repository already contains direct typed MCP order-execution logic. A canonical MCP client/executor can remove the Claude subprocess, prompt files, tool-permission flags, natural-language parsing, and regex confirmation from the live execution boundary.

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
- Do not persist raw broker/Claude output by default.
- If an audit log is required, write only a redacted typed record.
- Consider bounded rotation rather than an indefinitely growing JSON array.

### Acceptance checklist

- [x] Current `.trade-results.json` is removed.
- [x] `.trade-results.json` is added to `functions/.gitignore`.
- [x] `.trade-prompt.txt` is added to `functions/.gitignore`.
- [x] Raw account-specific output is no longer persisted.
- [x] No local audit log is retained; redaction is therefore not applicable.
- [x] No persistent log collection exists, so unbounded growth is eliminated.
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

### Required design

Introduce a broker-order lifecycle separate from trade/fill state. Suggested states:

```text
SUBMITTING
SUBMITTED
QUEUED
PENDING
PARTIALLY_FILLED
FILLED
REJECTED
CANCELLED
FAILED
UNKNOWN_REQUIRES_RECONCILIATION
```

Persist at least:

- Execution-attempt ID.
- Broker order ID.
- Broker state.
- Submitted timestamp.
- Requested symbol, side, dollar amount, and order type.
- Estimated quantity.
- Actual filled quantity.
- Average fill price.
- Filled timestamp.
- Source occurrence decision ID and run ID.

Only transition to an open position/trade after the broker reports a fill.

### Acceptance checklist

- [ ] Submitted orders and open positions are separate concepts.
- [ ] Broker order ID is persisted.
- [ ] Broker order state is persisted.
- [ ] Queued/pending orders are not represented as filled/open trades.
- [ ] Signal close is not persisted as actual entry price.
- [ ] Locally calculated whole-share quantity is not persisted as actual fractional quantity.
- [ ] Fill price and quantity come from broker reconciliation.
- [ ] Rejected/cancelled orders remain visible without becoming open trades.
- [ ] Tests cover queued, pending, rejected, cancelled, partially filled, and filled states.

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

- Generate and persist a stable execution-attempt ID before broker submission.
- Record a `SUBMITTING` intent first.
- Reconcile ambiguous results against Robinhood before permitting retry.
- Use broker order ID as canonical post-submission identity.
- Never overwrite a previous broker order record.
- Make repeated delivery of the same confirmed result idempotent.

### Acceptance checklist

- [ ] Every button submission gets a stable execution-attempt ID.
- [ ] Order intent exists before calling the broker.
- [ ] Broker order ID is unique in storage.
- [ ] A repeated response cannot create a duplicate order record.
- [ ] A retry after timeout is blocked until reconciliation completes.
- [ ] Firestore failure after broker success produces a recoverable reconciliation state.
- [ ] Tests cover duplicate clicks, timeout, Firestore failure, repeated callbacks, and retry.

---

## 5. Replace Claude prose parsing with a canonical typed MCP executor

**Severity:** High / structural  
**Files:**

- `functions/src/rh-agent/trade-bridge-server.ts:55-131`
- `functions/src/rh-agent-cloud-function/rh-agent-executor.ts:74-159`
- `functions/src/rh-agent/index.ts:129-161`

### Finding

The live execution path currently:

1. Builds a natural-language prompt.
2. Starts a Claude subprocess.
3. Grants three MCP tools.
4. Sends the prompt through stdin.
5. Parses Claude prose with a greedy JSON regex.
6. Falls back to regex matching arbitrary `orderId` and `state` text.

This is a fragile protocol boundary. Mentioning an order ID and state in prose can produce a false confirmation. Any state is accepted, including potentially rejected states.

The repository already contains direct MCP connection and typed `review_equity_order` / `place_equity_order` execution code.

### Code-judo remedy

Extract a canonical Robinhood MCP client and order executor that both local and cloud entrypoints can call. The local HTTP bridge should become a thin validated adapter:

```text
validate local request
→ create/reuse MCP client
→ review order
→ place order
→ parse typed MCP response
→ return typed broker-order result
```

This removes the Claude subprocess, prompt construction, permission flags, temp prompt file, prose parsing, and regex confirmation from live execution.

### Acceptance checklist

- [ ] Local bridge calls a canonical direct MCP executor.
- [ ] Cloud and local paths reuse the same order contract and parser.
- [ ] Claude subprocess is removed from the live order path.
- [ ] Prompt file creation is removed.
- [ ] Regex confirmation fallback is removed.
- [ ] Only typed broker responses can confirm submission.
- [ ] Invalid or unexpected broker states fail closed.
- [ ] Tests cover malformed MCP content and unexpected states.

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

### Required design

Prefer one of:

- Root collection: `rh-agent-trades/{tradeId}`.
- Unique collection group: `rh-agent-trade-records`.

Avoid reusing the generic `trades` collection-group name across separate domains.

Rules must verify ownership on both existing and replacement data for updates.

### Acceptance checklist

- [ ] RH Agent trades no longer share the generic `trades` collection-group name.
- [ ] Rules are scoped only to the RH Agent trade schema.
- [ ] Create requires `request.resource.data.userId == request.auth.uid`.
- [ ] Update requires both old and new `userId` to remain the authenticated UID.
- [ ] Cross-user parent-path writes are denied.
- [ ] Firestore emulator tests cover read/create/update/delete and cross-user denial.
- [ ] Required indexes match the new query shape.

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

### Required design

- Load all active broker orders/open positions for the authenticated user across runs.
- Load closed history separately with pagination/date filters.
- Use reactive initialization rather than one synchronous `ngOnInit` read.
- Preserve source run and occurrence links as metadata.

### Acceptance checklist

- [ ] Open orders/positions from previous runs remain visible.
- [ ] Closed history is queryable independently of latest run.
- [ ] Direct navigation loads data after store initialization.
- [ ] Loading failures are shown to the user.
- [ ] Queries are indexed and paginated where necessary.
- [ ] Tests cover direct navigation and run transition while positions remain open.

---

## 8. Add regression and security tests for the live-trading path

**Severity:** High  
**Files:** No relevant tests currently found.

### Required coverage

- Bridge authentication and origin enforcement.
- Request schema validation.
- Maximum trade amount and batch size.
- Allowed MCP tool boundary or direct MCP executor contract.
- Broker response parsing.
- Queued, pending, rejected, cancelled, partial-fill, and fill state transitions.
- Partial batch failure.
- Stop-on-first-unconfirmed behavior.
- Duplicate click and idempotency behavior.
- Firestore failure after broker success.
- Trade rules and cross-user denial.
- Order-page persistence of only confirmed broker results.
- Direct navigation to Trade Management.
- The prior false-success regression.

### Acceptance checklist

- [ ] Pure bridge/executor unit tests exist.
- [ ] Frontend bridge-client/facade tests exist.
- [ ] Firestore rules emulator tests exist.
- [ ] At least one end-to-end test uses a fake broker/MCP implementation.
- [ ] No automated test can place a live order.
- [ ] Live-order execution is impossible in CI.

---

# Structural and Maintainability Findings

## 9. Extract bridge transport and result reconciliation from `RhAgentOrderComponent`

**Severity:** Medium / structural  
**File:** `src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts:1-425`

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

Extract a focused bridge/order-submission facade with canonical request/response contracts. Keep the component responsible for display state and explicit user intent.

### Acceptance checklist

- [ ] HTTP bridge details leave the component.
- [ ] Bridge contracts are defined in one canonical location.
- [ ] Broker-result-to-persistence mapping is tested outside the component.
- [ ] Component returns below the 400-line smell threshold.
- [ ] Component methods primarily represent user actions and presentation state.

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
**File:** `functions/src/rh-agent/trade-bridge-server.ts:134-148,228-238`

### Finding

The primary request handler returns `404` for GET `/health`. A second request listener then attempts to write a `200` response for the same request. This can write headers twice and cause `ERR_HTTP_HEADERS_SENT`.

The response also hardcodes `claudeAvailable: true` without checking Claude or MCP connectivity.

### Acceptance checklist

- [x] A single router/request handler owns all routes.
- [x] GET `/health` returns exactly one response.
- [x] Health status no longer claims Claude is available without checking it.
- [ ] Health endpoint has a unit/integration test.

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

# Recommended Fix Order

Fix these one at a time in this order:

1. **Sensitive artifact removal and `.gitignore` protection.**
2. **Bridge request security and loopback binding.**
3. **Broker-order lifecycle model.**
4. **Idempotent execution-attempt persistence and reconciliation.**
5. **Direct typed MCP executor extraction.**
6. **Firestore schema/rule narrowing.**
7. **Cross-run Trade Management queries and reactive loading.**
8. **Regression/security tests.**
9. **Order component decomposition.**
10. **Production debug removal.**
11. **Health endpoint correction.**
12. **Trade Management navigation.**
13. **Trades template cleanup.**
14. **Functions lint repair.**

Items 3–6 should be designed together before implementation because the broker-order identity, persistence schema, MCP response contract, and Firestore rules are one boundary. Implementing them independently without an agreed model risks another migration.

---

# Approval Bar

The change is approved only when:

- [x] No untrusted local or browser client can submit trades through the loopback bridge without an approved origin and current session token.
- [ ] No sensitive execution artifacts can be committed accidentally.
- [ ] Broker submission state is distinct from fill/open-position state.
- [ ] Broker order ID and state are persisted.
- [ ] Retries are idempotent or require reconciliation.
- [ ] Live execution uses a typed fail-closed response boundary.
- [ ] Firestore rules are scoped to the RH Agent trade schema.
- [ ] Active Trade Management works across RH Agent runs.
- [ ] Critical execution and security regressions are tested.
- [ ] Angular build, Functions typecheck, Functions lint, and relevant tests pass.

**Current status: Changes requested.**
