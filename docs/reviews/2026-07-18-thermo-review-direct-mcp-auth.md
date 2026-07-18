# Thermo-Nuclear Code Review — RH Agent Direct MCP Authentication Proof

**Date:** 2026-07-18  
**Scope:** All uncommitted RH Agent direct-MCP authentication code, tests, scripts, package changes, and proof documentation.  
**Review framework:** `.devin/skills/thermo-nuclear-code-review.md`, `.devin/skills/rh-agent-coding-guidelines.md`, and `docs/implementations/RH-AGENT-DIRECT-MCP-AUTH-PROOF-2607-01.md`.  
**Status:** **Approved after final post-remediation review — local authentication scope complete.**

---

## Review Summary

The proof established important facts successfully:

- Robinhood exposes OAuth authorization-server and protected-resource metadata compatible with the installed MCP SDK.
- Dynamic client registration succeeds for the local RH Agent proof client.
- PKCE authorization through the official Robinhood browser ceremony succeeds.
- The loopback callback accepts the exact state and completes authorization-code exchange.
- Robinhood returns access-token, refresh-token, and expiry fields.
- An authenticated direct MCP client can call `listTools`; the proof observed 50 tools.
- No financial tool was called and no credential value was logged or added to the repository.

The implementation should not proceed directly to persistence. It created separate discovery, callback, and repository/client proof paths instead of one canonical OAuth session and MCP client lifecycle. The successful live path bypasses the abstractions intended for restart and production use. Extending this structure would multiply refresh, persistence, error classification, and cleanup behavior across parallel implementations.

This is the central architectural failure: each proof step was implemented as a locally convenient path rather than as a tracer bullet through one end-to-end seam.

### Cleanup result — 2026-07-18

The remediation collapsed the implementation into one canonical `RobinhoodMcpSession` and one `runLocalOAuthBootstrap` orchestration path. The discovery-only and disconnected test-only client paths were deleted. One classifier owns authentication-state mapping, one idempotent callback settlement path owns shutdown, the SDK is pinned to `1.29.0`, and fake/in-memory tests exercise the same SDK client/session composition used by the live runner. T08 added one repository-backed provider and a CurrentUser DPAPI-encrypted local repository; a fresh process reused the stored credential without a browser and returned 50 tools.

---

## Validation Observed

- [x] Angular development build passed.
- [x] Functions typecheck passed.
- [x] Functions lint completed with zero errors and existing warnings.
- [x] RH Agent MCP deployment-boundary tests passed.
- [x] Canonical MCP session tests passed.
- [x] OAuth error-classifier tests passed.
- [x] OAuth callback/bootstrap fake and loopback tests passed.
- [x] Encrypted repository, schema-validation, CAS, stale-lock, and provider-atomicity tests passed.
- [x] Live discovery-only proof succeeded.
- [x] Live callback, token exchange, and authenticated `listTools` proof succeeded.
- [x] `git diff --check` passed with line-ending warnings only.

The original findings below are retained as review history. Every required remediation is complete.

---

# Blockers

## 1. Collapse the two MCP client architectures

**Severity:** Blocker  
**Files:**

- `functions/src/rh-agent-mcp/client/sdk-mcp-client.ts`
- `functions/src/rh-agent-mcp/client/read-only-mcp-client.ts`
- `functions/src/rh-agent-mcp/diagnostics/authentication-proof.ts`
- `functions/src/rh-agent-mcp/diagnostics/run-oauth-callback-proof.ts`

**Problem:**

The live callback runner directly constructs `StreamableHTTPClientTransport` and `Client`, connects, calls `listTools`, and closes. Separately, `SdkRobinhoodMcpClientFactory` performs another client construction and `listTools` lifecycle for `DirectMcpAuthenticationProof`. The live OAuth path does not use the credential-repository/client path intended for restart and production.

The result is two sources of truth for:

- Transport creation.
- MCP `Client` construction.
- OAuth-provider attachment.
- Connection and cleanup.
- `listTools` projection.
- Error behavior.

The repository path is proven only with hand-built fakes; the live path bypasses it. Adding persistence or refresh now would force a choice between duplicating behavior again or retrofitting one path after the other has grown.

**Required remediation:**

Create one canonical `RobinhoodMcpSession` or equivalent deep module that owns:

1. Provider-backed transport creation.
2. MCP `Client` construction.
3. Connection lifecycle.
4. Allowlisted read-only proof operations.
5. Cleanup on successful and failed connection.

Bootstrap, restart, local proof, and eventual cloud proof must all use this same session. Delete the duplicate factory/client implementation rather than wrapping it again.

**Acceptance:**

- Exactly one active source location constructs `StreamableHTTPClientTransport`.
- Exactly one active source location constructs the MCP `Client` used by RH Agent.
- Bootstrap and stored-credential restart both execute `listTools` through the same public session seam.
- No production-directed authentication class exists only for tests.
- Connection failure closes any partially created client/transport.

---

## 2. Classify OAuth failures according to the documented state model

**Severity:** Blocker  
**File:** `functions/src/rh-agent-mcp/diagnostics/oauth-callback-proof.ts`

**Problem:**

Every authorization-code exchange exception maps to `REAUTHORIZATION_REQUIRED`. Network interruption, DNS failure, Robinhood server failure, SDK parsing failure, invalid grant, revoked authorization, and explicit interaction requirements are not equivalent.

The plan defines:

- `REAUTHORIZATION_REQUIRED` for rejected/revoked authorization or required user interaction.
- `TEMPORARILY_UNAVAILABLE` for transport, throttling, and server failures.
- `MISCONFIGURED` for invalid redirect, registration, storage, or account configuration.

Incorrect classification will produce the wrong operator action and can turn transient outages into unnecessary interactive login ceremonies.

**Required remediation:**

Add one typed OAuth/MCP error classifier used by bootstrap, restart, refresh, and cloud reads. Unknown failures must fail closed without being mislabeled as revoked authorization.

**Acceptance:**

- Invalid grant/revocation maps to `REAUTHORIZATION_REQUIRED`.
- Transport, timeout, throttling, and server failures map to `TEMPORARILY_UNAVAILABLE`.
- Invalid redirect/client/storage configuration maps to `MISCONFIGURED` when distinguishable.
- Tests cover every state classification with synthetic typed errors.
- Raw error messages, URLs, codes, and credential fields never enter returned evidence or logs.

---

# High-Priority Findings

## 3. Make one bootstrap session own and release all ephemeral secrets

**Severity:** High  
**Files:**

- `functions/src/rh-agent-mcp/auth/ephemeral-oauth-provider.ts`
- `functions/src/rh-agent-mcp/auth/local-oauth-callback-server.ts`
- `functions/src/rh-agent-mcp/diagnostics/oauth-callback-proof.ts`
- `functions/src/rh-agent-mcp/diagnostics/run-oauth-callback-proof.ts`

**Problem:**

The provider clears its state and verifier references, but the orchestration options and module-level runner state retain other references until later scopes return or the process exits. The evidence text says state, verifier, and code were “cleared,” which overstates what JavaScript can prove.

**Required remediation:**

One bootstrap-session object/function must generate and own:

- OAuth state.
- Loopback listener.
- PKCE verifier through the SDK provider.
- Authorization-code receipt.
- Code exchange.
- Final cleanup.

The outer CLI should receive only redacted evidence. After exchange, the session must release all application-held references. Documentation must say references were released for garbage collection, not securely zeroized.

**Acceptance:**

- The CLI never stores OAuth state in module scope.
- The proof orchestrator does not retain an options object containing state after exchange.
- Callback close, timeout, and error all run the same idempotent cleanup path.
- Evidence language accurately reflects JavaScript memory semantics.

---

## 4. Retire the superseded discovery-only executable path

**Severity:** High  
**Files:**

- `functions/src/rh-agent-mcp/diagnostics/oauth-discovery-probe.ts`
- `functions/src/rh-agent-mcp/diagnostics/run-oauth-discovery-probe.ts`
- `tests/functions/rh-agent-mcp-auth-discovery.test.ts`
- Discovery-only package scripts and barrel exports.

**Problem:**

The discovery spike answered its question and is superseded by the callback proof, which necessarily performs discovery before completing authorization. Keeping both paths permanently duplicates provider setup, result models, tests, scripts, and public exports.

**Required remediation:**

Preserve the redacted discovery result in the evidence document, then delete the executable discovery-only path. The canonical bootstrap may expose a redacted intermediate state internally, but there must be one authorization command and one orchestration path.

**Acceptance:**

- One local authentication command remains.
- Discovery evidence remains documented.
- No discovery-only runner, result family, package script, or test suite remains.
- The canonical bootstrap test proves discovery occurs before callback exchange.

---

## 5. Align the declared SDK version with the APIs in use

**Severity:** High  
**Files:**

- `functions/package.json`
- `functions/package-lock.json`

**Problem:**

The code was designed and validated against MCP SDK `1.29.0`, including `OAuthDiscoveryState` persistence hooks, while the manifest declares `^1.12.1`. The lockfile currently protects local installs, but the manifest advertises compatibility with an older API contract that was not reviewed and may not compile.

**Required remediation:**

Pin the proof to the exact reviewed SDK version until authentication, refresh, and rotation behavior are closed. Upgrade deliberately with focused OAuth lifecycle tests.

**Acceptance:**

- Manifest and lockfile resolve the same reviewed SDK version.
- Authentication tests run against that pinned version.
- SDK upgrades are explicit changes, not incidental lockfile movement.

---

## 6. Test the production composition rather than only injected orchestration

**Severity:** High  
**Files:**

- `tests/functions/rh-agent-mcp-auth-proof.test.ts`
- `tests/functions/rh-agent-mcp-auth-discovery.test.ts`
- `tests/functions/rh-agent-mcp-oauth-callback.test.ts`

**Problem:**

The tests prove small orchestration functions with fake `authorize` and `listTools` callbacks, but they do not exercise the same transport/client/provider composition used by the live runner. That gap allowed the duplicate client architecture to remain green.

Missing behavior includes:

- Shared session construction.
- Partial connection cleanup.
- Provider/repository integration.
- Token and client-information persistence.
- Refresh-token rotation.
- OAuth error classification.
- Authorization-error callback handling.
- Replay rejection and listener shutdown.

**Required remediation:**

After the canonical session exists, test it with the SDK’s in-memory or injected fake transport. Tests must remain unable to contact Robinhood, but they must exercise the exact module composition used by the live CLI and future cloud runtime.

**Acceptance:**

- The live runner contains no untested MCP construction logic.
- A fake/in-memory integration test covers connect → `listTools` → close.
- Repository-backed bootstrap and restart tests use the canonical session.
- Connection and close failures are covered.
- Callback authorization-error, replay, timeout, and port-release behavior are covered.

---

# Secondary Finding

## 7. Centralize callback settlement and server shutdown

**Severity:** Medium  
**File:** `functions/src/rh-agent-mcp/auth/local-oauth-callback-server.ts`

**Problem:**

Success, authorization error, timeout, external close, and response-finish paths coordinate settlement and shutdown separately. Some `closeServer()` promises are intentionally discarded without capturing rejection. This makes port release and callback settlement harder to reason about.

**Required remediation:**

Create one idempotent settlement helper that owns:

1. Settled-state transition.
2. State-reference release.
3. Timeout cancellation.
4. Callback resolve/reject.
5. Server shutdown and close-error capture.

**Acceptance:**

- Every terminal path uses the same helper.
- Callback promise settles once.
- Server close is observed or deliberately converted to a redacted failure category.
- Tests verify the port is released after success, OAuth error, and timeout.

---

# Cleanup Task List

Tasks are ordered. Do not begin credential persistence until T01–T07 are complete.

## RH-AGENT-MCP-AUTH-CLEANUP-T01 — Define the one canonical session seam

- [x] Write the target public API for one `RobinhoodMcpSession` or equivalent.
- [x] Make it own provider-backed transport, MCP client, `listTools`, and cleanup.
- [x] Define bootstrap and future stored-credential inputs without creating separate client implementations.
- [x] Keep arbitrary `callTool` access outside the proof surface.

## RH-AGENT-MCP-AUTH-CLEANUP-T02 — Remove the parallel client path

- [x] Route the live callback proof through the canonical session.
- [x] Delete the disconnected stored-credential proof; T08 must extend the canonical session.
- [x] Delete `SdkRobinhoodMcpClientFactory`, `ReadOnlyMcpClient`, and their test-only proof path.
- [x] Remove duplicate `Client` and `StreamableHTTPClientTransport` construction.

## RH-AGENT-MCP-AUTH-CLEANUP-T03 — Add canonical error classification

- [x] Define redacted OAuth/MCP error categories once.
- [x] Map invalid grant/revocation to `REAUTHORIZATION_REQUIRED`.
- [x] Map transient failures to `TEMPORARILY_UNAVAILABLE`.
- [x] Map distinguishable configuration failures to `MISCONFIGURED`.
- [x] Add focused classifier tests.

## RH-AGENT-MCP-AUTH-CLEANUP-T04 — Consolidate bootstrap ownership

- [x] Move state generation into the bootstrap-session scope.
- [x] Make the bootstrap own callback listener, provider, code exchange, canonical MCP session, and cleanup.
- [x] Release application references to state, verifier, code, and authorization URL after use.
- [x] Correct evidence wording from secure deletion to reference release where applicable.

## RH-AGENT-MCP-AUTH-CLEANUP-T05 — Retire completed spike code

- [x] Delete the discovery-only runner and orchestration.
- [x] Delete discovery-only tests and scripts.
- [x] Preserve only redacted evidence in the planning document.
- [x] Narrow the barrel exports to the intentional module API.

## RH-AGENT-MCP-AUTH-CLEANUP-T06 — Harden callback lifecycle

- [x] Centralize settlement and shutdown.
- [x] Handle close failures without unhandled rejection.
- [x] Test OAuth-error callback, duplicate/replay callback, explicit close, timeout, and port release.
- [x] Guard malformed callback parsing without crashing the process.

## RH-AGENT-MCP-AUTH-CLEANUP-T07 — Pin and test the SDK contract

- [x] Pin `@modelcontextprotocol/sdk` to `1.29.0` for the proof.
- [x] Confirm manifest and lockfile agree.
- [x] Add fake/in-memory integration tests around the canonical session and bootstrap composition.
- [x] Keep all automated tests structurally unable to contact Robinhood.

## RH-AGENT-MCP-AUTH-CLEANUP-T08 — Add encrypted persistence only after cleanup

- [x] Implement one repository-backed provider using the canonical session.
- [x] Persist tokens, client information, and discovery state atomically in a CurrentUser DPAPI-encrypted local bundle.
- [x] Enforce credential revision compare-and-swap.
- [x] Prove a fresh process reconnects without a browser and returns 50 tools.
- [x] Keep Phase 2 refresh testing blocked until restart succeeds; restart is now proven.

---

# Final Post-Remediation Review

The complete uncommitted authentication diff was reviewed again after T08 against the thermo-nuclear approval bar. The final pass found and corrected the following boundary defects.

## Final Finding 1 — Prevent provider state from diverging from durable credentials

**Severity:** Blocker  
**File:** `functions/src/rh-agent-mcp/auth/repository-oauth-provider.ts`

**Problem:**

The provider published newly received tokens to its in-memory state before the encrypted repository write completed. A failed compare-and-swap or storage operation could therefore leave the running process using credentials that a fresh process could not recover. Client-information and discovery-state updates had the same partial-update risk.

**Remediation:**

Credential candidates are now constructed separately and become provider state only after repository persistence succeeds. Initial client information and discovery state remain pending until the first complete token bundle is stored atomically.

**Regression evidence:**

- A synthetic repository failure leaves the provider's previously durable token unchanged.
- Initial tokens, client information, and discovery state persist as one bundle.
- Revision compare-and-swap remains enforced.

## Final Finding 2 — Validate decrypted credentials at the storage boundary

**Severity:** Blocker  
**File:** `functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository.ts`

**Problem:**

The repository performed shallow checks and then cast decrypted JSON to `RobinhoodCredentialBundle`. Invalid nested OAuth fields could cross the persistence boundary with trusted domain types, obscuring corruption or incompatible stored data.

**Remediation:**

The repository now reconstructs the credential bundle from validated values. Tokens, client information, authorization-server metadata, and protected-resource metadata use schemas from the pinned MCP SDK. Revision and local metadata are checked explicitly. The broad cast was deleted.

**Regression evidence:**

- A decrypted bundle with an invalid nested token field is rejected as `InvalidCredentialBundleError`.
- The live DPAPI-encrypted credential bundle loads through the strict parser without contacting Robinhood.

## Final Finding 3 — Recover safely from an interrupted credential writer

**Severity:** High  
**File:** `functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository.ts`

**Problem:**

The directory lock provided cross-process exclusion but had no abandoned-lock recovery. A process termination between lock acquisition and release could permanently block credential rotation and deletion.

**Remediation:**

A lock older than the bounded stale threshold is claimed through an atomic rename. Concurrent reclaimers race on that rename, so only one can acquire the replacement lock. A recent lock still fails closed as `CredentialRepositoryBusyError`.

**Regression evidence:**

- A synthetic stale lock is recovered and the next credential revision is stored.
- Normal compare-and-swap and encrypted atomic replacement continue to pass.

## Final Finding 4 — Model authorization-code ownership as consume-once

**Severity:** High  
**Files:**

- `functions/src/rh-agent-mcp/auth/local-oauth-callback-server.ts`
- `functions/src/rh-agent-mcp/auth/local-oauth-bootstrap.ts`

**Problem:**

The callback exposed the authorization code as mutable optional data so orchestration could overwrite it with `undefined`. That optional contract admitted an impossible valid state and did not express that exactly one owner may consume the code.

**Remediation:**

The callback now exposes `takeAuthorizationCode()`. The first call transfers the code and releases the callback-held reference; subsequent calls fail with `OAuthCallbackCodeConsumedError`.

**Regression evidence:**

- Callback tests prove the exact code is returned once.
- A second read is rejected.
- Browser responses and returned evidence remain free of the code and state.

No file approaches the 1,000-line threshold, no parallel MCP construction path remains, and no arbitrary financial tool call is exposed. Canonical validation passes after all four remediations.

## Approval Gate

The local authentication proof and T08 restart proof are approved. Deployed authentication and trading are explicitly deferred and are not part of this approval.

Approval requires:

- [x] One canonical MCP session and OAuth provider lifecycle.
- [x] No superseded discovery-only executable path.
- [x] Correct authentication-state classification.
- [x] Accurate ephemeral-secret lifecycle claims.
- [x] One idempotent callback cleanup path.
- [x] SDK version pinned to the reviewed contract.
- [x] Production composition covered by fake/in-memory integration tests.
- [x] Canonical validation passes after cleanup.

Encrypted local persistence and fresh-process restart reuse are proven. The tree is ready for a commit plan. Any later refresh, cloud, or trading work requires a new scoped review.
