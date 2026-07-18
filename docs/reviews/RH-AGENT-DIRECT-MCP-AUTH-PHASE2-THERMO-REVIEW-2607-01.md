# Thermo-Nuclear Review: Phase 2 Direct MCP OAuth Refresh

**Date:** 2026-07-18  
**Scope:** Uncommitted Phase 2 changes for explicit OAuth token refresh coordination.  
**Outcome:** Behavior is correct and live-proven, but structural debt was introduced. This document records the findings, root cause, cleanup tasks, and preventive checklist.

## Findings

### 1. `local-oauth-bootstrap.ts` has become a tangled orchestrator

The file grew to 272 lines and now mixes bootstrap decision flow, error handling, evidence building, and session execution inside deeply nested `try/catch` blocks. The refresh path is split between `refreshStoredCredential` and inline logic.

**Impact:** Hard to reason about, hard to extend for Phase 3 cloud session renewal, and prone to spaghetti growth.

**Cleanup:** Reframe the bootstrap as a flat chain of phase handlers. Extract focused helpers for:

- reusing a valid stored credential,
- refreshing an expired or forced-refresh credential,
- performing initial authorization.

The main function should read as `determine phase → execute phase → run session`.

### 2. `RepositoryOAuthProvider` leaks bootstrap concerns

The class implements `OAuthClientProvider` but also owns `hasUsableStoredToken`, `snapshot`, `saveRefreshedTokens`, and `clearBootstrapState`. These are not SDK provider responsibilities; they are lifetime policy, evidence, and bootstrap-session concerns.

**Impact:** The provider is becoming a grab-bag. Phase 3 cloud renewal will make this worse.

**Cleanup:**

- Keep `RepositoryOAuthProvider` as a thin persistence-backed `OAuthClientProvider`.
- Move lifetime decision into a dedicated `TokenRefreshPolicy`.
- Move evidence snapshot into a `BootstrapEvidenceBuilder`.

### 3. `saveRefreshedTokens` returns a meaningless boolean

`saveRefreshedTokens` returns `credentialRevisionAdvanced: boolean`. Because `persistTokens` either throws or advances the revision, the value is structurally always `true` on success. The boolean adds an indirect contract with no actionable information.

**Cleanup:** Return the new revision number or the stored bundle, or rely on the throw-on-failure contract and remove the boolean from the public API.

### 4. `forceRefresh` is a raw flag threaded through production orchestration

The testing seam lives as a bare boolean inside `LocalOAuthBootstrapDependencies` and is checked inline in the main bootstrap. This scatters a test-only concern across the production flow.

**Cleanup:** Encapsulate the refresh decision (including `forceRefresh`) inside `TokenRefreshPolicy`. The bootstrap should ask the policy whether to refresh and not know whether the answer came from expiry math or a test override.

### 5. Test fixture uses a boolean to build two bundle shapes

`storedCredential({ completeDiscovery?: boolean })` conditionally constructs minimal or full discovery metadata. This is a minor data-clump smell and makes test setup less explicit.

**Cleanup:** Replace the flag with two explicit helpers or pass discovery metadata as an explicit argument.

## Root Cause: Why This Was Not Caught Earlier

The existing self-checks are behavior-focused, not architecture-focused:

- **TDD cycle:** Tests verified correct behavior for reuse, refresh, persistence failure, CAS conflict, error classification, and redaction. They did not enforce module boundaries or file cohesion.
- **`npm run validate`:** Runs typecheck, lint, unit tests, and the Angular signal-list test. None of these inspect structural quality, file-size growth, or responsibility boundaries.
- **No pre-merge architectural gate:** There is no checklist requiring the author to ask whether a new concern belongs in the file being edited, whether a provider is acquiring non-interface responsibilities, or whether a boolean return adds meaningful information.
- **Iterative pressure:** Each vertical slice added a small amount of logic to existing files. The cumulative effect crossed the line into tangled orchestration, but the line was not visible until a dedicated structural review was requested.

## Preventive Checklist (add to planning doc)

Before declaring a Phase complete, the author must answer:

1. **Responsibility boundaries:** Does each file/module have one clear reason to change? If a file now mixes orchestration, evidence, policy, and session execution, decompose before merging.
2. **Interface creep:** Is any class implementing an external interface also accumulating custom methods that belong elsewhere? If yes, extract a policy/builder/helper.
3. **Meaningful return values:** Does every function return something the caller actually uses to branch? If a boolean is always `true` on success, remove it.
4. **Testing seams:** Are flags like `forceRefresh` isolated in a policy or test harness, or are they bolted onto production orchestration?
5. **File size:** Is any file approaching 300 lines without a documented decomposition plan? Is any file approaching 1k lines?
6. **State machine clarity:** Can the main flow be read as a sequence of named phases? If not, extract phase handlers or a state machine.
7. **Duplicate shape:** Are test fixtures building the same object in multiple ways based on a flag? Make the variants explicit.
8. **Review trigger:** For any PR touching authentication, credentials, or session lifecycle, run a dedicated structural review in addition to behavior tests before merging.

## Cleanup Task List

- [x] Create `functions/src/rh-agent-mcp/auth/token-refresh-policy.ts` and move `hasUsableStoredToken` logic there.
- [x] Create `functions/src/rh-agent-mcp/auth/bootstrap-evidence.ts` and move snapshot/evidence building there.
- [x] Slim `RepositoryOAuthProvider` back to a pure `OAuthClientProvider` plus `currentRevision`/`pkceVerifierGenerated` accessors.
- [x] Remove the always-true `credentialRevisionAdvanced` boolean from `saveRefreshedTokens`; `refreshStoredCredential` now uses `provider.saveTokens` and returns only rotation status.
- [x] Refactor `local-oauth-bootstrap.ts` into phase-handler functions: `tryRefreshStoredCredential`, `performInitialAuthorization`, and `runSession`.
- [x] Move `forceRefresh` handling into `TokenRefreshPolicy`.
- [x] Clean up test fixtures to avoid the `completeDiscovery` boolean shape.
- [x] Re-run `npm run validate` and the live forced-refresh diagnostic.
- [x] Update `RH-AGENT-DIRECT-MCP-AUTH-PROOF-2607-01.md` with the preventive checklist.

## Verification

- `npm run validate`: passed.
- Live `run-local-oauth-bootstrap.ts --force-refresh`: `STORED_CREDENTIAL_REFRESHED`, 50 tools, redacted evidence.

## Re-Review

After cleanup:

- `local-oauth-bootstrap.ts` is now a flat orchestrator: load bundle → decide phase → delegate to `tryRefreshStoredCredential`, `performInitialAuthorization`, or `runSession`. The nested spaghetti is gone. File length is ~280 lines, which is acceptable for an orchestrator but should be watched if Phase 3 adds cloud renewal logic.
- `RepositoryOAuthProvider` is back to being a thin persistence-backed `OAuthClientProvider` with small read accessors. Lifetime and evidence concerns are gone.
- `TokenRefreshPolicy` cleanly encapsulates the `forceRefresh` seam and expiry decision.
- `BootstrapEvidenceBuilder` owns evidence snapshot construction.
- The always-true boolean return is gone.
- Test fixtures use explicit discovery-state constants instead of a boolean flag.

**Residual note fixed:** `previousRevision` is now captured immediately after `await provider.currentBundle()` in `runLocalOAuthBootstrapWithDependencies` and passed explicitly into `tryRefreshStoredCredential`. The synchronous `provider.currentRevision()` is still used only to read the *new* revision after a successful save, which is safe because `saveTokens` updates the in-memory bundle.

## Approval

Phase 2 cleanup is complete. The structure is now ready for Phase 3 cloud credential storage and unattended session renewal.
