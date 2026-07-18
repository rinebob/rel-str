# RH Agent Legacy Claude Bridge Archive

**Status:** Historical record — executable implementation removed
**Archived:** 2026-07-17
**Residual-source snapshot:** Git commit `6e4873324ee653e4d8a44210fdf1f55ae96780c3`
**Last hardened integrated snapshot:** Git commit `44b9ca3712774a3df8beddc6b3990449567286f0`
**Replacement:** `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`

## Purpose

Preserve the design history and recovery path for the retired Claude-based Robinhood execution work without retaining executable financial-mutation code in the active repository. This document is a record, not an operating guide. The legacy path must not be restored as a fallback after a direct-MCP failure or ambiguous submission.

## What was built

The retired work contained four related experiments.

### Local Claude trade bridge

```text
Angular Order page
→ localhost HTTP bridge
→ authenticated session token and request validation
→ Claude Code subprocess
→ Robinhood Trading MCP tools
→ parsed Claude output
→ legacy UI-derived execution/trade persistence
```

The bridge accepted one trade or a sequential batch from the Angular app. For each trade it launched `claude --print`, supplied a narrow Robinhood MCP tool allowlist, and instructed Claude to call account lookup, order review, and order placement. The bridge required an order ID and broker state before reporting a confirmed submission.

The final hardened local boundary included:

- Loopback-only binding on `127.0.0.1`.
- Explicit frontend-origin allowlisting.
- A fresh 256-bit process-lifetime session token.
- Constant-time token comparison.
- JSON content-type enforcement.
- A 16 KiB body limit.
- Strict symbol, side, amount, order-type, and limit-price validation.
- Maximum batch size and duplicate-symbol rejection.
- One active execution request at a time.
- Sequential batch execution that stopped after the first failure.
- No persistent prompt or raw execution-result files.
- Fake-executor HTTP and policy tests that could not contact Claude or Robinhood.

### Angular bridge client

The Angular client targeted the loopback bridge and owned:

- Session-token prompting and `sessionStorage` reuse.
- The loopback URL and token header.
- Typed transport success and failure results.
- Clearing stale tokens after HTTP 401.
- Normalizing prompt, storage, and HTTP failures.

The bridge-specific Order page integration, Mark Executed behavior, and UI-derived trade persistence were removed before final retirement because broker submission, fills, and positions must be separate broker-authoritative facts.

### Earlier Angular Claude prompt workflow

An older dashboard path remained after the loopback bridge integration was removed. It generated single or batch natural-language trade prompts containing symbol, side, amount, order type, and the masked Agentic account suffix. Its panel copied those prompts to the clipboard and instructed the user to paste them into Claude Code, where Claude could review and place the orders through Robinhood MCP. The unreferenced RH Agent execution panel still imported this workflow. All seven files are preserved exactly in the source archive and removed from the active Angular tree.

### Early direct OAuth and Cloud Function prototypes

The retired backend directory also contained an unverified direct-MCP OAuth attempt using `@modelcontextprotocol/sdk`. It attempted authorization-code/PKCE setup, a localhost callback or manually copied code, plaintext local token persistence, and direct Streamable HTTP MCP calls. No retained evidence proves that authorization, restart, refresh, or a direct call succeeded.

A separate `rh-agent-executor.ts` Cloud Function prototype attempted direct `review_equity_order`, `place_equity_order`, and portfolio calls. It was not production-safe because it lacked a valid backend OAuth lifecycle, configured-owner enforcement, durable intent and `ref_id`, strict observed response contracts, capacity reservation, and reconciliation. Its exports were removed before the file was deleted.

## Outcome and evidence

The Claude bridge did place a legitimate Robinhood order during manual development. That established that Claude Code could use its authenticated Robinhood MCP connection, but it did not validate the architecture required for production RH Agent execution.

The bridge security work and tests established useful boundary lessons:

- CORS is not authentication.
- Browser-to-localhost financial operations require an explicit origin policy and independent high-entropy authorization token.
- Rejected requests must never invoke the executor.
- A queued or confirmed broker order is not a fill or position.
- Ambiguous submission must be reconciled before retry.
- Raw broker or model output must not become canonical persistence.
- Tests for financial paths require injected fake transports.

The 2026-07-16 thermonuclear review records the detailed findings and hardening history in `docs/reviews/2026-07-16-thermo-review-trade-bridge.md`.

## Why it was retired

The Claude bridge was removed because:

- Deterministic MCP tools do not require an LLM intermediary.
- Natural-language prompting and model-output parsing add avoidable ambiguity.
- A localhost bridge cannot support unattended cloud reconciliation or policy evaluation.
- The browser session token and local process are not a production broker-authentication model.
- UI-derived trade records incorrectly conflated broker submission with fills and positions.
- Batch placement and automatic tool selection exceeded the deliberately narrow Phase A scope.
- Direct and legacy paths would create duplicate-order risk if either became an automatic fallback.
- Keeping executable historical financial-mutation code created unnecessary security and maintenance risk.

## Removed source inventory

The exact historical contents are preserved in `RH-AGENT-LEGACY-CLAUDE-BRIDGE-SOURCE-ARCHIVE-2607-01.md`. The archive contains the residual source from `6e4873324ee653e4d8a44210fdf1f55ae96780c3` plus the final integrated Order-page, persistence, deployment, and Firestore files from `44b9ca3712774a3df8beddc6b3990449567286f0`.

### Backend Claude/OAuth experiment

```text
functions/src/rh-agent/agent.ts
functions/src/rh-agent/capture-oauth.ts
functions/src/rh-agent/index.ts
functions/src/rh-agent/indicators.ts
functions/src/rh-agent/scheduler.ts
functions/src/rh-agent/strategies.ts
functions/src/rh-agent/trade-bridge-security.ts
functions/src/rh-agent/trade-bridge-server.ts
functions/src/rh-agent/watchlist.ts
```

### Unapproved Cloud Function prototype

```text
functions/src/rh-agent-cloud-function/rh-agent-executor.ts
```

### Angular bridge client

```text
src/app/features/rh-agent/services/trade-bridge-client.service.ts
src/app/features/rh-agent/services/trade-bridge-client.service.spec.ts
tsconfig.trade-bridge-client.spec.json
```

### Angular Claude prompt UI

```text
src/app/features/rs/services/robinhood-trade.service.ts
src/app/features/rs/components/robinhood-trade-panel.component.ts
src/app/features/rs/components/robinhood-trade-panel.component.html
src/app/features/rs/components/robinhood-trade-panel.component.scss
src/app/features/rh-agent/components/execution-panel/execution-panel.component.ts
src/app/features/rh-agent/components/execution-panel/execution-panel.component.html
src/app/features/rh-agent/components/execution-panel/execution-panel.component.scss
```

### Backend bridge tests

```text
tests/functions/trade-bridge-security.test.ts
tests/functions/trade-bridge-http.test.ts
```

### Last integrated Order-page execution and persistence

```text
src/app/features/rh-agent/common/rh-agent.constants.ts
src/app/features/rh-agent/components/status-summary-chips/status-summary-chips.component.html
src/app/features/rh-agent/components/trade-row/trade-row.component.html
src/app/features/rh-agent/components/trade-row/trade-row.component.scss
src/app/features/rh-agent/components/trade-row/trade-row.component.ts
src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.html
src/app/features/rh-agent/pages/agent-order/rh-agent-order.component.ts
src/app/features/rh-agent/services/rh-agent-execution.service.ts
src/app/features/rh-agent/services/rh-agent-firestore-helpers.ts
src/app/features/rh-agent/services/rh-agent-occurrence-decision.service.ts
src/app/features/rh-agent/services/rh-agent-trade.service.ts
src/app/features/rh-agent/services/rh-agent.types.ts
src/app/features/rh-agent/stores/rh-agent-execution.store.ts
src/app/features/rh-agent/stores/rh-agent-group.store.ts
src/app/features/rh-agent/stores/rh-agent-occurrence-decision.store.ts
src/app/features/rh-agent/stores/rh-agent-trade.store.ts
```

### Last integrated deployment and Firestore configuration

```text
firestore.indexes.json
firestore.rules
functions/package.json
functions/src/index.ts
package.json
src/app/core/common/constants.ts
```

## Preserved operating guide

The detailed operating guide remains at `docs/implementations/RH-AGENT-TRADE-BRIDGE-USAGE-2607-01_local-trade-execution-guide.md`. A top-level archive notice was added after retirement; the historical operating content remains unchanged.

## Recovery procedure

Do not restore this implementation directly onto a production branch. To inspect residual source without altering the working tree:

```powershell
git show 6e4873324ee653e4d8a44210fdf1f55ae96780c3:<repository-relative-path>
```

To inspect a file from the complete last hardened integrated bridge:

```powershell
git show 44b9ca3712774a3df8beddc6b3990449567286f0:<repository-relative-path>
```

To recover the complete implementation for an isolated security-reviewed experiment, create a detached worktree or temporary branch from the integrated snapshot:

```powershell
git switch --detach 44b9ca3712774a3df8beddc6b3990449567286f0
```

Any restoration requires a new explicit architecture decision and security review. It must not reuse historical account references, tokens, authorization URLs, raw outputs, or local artifacts.

## Current direction

The replacement architecture uses:

```text
accepted current signal occurrence
→ editable order draft
→ deterministic preflight
→ exact authorization
→ durable intent and ref_id
→ direct typed MCP call
→ broker order and position synchronization
```

Robinhood remains the broker source of truth. Direct MCP authentication must first pass the separate read-only authentication proof. Claude is not part of the production execution, authentication, reconciliation, or fallback path.
