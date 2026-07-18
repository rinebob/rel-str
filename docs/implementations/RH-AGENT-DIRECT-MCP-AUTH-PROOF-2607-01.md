# RH Agent Direct MCP Authentication Proof Plan

**Status:** Phase 1 complete — encrypted persistence and fresh-process restart reuse proven
**Updated:** 2026-07-18
**Scope:** Phase A authentication and read-only connectivity gate
**Related:** `RH-AGENT-DIRECT-MCP-EXECUTION-WORKFLOW-2607-01.md`, `RH-AGENT-BROKER-SYNC-SPIKE-2607-01.md`, `RH-AGENT-ROBINHOOD-MCP-DISCOVERY-USAGE-2607-01.md`, `../reviews/2026-07-18-thermo-review-direct-mcp-auth.md`

## Purpose

Prove that RH Agent can connect directly to the Robinhood Trading MCP without a Claude subprocess after one explicit human authorization ceremony. The proof must establish whether backend-owned credentials can be stored, refreshed, and reused for unattended read-only calls before any production order workflow is implemented.

The initial Robinhood login, consent, account onboarding, and visual identity verification remain human-interactive. This plan does not attempt to automate or bypass them. The target is unattended operation after successful authorization, with a clear reauthorization state whenever Robinhood requires the user again.

## Official references

- Robinhood Agentic Trading overview: `https://robinhood.com/us/en/support/articles/agentic-trading-overview/`
- Robinhood Trading with your agent: `https://robinhood.com/us/en/support/articles/trading-with-your-agent/`
- Robinhood Trading MCP endpoint: `https://agent.robinhood.com/mcp/trading`
- MCP TypeScript SDK dependency already used by this repository: `@modelcontextprotocol/sdk`

Robinhood documents Claude, ChatGPT, Codex, Cursor, Grok, and other MCP-compatible platforms as supported clients. Claude is therefore not a required protocol intermediary. Robinhood also states that opening an Agentic account and authenticating an agent require a desktop device, which is consistent with the interactive browser and identity-verification ceremony.

## Decision

Phase A will pursue this authentication model:

```text
one-time direct MCP bootstrap
→ open official Robinhood authorization URL in a desktop browser
→ user completes login, consent, and any identity verification
→ direct MCP client receives OAuth credentials
→ credentials and required client registration metadata are stored securely
→ backend connects and refreshes without Claude
→ ordinary read-only calls run unattended
→ invalid or revoked authorization becomes REAUTHORIZATION_REQUIRED
```

Claude must not participate in the production authentication, tool-call, reconciliation, or retry path. The working legacy implementation and exact source are preserved in archive documents; executable copies are removed from the active tree.

## Current repository evidence

The legacy source archive contains an unverified local direct-MCP OAuth attempt that formerly lived under `functions/src/rh-agent/`:

- It uses `@modelcontextprotocol/sdk` OAuth support and `StreamableHTTPClientTransport`.
- It attempts an authorization-code flow with PKCE state managed through `OAuthClientProvider`.
- It attempts to open Robinhood's authorization URL in a desktop browser.
- It provides a localhost callback path or manually copied authorization-code path.
- It is written to save OAuth tokens to `.rh-tokens.json` and send a bearer access token to the MCP endpoint.
- Its intended call path does not require Claude after an MCP client connects.

There is no retained evidence that this attempt completed authorization, refreshed credentials, or made a successful direct call. Treat it as exploratory source to inspect, not proof of feasibility or production infrastructure. It also has material gaps:

- Tokens are stored as plaintext local files.
- OAuth client registration information is held only in memory.
- Refresh-token behavior is not exercised or persisted deliberately.
- The transport is constructed with a manually injected access token rather than a complete refresh-aware provider lifecycle.
- The callback is localhost-only and unsuitable for an unattended cloud runtime.
- Authentication diagnostics could expose authorization URLs or credentials if logging is not constrained.
- The implementation was mixed into the legacy `functions/src/rh-agent/` boundary before archival.

At the start of Phase 0, the repository also exported `functions/src/rh-agent-cloud-function/rh-agent-executor.ts` from the Functions entrypoint. That prototype had no valid backend OAuth provider, did not enforce the configured owner UID, lacked durable intent and `ref_id`, and could call a real placement tool. Its exact source is archived and the executable file is removed.

## Required proof questions

### Initial authorization

1. Does the direct MCP SDK discover Robinhood's authorization server metadata successfully?
2. Does Robinhood dynamically register the RH Agent client, or does it return fixed client information?
3. Which OAuth metadata and client information must survive after bootstrap?
4. Does the localhost callback complete after the user performs the visual identity check?
5. Can the same authorization be used after the bootstrap process exits and restarts?

### Credential lifetime and refresh

1. Does the token response include a refresh token?
2. Does it include `expires_in`, scope, token type, or other expiry metadata?
3. Does Robinhood rotate the refresh token on refresh?
4. Can the SDK refresh an expired access token without a browser?
5. Does refresh require persisted OAuth client registration information?
6. Can two overlapping backend invocations refresh safely without invalidating each other?
7. Which responses mean transient failure, revoked authorization, or required user interaction?

### Cloud transfer and unattended operation

1. Can a credential bundle established by the approved bootstrap client be used by the configured Cloud Functions identity?
2. Is the authorization bound to a redirect URI, host, client instance, or platform in a way that prevents transfer?
3. Can a cold-started backend perform `listTools` and one allowlisted read-only call?
4. Can it repeat the read after access-token expiry without user interaction?
5. Can the backend update a rotated refresh token atomically in secure storage?
6. Can all of this occur without exposing account numbers, authorization URLs, tokens, or raw responses in logs?

## Safety invariants

- No authentication-proof step may call `review_equity_order`, `place_equity_order`, `cancel_equity_order`, or any other financial mutation.
- The first allowlisted proof calls are `listTools`, `get_accounts`, and at most one explicitly selected account read such as `get_portfolio` or `get_equity_positions`.
- Complete account numbers, OAuth tokens, authorization codes, code verifiers, account-specific URLs, and raw account responses must never enter Git, documentation, test fixtures, browser storage, Firestore client-readable documents, or ordinary logs. The user-approved historical source archive retains one masked display suffix from the original implementation; it is not valid authentication or routing material.
- Authorization URLs may be shown only to the owner during the active bootstrap ceremony and must not be retained after completion.
- The browser never receives the resulting OAuth credentials.
- A Firebase user session is not a substitute for Robinhood authorization. Both boundaries must be enforced independently.
- The configured owner UID is required for every admin bootstrap or authentication-status operation.
- The proof uses a separate typed direct-MCP module under `functions/src/rh-agent-mcp/`; it does not expand the legacy Claude directory.
- Automated tests use fake transports and synthetic credentials only. They cannot contact Robinhood.
- A failed or ambiguous authentication operation never falls back to Claude.

## Authentication state model

Expose a small operational state rather than raw OAuth details:

```text
UNCONFIGURED
AUTHORIZATION_PENDING
CONNECTED
REFRESHING
REAUTHORIZATION_REQUIRED
TEMPORARILY_UNAVAILABLE
MISCONFIGURED
```

Meanings:

- `UNCONFIGURED`: no approved credential bundle exists.
- `AUTHORIZATION_PENDING`: an owner-started bootstrap is awaiting callback completion.
- `CONNECTED`: a direct authenticated read has succeeded recently.
- `REFRESHING`: one backend owner currently holds the credential-refresh lease.
- `REAUTHORIZATION_REQUIRED`: Robinhood rejected refresh or requires new interactive consent/verification.
- `TEMPORARILY_UNAVAILABLE`: transport, throttling, or server failure occurred without evidence of revoked authorization.
- `MISCONFIGURED`: required client registration, redirect, secret-storage, or account configuration is invalid.

Client-visible status may include the state, last successful check time, and a redacted error category. It must not include token timestamps precise enough to expose sensitive session behavior unless operationally required.

## Credential bundle

The production credential abstraction must be able to preserve, when returned and required:

```text
OAuth tokens
OAuth client registration information
provider metadata needed by the SDK
credential schema version
credential revision for compare-and-swap updates
last successful refresh time
```

The authorization code and PKCE verifier are ephemeral bootstrap state. All application-held references must be released after successful exchange or expiry. JavaScript cannot claim secure zeroization or immediate deletion from process memory.

The Phase 1 foundation uses the Functions lockfile's installed MCP SDK contracts rather than locally invented OAuth fields: `OAuthTokens` for token responses, `OAuthClientInformationMixed` for static or dynamically registered client information, and `OAuthDiscoveryState` for reusable authorization-server and protected-resource discovery. The RH Agent wrapper owns only its credential schema version, compare-and-swap revision, and refresh bookkeeping. These SDK contracts establish storage compatibility; they do not establish which optional fields Robinhood actually returns.

Do not finalize the physical credential schema before observing Robinhood's actual token and refresh behavior. Tests use a synthetic shape that covers access-token expiry and refresh-token rotation without copying real values.

## Secure storage decision gate

Firebase `defineSecret` is suitable for deployment-bound static secrets but does not by itself solve runtime refresh-token rotation. The proof must compare these approaches before production selection:

1. **Google Secret Manager version updates:** backend reads the current version and writes a new version after refresh, with narrowly scoped IAM and revision coordination.
2. **KMS-encrypted server-only persistence:** backend encrypts a credential bundle and stores only ciphertext plus revision metadata in a backend-only document.
3. **Provider-supported non-rotating credential mechanism:** use only if Robinhood explicitly returns one and its lifecycle is observed.

Selection criteria:

- Supports atomic or lease-protected refresh updates.
- Survives cold starts and deployments.
- Denies browser and unauthorized function access.
- Provides recoverability without logging secret values.
- Avoids stale instances overwriting a newly rotated refresh token.
- Has a clear revocation and deletion procedure.

No production credential may be stored as a plaintext Firestore document, environment file, deployed source constant, Firebase client configuration, or browser storage value.

## Proposed module boundary

New proof and production-directed code belongs under:

```text
functions/src/rh-agent-mcp/
  auth/
  client/
  contracts/
  diagnostics/
```

Responsibilities:

- `auth/`: OAuth provider abstraction, bootstrap state, secure credential repository, refresh coordination, and redacted auth status.
- `client/`: refresh-aware direct MCP client creation and lifecycle.
- `contracts/`: internal credential metadata and public redacted status contracts.
- `diagnostics/`: allowlisted read-only proof operations and structural response capture.

The initial bootstrap runner may be a local admin CLI because Robinhood requires desktop interaction. It must share the same auth abstractions as the cloud proof and must not become a general MCP command runner.

## Mandatory architecture guardrails

These rules apply to every Phase 1–4 implementation change. They are acceptance criteria, not suggestions.

### One canonical session path

- Exactly one active module may construct `StreamableHTTPClientTransport` for RH Agent.
- Exactly one active module may construct and own the MCP `Client` lifecycle used by bootstrap, restart, refresh, local diagnostics, and cloud reads.
- That module must expose narrow allowlisted operations; callers must not construct their own MCP clients or receive generic `callTool` access.
- Local bootstrap and cloud/runtime authentication must differ only in credential repository and interaction policy, not in transport, client, refresh, or tool-call implementation.
- A new proof step must extend the canonical session seam. It must not create a sibling factory, wrapper, runner-specific client, or alternate OAuth lifecycle.

### Tracer-bullet and spike retirement rule

- A probe is temporary executable code created to answer one explicit question.
- Before adding the next proof step, decide whether the previous probe becomes the canonical path or is deleted.
- Once a later proof subsumes an earlier probe, preserve the redacted evidence and delete the superseded runner, orchestration, tests, scripts, and exports in the same change.
- Completed probes must not accumulate as permanent modes of the authentication system.
- No package script may remain for a proof path that is no longer the canonical implementation path.

### Ownership and cleanup

- One bootstrap-session scope must generate and own OAuth state, loopback callback lifetime, provider state, PKCE verifier, authorization-code exchange, and cleanup.
- The outer CLI may receive only redacted evidence; it must not retain state, authorization code, verifier, authorization URL, tokens, or client information.
- All terminal paths—success, OAuth rejection, timeout, malformed callback, connection failure, and process interruption—must use one idempotent cleanup path.
- JavaScript implementations may claim only that application references were released for garbage collection. They must not claim secure zeroization or deletion from process memory.

### State and error semantics

- One typed classifier must own OAuth, transport, storage, and MCP error-to-state mapping.
- `REAUTHORIZATION_REQUIRED` is reserved for invalid grant, revoked authorization, or explicit user interaction requirements.
- Transport, timeout, throttling, and server failures map to `TEMPORARILY_UNAVAILABLE`.
- Invalid redirect, registration, credential-store, or required configuration maps to `MISCONFIGURED` when distinguishable.
- Unknown failures fail closed and remain redacted; they must not be guessed into a more specific state.

### Contract and dependency control

- Use installed MCP SDK contracts directly where they are authoritative; do not recreate OAuth response shapes.
- Pin the MCP SDK to the exact version used for the proof until restart, refresh, and token rotation are proven.
- SDK upgrades require focused authorization, refresh, persistence, and error-classification tests.
- Barrel exports must expose only intentional consumers' seams. Tests must not force internal proof helpers into the public API.

### Test the production composition

- Automated tests must exercise the same session/provider/repository composition used by the local CLI and future cloud runtime.
- Injection is used at external seams—transport, credential repository, clock, browser opener—not to replace the orchestration under test with hand-authored callback functions.
- At least one fake/in-memory integration test must execute connect → `listTools` → close through the canonical session.
- Tests must prove partial connection cleanup, callback replay rejection, port release, persistence, restart, refresh rotation, and state classification.
- No automated test may resolve or contact the Robinhood MCP host.

### Phase completion discipline

- A checklist item is complete only when the canonical path implements it; a one-off runner that bypasses the canonical path is evidence, not completion.
- Live success does not approve the architecture that produced it.
- Each phase ends with a dead-code and duplicate-path scan before the next phase begins.
- Persistence work may not begin while a completed probe remains as a parallel executable path.

## Architecture cleanup hold — 2026-07-18

The interactive callback, encrypted persistence, fresh-process restart, and authenticated `listTools` evidence are valid. Cleanup `RH-AGENT-MCP-AUTH-CLEANUP-T01` through `T08` is complete, and the architecture hold is closed.

Required hold-exit conditions:

- [x] One canonical provider-backed MCP session replaces parallel client paths.
- [x] The discovery-only executable spike is removed after preserving its evidence.
- [x] OAuth/MCP failures use the documented typed state classifier.
- [x] One bootstrap-session scope owns ephemeral state and idempotent cleanup.
- [x] The MCP SDK is pinned to the reviewed version.
- [x] Fake/in-memory tests exercise the production composition.
- [x] Canonical validation passes after cleanup.

## Implementation sequence

### Phase 0 — Make experimentation safe

- [x] Remove `rhExecuteTrade` and `rhGetAccountSummary` exports from the deployed Functions entrypoint until they are replaced by the approved direct boundary.
- [x] Confirm no normal Angular route or service can invoke the prototype executor.
- [x] Preserve the exact source and operating detail in archive documents, then remove executable legacy copies from the active tree.
- [x] Verify known legacy credential artifact names remain ignored and manually confirm local artifacts were absent at retirement.
- [x] Add a regression test preventing retired source and generated artifacts from returning to the active Functions and Angular boundaries.

### Phase 1 — Extract a direct local authentication proof

**Owner-approved dependency exception:** Keep `@modelcontextprotocol/sdk` installed between Phase 0 and the immediately following Phase 1 so it is not removed and re-added across adjacent phases. Phase 1 must introduce its first active consumer; remove the dependency if Phase 1 is abandoned or its design no longer uses the SDK.

- [x] Create a new `functions/src/rh-agent-mcp/` authentication boundary using the installed MCP SDK.
- [x] Define a minimal `RobinhoodCredentialRepository` interface rather than reading or writing files inside the OAuth provider.
- [x] Persist OAuth client registration information as well as tokens when Robinhood returns it.
- [x] Implement an explicit one-time local bootstrap command with a localhost callback and PKCE.
- [x] Keep authorization URL and callback state in memory where possible; release provider-held temporary references after exchange. Full bootstrap-session ownership remains subject to the architecture cleanup hold.
- [x] Connect directly and call `listTools` after authorization.
- [x] Record only redacted structural evidence: success category, tool count, token-field presence, expiry presence, refresh-token presence, and client-registration-field presence.
- [x] Restart the process and prove the stored credential bundle reconnects without Claude or a browser.

### Phase 2 — Prove refresh behavior locally

**Status:** Deterministic local refresh implementation complete; the live proof remains pending until the stored Robinhood credential naturally requires refresh.

#### Confirmed MCP SDK 1.29.0 behavior

A network-isolated synthetic probe established the following behavior for the pinned `@modelcontextprotocol/sdk` version:

- Calling `auth()` with a stored refresh token performs a refresh immediately; it does not evaluate `expires_in` against an issuance timestamp first.
- The pre-Phase-2 restart path therefore refreshed on every process start rather than reusing a still-valid access token; the Phase 2 path now evaluates stored lifetime first.
- `refreshAuthorization()` preserves the previous refresh token when the authorization server omits a replacement.
- The SDK streamable HTTP transport can react to HTTP `401` by invoking OAuth refresh internally when it receives the full provider. Phase 2 deliberately supplies only the durably published bearer token to the short-lived MCP transport, so all refresh remains owned by the explicit coordinator.
- The pre-Phase-2 implementation did not write `lastTokenResponseAt`; token acquisition and explicit refresh now persist that timestamp atomically with the token bundle.
- A refresh-token exchange and durable token persistence must be treated as separate failure boundaries. The application must not use candidate credentials until repository persistence succeeds.

#### Phase 2 boundary

Phase 2 remains local-only. It does not add cloud credential storage, deployed endpoints, arbitrary MCP tool execution, account access, or trading.

One explicit refresh coordinator will own the local refresh transaction:

```text
load durable credential revision
→ determine whether refresh is required with an injected clock
→ exchange the refresh token through SDK refreshAuthorization()
→ persist the returned token set with revision compare-and-swap
→ publish the stored bundle to the provider
→ pass only the durable access token into the short-lived MCP transport
→ begin or continue the MCP session
```

The coordinator must call `saveTokens()` outside the SDK refresh request's error-handling boundary. A persistence failure after authorization-server rotation must propagate and prevent the candidate access token from reaching an MCP request.

#### Refresh decision

- A token with a successful token-response timestamp and remaining lifetime beyond the safety window is reusable.
- A token at or within the safety window requires refresh before connection.
- A legacy bundle without a successful token-response timestamp requires one refresh to establish the timestamp.
- A `forceRefresh` flag may bypass the lifetime check for controlled local testing; it does not change persistence or error-classification behavior.
- A token without an expiry field remains usable until a bounded HTTP `401` requires refresh.
- A refresh-required bundle without a refresh token maps to `REAUTHORIZATION_REQUIRED`.

#### Safety invariants

- Refreshed tokens become visible in memory only after encrypted persistence succeeds.
- The MCP transport never receives the OAuth provider and cannot initiate an SDK-owned parallel refresh path.
- A stale writer cannot overwrite a newer credential revision.
- A failed refresh never opens the browser automatically.
- `invalid_grant` or equivalent revocation maps to `REAUTHORIZATION_REQUIRED`.
- Network, server, repository-busy, and revision-conflict failures fail closed without an MCP call.
- No evidence or log contains token values, token request bodies, authorization URLs, account data, or raw provider errors.

#### Redacted evidence

Phase 2 may record only structural booleans and counts:

- Refresh attempted.
- Refresh succeeded.
- Refresh-token field present.
- Refresh token rotated.
- Credential revision advanced.
- Subsequent read-only proof call succeeded.

#### Test matrix

- [x] A valid stored token skips refresh and connects.
- [x] An expired stored token refreshes once before `listTools`.
- [x] A rotated refresh token is persisted and advances the credential revision.
- [x] A refresh response without a replacement refresh token preserves the previous token.
- [x] A persistence failure does not publish or use candidate tokens.
- [x] A stale writer cannot overwrite a newer credential revision or begin an MCP call.
- [x] Invalid grant maps to `REAUTHORIZATION_REQUIRED` without opening the browser.
- [x] Transport or server failure maps to `TEMPORARILY_UNAVAILABLE`.
- [x] A fresh process reuses the persisted refreshed bundle.
- [x] Returned evidence contains no credential material.

#### Live proof gate

- [x] Complete the deterministic fake-clock, fake-fetch, repository, and in-memory MCP tests.
- [x] Run canonical validation and a post-implementation duplicate-path scan.
- [x] Perform one legitimate live refresh without corrupting or invalidating credentials.
- [x] Record only redacted field-presence, revision, and tool-count evidence.

Live forced-refresh result (2026-07-18, `run-local-oauth-bootstrap.ts --force-refresh`):

```text
state: CONNECTED
resultCategory: STORED_CREDENTIAL_REFRESHED
toolCount: 50
refreshAttempted: true
refreshSucceeded: true
refreshTokenRotated: true
credentialRevisionAdvanced: true
subsequentCallSucceeded: true
```

No token values, authorization URLs, account data, or raw provider errors were logged. The encrypted credential bundle advanced to revision 3 with a fresh `lastTokenResponseAt` timestamp and intact access/refresh token fields.

### Phase 2 Retrospective — Preventive architectural checklist

Before declaring a future Phase complete, the author must answer these questions in addition to passing tests. These checks would have caught the structural debt in Phase 2 before it was merged.

1. **Single responsibility per module:** Does each file/module have one clear reason to change? If a file now mixes orchestration, evidence, policy, and session execution, decompose before merging.
2. **Interface creep:** Is any class implementing an external interface also accumulating custom methods that belong elsewhere? If yes, extract a policy/builder/helper.
3. **Meaningful return values:** Does every function return something the caller actually uses to branch? If a boolean is always `true` on success, remove it.
4. **Testing seams:** Are flags or test-only paths isolated in a policy or test harness, or are they bolted onto production orchestration?
5. **File size and nesting:** Is any file approaching 300 lines without a documented decomposition plan? Is the main function readable as a flat chain of named phases?
6. **State-machine clarity:** Can the primary flow be read as `determine phase → execute phase → run session`? If not, extract phase handlers or a state machine.
7. **No conditional data clumps:** Do test fixtures build the same object in multiple ways based on a flag? Make variants explicit with named helpers or parameters.
8. **Canonical-layer ownership:** Is each piece of logic in the package/layer that already owns the concept? Avoid leaking feature logic into shared paths.
9. **Mandatory structural review:** For any PR touching authentication, credentials, or session lifecycle, run a dedicated structural review in addition to behavior tests before merging.

### Deferred Phase 3 — Select and implement secure cloud credential storage

- [ ] Choose Secret Manager versioning, KMS-encrypted server-only storage, or an observed provider-supported alternative.
- [ ] Restrict credential read/write IAM to the narrow direct-MCP runtime identity.
- [ ] Implement credential revision and refresh lease semantics.
- [ ] Add explicit credential deletion/revocation administration.
- [ ] Ensure error paths and structured logs redact all secret-bearing fields.
- [ ] Keep the configured brokerage account number in a separate backend-only secret/reference.

### Deferred Phase 4 — Prove unattended cloud reads

- [ ] Add an owner-only authentication-status operation that returns only the redacted state contract.
- [ ] Add a separately deployed, owner-only read-proof operation with a hardcoded allowlist.
- [ ] From a cold start, connect directly and call `listTools`.
- [ ] Call `get_accounts` only to validate configured account identity; do not return account numbers to the browser.
- [ ] Call one read-only account tool using the configured secret account reference.
- [ ] Persist only a redacted response-shape fixture or synthetic equivalent approved for tests.
- [ ] Repeat after token expiry or natural refresh and prove no browser or Claude interaction occurs.
- [ ] Verify revoked credentials surface `REAUTHORIZATION_REQUIRED` and do not retry indefinitely.

### Deferred Phase 5 — Capture parser evidence and close the gate

- [ ] Capture redacted structural shapes for `get_equity_orders`, `get_equity_positions`, `get_equity_quotes`, and `get_portfolio`.
- [ ] Identify pagination fields, stable broker identities, decimal-string fields, timestamp formats, nullable fields, and sensitive fields to discard.
- [ ] Create synthetic fixtures that preserve structure without real account data.
- [ ] Add strict parsers against those fixtures.
- [ ] Record the authentication and response-shape findings in the broker-sync and discovery documents.
- [ ] Approve or reject progression to owner/account authorization, persistence, and preflight implementation.

## Callback strategy

Start by retesting a local bootstrap callback because Robinhood explicitly requires desktop interaction and the source archive contains an unverified localhost implementation attempt. Do not treat that attempt as successful evidence, and do not deploy a public OAuth callback until it is needed.

A hosted callback is justified only if:

- Credentials cannot be transferred safely from the bootstrap environment to the cloud runtime.
- Robinhood binds authorization to a hosted redirect URI.
- Reauthorization must be initiated from the application.

If a hosted callback becomes necessary, it must use an owner-authenticated, short-lived, single-use state record; exact redirect URI allowlisting; PKCE; expiration; replay prevention; and no token material in redirects, browser storage, or client-visible responses.

## Refresh concurrency

Cloud Functions can overlap. Refresh handling must therefore use a single-owner lease or compare-and-swap protocol:

```text
read credential revision
→ determine refresh is required
→ acquire short refresh lease
→ refresh with current credential
→ persist rotated credential as next revision
→ release lease
→ waiting callers reload latest revision
```

A stale instance must never overwrite a newer refresh token. A failed lease holder must expire safely. Ordinary read calls may retry after loading the newer revision, but financial mutations remain outside this proof and must never be blindly retried.

## Logging and redaction

Allowed operational fields:

- Operation name.
- Authentication-state category.
- Start time and latency.
- Success/failure category.
- HTTP or MCP error class.
- Retry attempt and bounded backoff.
- Whether refresh occurred.
- Credential revision number.
- Tool name for allowlisted read-only calls.
- Returned item count and pagination presence.

Prohibited fields:

- Access or refresh tokens.
- Authorization codes and PKCE verifiers.
- Authorization URLs and callback query strings.
- Account numbers and account-specific URLs.
- Raw request headers.
- Raw MCP account responses.
- OAuth client secrets if Robinhood returns any.

## Test strategy

Automated tests must use injected fakes and cover:

- Initial authorization redirect without logging the URL.
- Callback state validation and PKCE exchange.
- Persistence of tokens and client registration metadata.
- Restart and reconnect from stored synthetic credentials.
- Access-token expiry and successful refresh.
- Refresh-token rotation with revision update.
- Concurrent refresh lease behavior.
- Revoked refresh token mapping to `REAUTHORIZATION_REQUIRED`.
- Temporary transport failure mapping to `TEMPORARILY_UNAVAILABLE`.
- Secret redaction in every error path.
- Owner-only status and proof operations.
- Hard rejection of non-allowlisted tools.
- Structural guarantee that no fake test can contact Robinhood.

Live verification is manual and read-only. No automated or manual authentication proof may place, review, or cancel an order.

## Evidence record

### 2026-07-18 local discovery-only probe

```text
date and environment: 2026-07-18, local Windows process
authentication step exercised: SDK metadata discovery and pre-authorization redirect
human interaction completed: no
authorization required: yes
authorization-server metadata discovered: yes
protected-resource metadata discovered: yes
dynamic client registration returned client information: yes
PKCE verifier generated: yes
access-token field present: no
refresh-token field present: no
callback accepted: not tested
authorization code exchanged: no
read-only tool exercised: none
financial mutation reachable: no
redacted error category: none
integration consequence: proceed to localhost callback and authorization-code exchange proof
```

The probe opened the authorization page only for the active owner ceremony. It did not retain the authorization URL, accept a callback, exchange an authorization code, persist credentials, invoke an MCP tool, or exercise any financial mutation.

### 2026-07-18 local callback and code-exchange proof

```text
date and environment: 2026-07-18, local Windows process
authentication step exercised: localhost callback, authorization-code exchange, authenticated listTools
human interaction completed: yes
authorization required: yes
authorization-server metadata discovered: yes
protected-resource metadata discovered: yes
dynamic client registration returned client information: yes
PKCE verifier generated and provider reference released after exchange: yes
callback accepted with exact state: yes
authorization code exchanged and orchestration reference released: yes
outer-runner OAuth state reference released before process exit: yes, after cleanup
access-token field present: yes
refresh-token field present: yes
expiry metadata present: yes
client registration persisted: no
credentials persisted: no
restart reconnect succeeded: not tested
read-only tool exercised: listTools
reported tool count: 50
financial mutation reachable: no
redacted error category: none
integration consequence: complete architecture cleanup before credential persistence or restart proof
```

The proof held credentials and client registration only in process memory. It did not log or persist credential values, account identifiers, authorization URLs, callback query strings, or tool definitions. The callback listener was loopback-only and one-shot; the authenticated MCP surface invoked only `listTools`.

### 2026-07-18 encrypted persistence and restart proof

```text
date and environment: 2026-07-18, local Windows process
credential protection: Windows CurrentUser DPAPI
credential location class: local application data outside repository
atomic persistence: encrypted temporary file plus rename
credential revision compare-and-swap: enabled
first process authorization callback accepted: yes
access-token field persisted: yes
refresh-token field persisted: yes
expiry metadata persisted: yes
client registration persisted: yes
discovery state persisted: yes
first process authenticated listTools count: 50
fresh process started: yes
browser opened during fresh process: no
callback accepted during fresh process: no
stored credential reused: yes
fresh-process authenticated listTools count: 50
financial mutation reachable: no
redacted error category: none
integration consequence: Phase 1 complete; proceed to Phase 2 refresh behavior proof
```

No credential value, authorization URL, callback query, account identifier, or tool definition was logged or added to the repository. The encrypted local bundle is bound to the current Windows user and is proof storage only; it is not the final cloud credential-store decision.

For each live proof, record only:

```text
date and environment
authentication step exercised
human interaction required: yes/no
access-token field present: yes/no
refresh-token field present: yes/no
expiry metadata present: yes/no
client registration persisted: yes/no
restart reconnect succeeded: yes/no
unattended refresh succeeded: yes/no
read-only tool exercised
pagination observed: yes/no
reauthorization required: yes/no
redacted error category
integration consequence
```

Do not record credential values, account identifiers, authorization URLs, raw payloads, or personal information.

## Go/no-go gates

### Go: continue Phase A direct execution

All must be true:

- One direct human authorization completes without Claude.
- Credential storage survives process restart and cloud cold start.
- At least one unattended refresh succeeds, or Robinhood provides observed credentials whose documented lifetime safely covers the approved operating model.
- Refresh-token rotation is persisted safely.
- Revocation maps cleanly to `REAUTHORIZATION_REQUIRED`.
- Owner and configured-account boundaries are enforceable without exposing account identity.
- Allowlisted cloud read calls work with strict redaction.
- No financial mutation is reachable through the proof surface.

### Conditional go: supervised direct execution only

Use only if direct authentication works but unattended refresh does not. Phase A may continue only as a browser-present, explicitly reauthenticated supervised workflow after a separate scope decision. Cloud synthetic targets and unattended monitoring remain blocked. Broker-held stops remain mandatory protection.

### No-go: retain Robinhood as manual execution surface

Stop direct Phase A execution if Robinhood binds credentials to supported host platforms in a way RH Agent cannot use safely, if refresh requires repeated visual verification too frequently for the operating model, or if secure backend credential rotation cannot be established. Do not restore Claude as an automatic fallback.

## Exit criteria

- [x] Prototype trade callables are disabled from deployment before proof work.
- [ ] Direct SDK authorization succeeds through the official Robinhood browser ceremony.
- [ ] Claude is absent from the authentication and call path.
- [ ] Required token and OAuth client metadata fields are known structurally.
- [ ] Stored authorization survives process restart.
- [ ] Secure cloud storage and refresh coordination are selected and tested.
- [ ] A cold-started backend performs an allowlisted read-only call.
- [ ] Natural token refresh succeeds unattended or produces a documented conditional/no-go decision.
- [ ] Reauthorization is explicit, visible, and never treated as a transient retry loop.
- [ ] No secret or account identifier appears in Git, logs, browser state, fixtures, or client-visible records.
- [ ] Fake-only automated tests cover authorization, refresh, rotation, concurrency, redaction, and tool allowlisting.
- [ ] Response-shape evidence is sufficient to begin strict broker DTO and parser implementation.

## Deferred

- Order drafts, preflight, authorization fingerprints, capacity reservation, and `ref_id` persistence.
- `place_equity_order`, order cancellation, stops, exits, and synthetic targets.
- General-purpose MCP proxying.
- Multi-owner or multi-account authorization.
- Automated identity verification or attempts to bypass Robinhood's interactive controls.
- Automatic fallback to Claude or another AI platform.
