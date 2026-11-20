**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1639  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# Code Review — BE-IMPL: Rewire prod RH passes to KmsFirestoreCredentialRepository (#1639)

## Verdict: PASS

## Pass sequence

```text
First pass complete — 2 majors (canary classified KMS-path persistent failures as transient → alarm suppressed on the new path; OAuth-layer rotation race: concurrent refresh loser got invalid_grant and died even with a healthy winner in Firestore), 3 minors (dead SDS settlement manager — silently skipping settlement nightly; dead env factory/repository; KMS client + Firestore app minted eagerly per invocation), 3 nits — all remediated in-gate
Second pass complete — re-verified remediated diff: adopt-winner generalized to any refresh failure (winner stamped lastTokenResponseAt → shouldRefresh false → adopt); classifier now catches KmsUnavailableError/MalformedCredentialDocError/InvalidCredentialBundleError + PERMISSION_DENIED/FAILED_PRECONDITION; env path fully removed; factory lazy + warm-instance singleton; tsc clean, 414/414 paper-trading, 17/17 kms-repo, 12/12 refresh (incl. new invalid_grant loser test)
Convergence: PASS — both majors fixed and covered by new tests, minors remediated or documented deferrals, clean second pass
```

## Scope reviewed

- `functions/src/rh-agent-mcp/auth/production-credential-repository.ts` (NEW — shared factory; lazy `getFirestore`, warm-instance shared repository, fail-closed cipher resolution)
- `functions/src/rh-agent-mcp/auth/robinhood-mcp-connection.ts` (refresh-failure adopt-winner)
- `functions/src/rh-agent-mcp/auth/env-credential-repository.ts` (DELETED)
- `functions/src/options-strategy-engine/mcp/robinhood-mcp-session-manager.ts` (`createRobinhoodMcpSessionManagerFromKms`; `FromEnv` removed)
- `functions/src/rh-agent-mcp/cloud-api/rh-api.ts` (delegates to shared factory)
- `functions/src/paper-trading/engine/passes/rh-credential-canary.ts` (KMS path + expanded classifier)
- Rewired call sites: `manage-open-callable.ts`, `open-pass-timer.ts`, `options-strategy-passes.ts`, `expression-fill-pass.ts`, `auto-paper-ingest-task.ts`, `callables.ts`, `manage-exit-scan-pass.ts`, `settlement-pass.ts`, `position-ids.ts`, `strategy-instance-repository.ts`, `eod-selection-pass.ts`, `paper-stats-pass.ts`
- `functions/src/symbol-data-sync/symbol-data-sync.ts` (dead manager removed)
- Tests: `rh-agent-mcp-kms-repository-factory.test.ts` (NEW), `robinhood-mcp-session-manager.test.ts`, `rh-credential-canary.test.ts`, `rh-agent-mcp-token-refresh-failures.test.ts`
- Verify: `functions/scripts/verify/rh-mcp-kms-repo-1639.{ts,md}`, `README.md`, `run-all.ts`, `functions/package.json`

## Standards axis

- Shared factory = single construction site; `rhApi` and `FromKms` session manager both delegate — no duplicated KMS/Firestore wiring.
- `getFirestore()` lazy → barrel consumers (`functions/src/rh-agent-mcp/index.ts`) no longer drag `initializeApp`/Firestore on import.
- Fail-closed ordering verified: `createKmsCipherFromEnv()` resolves **before** Firestore, so unconfigured env surfaces `KmsUnavailableError`, not an opaque no-app error.
- Test injection seam preserved: `FromKms(options)` accepts a repository override; the singleton is only the no-deps production path.
- No token material in logs; `firestore.rules` `rh-agent-credentials` client-deny unchanged.

### Remediated in-gate

1. **MAJOR — OAuth-layer rotation race** (`robinhood-mcp-connection.ts`): two warm instances load the same stale bundle, both POST refresh; Robinhood rotates the grant for the winner and rejects the loser with `invalid_grant`. Previously the loser reported `REAUTHORIZATION_REQUIRED` even though the doc already held the rotated bundle — adopt-winner only covered the CAS-layer race (`CredentialRevisionConflictError`). Fixed: on **any** refresh failure, reload the repository; if the reloaded bundle no longer needs refresh, adopt it silently and connect. Reauthorization is only reported when the reload is absent/still stale. New test `connect-path refresh adopts a winner persisted during the loser's rejected refresh` covers it.
2. **MAJOR — canary misclassified the new path's persistent failures** (`rh-credential-canary.ts`): `KmsUnavailableError`, `MalformedCredentialDocError`, `InvalidCredentialBundleError`, KMS `PERMISSION_DENIED`/`FAILED_PRECONDITION` all fell to `transient` → no `rh_credential_canary_fail` marker → no banner. Same finding class as #1628's first review. Fixed: classifier recognizes error names + gRPC-style codes; new tests assert `reauth_required` + alarm marker for each.
3. **MINOR — dead settlement manager** (`symbol-data-sync.ts`): created an env-backed manager around `runSettlementForAllInstances()` which takes no manager — and with no secret bound there it had been throwing (caught + logged) every run. Removed; settlement runs directly.
4. **MINOR — dead env path**: `createRobinhoodMcpSessionManagerFromEnv` + `EnvCredentialRepository` had zero references post-rewire (diagnostics use `PortableFileCredentialRepository` directly). Both deleted; dead `RH_CREDENTIAL_BUNDLE is not set` classifier branch removed.
5. **MINOR — eager construction**: original factory constructed Firestore + a fresh `KeyManagementServiceClient` per call on module-adjacent import. Fixed: lazy `getFirestore` + shared warm-instance repository for the no-deps path.
6. **NIT — verify script proof gap**: revision bump only proves persistence if refresh actually fired. Fixed: also prints `lastTokenResponseAt` before/after; refresh detection no longer depends on rotation.

### Deferred minors (accepted, documented)

- `rhApi` per-request Firestore doc load + KMS decrypt inside session-cache `acquire()` — that re-read IS the cross-instance staleness fix; caching the decrypted bundle would reintroduce it. Optimization (decrypt-on-revision-change) is a plausible follow-up, not a blocker.
- `Partial<RobinhoodMcpSessionManagerOptions>` allows a fake `connect` with a real repo construction — injection surface documented; narrowing is polish.
- `makeFakeConnection()` captures `closed.value` at construction (stale field) — cosmetic test seam.
- Stale UAT/runbook references to the env-secret path — deferred to #811 — BE-DOCS: Runbook — seed/reauth/revoke/rotate (the runbook doc doesn't exist yet; the AC is formally deferred there).

## Spec axis (vs issue #1639 acceptance criteria)

| AC | Verdict | Evidence |
|---|---|---|
| All prod consumers rewired off `RH_CREDENTIAL_BUNDLE`/`EnvCredentialRepository` | **MET** | 8 call-site files + canary + rhApi on the shared factory; env repo deleted; `secrets:` bindings dropped |
| Canary probes the same path the passes use | **MET** | Canary now uses `FromKms` — identical repo + refresh path as `openPassTimer` |
| Durable rotation survives process lifetime | **MET (mechanism)** | Transactional CAS + adopt-winner on both store-conflict and refresh-rejection races; live doc loaded revision 5, real SPY probe passed pre-deploy |
| Fail-closed when unconfigured | **MET** | Missing `RH_CREDENTIAL_KEY_NAME` → `KmsUnavailableError` before any Firestore work; test asserts no-session on throw |
| Runbook updated | **DEFERRED → #811** | No runbook doc exists; flagged on the task |

## Thermo-nuclear axis

- Worst-case sweep: concurrent cold-start stampede (N instances, one grant) — winner persists, losers adopt on both failure layers now. Residual: N simultaneous refresh POSTs still occur (lock-free by design); losers' extra POSTs are load-noise only since adoption follows.
- Credential-leak surface: doc payload is KMS-encrypted at rest, client-reads denied by rules, no token material in logs or status docs.
- Trust boundary: `RH_CREDENTIAL_KEY_NAME` is the only prod config required; verified present in `functions/.env`. **Service-account KMS IAM not proven by the live script (user ADC)** — the deployed canary run is the authoritative check; flagged for QA.
