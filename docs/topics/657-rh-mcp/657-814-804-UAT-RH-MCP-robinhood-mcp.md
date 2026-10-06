**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #814  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #804  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# UAT — #804: KMS cipher + Firestore credential repository

Backend credential-store infrastructure. No user-facing UI — acceptance is
unit suite + deliberate live script.

## Prerequisites

- Repo `rel-str`, Node 20, `cd functions && npm ci`.
- Unit suite: no credentials needed.
- Live script (scenarios 7–8): ADC (`gcloud auth application-default login`)
  **and** a provisioned KMS key with `RH_CREDENTIAL_KEY_NAME` set — gated on
  task **#805** (KMS API is not yet enabled in project `rel-str`).

## Scenarios

1. **Repository semantics (offline).** `npm run test:rh-agent-mcp-kms-repository`
   → 13/13: load-null, ciphertext-only round-trip, CAS abort on stale
   expectedRevision, loser reloads winner + retries, malformed doc fails closed,
   delete, KMS call shape + empty-response guards, env-factory fail-closed.
   *Result: PASS — 13/13 (2026-10-05).*
2. **Existing repos unaffected.** `npm run test:rh-agent-mcp-credentials`
   → 7/7; `test:rh-agent-mcp-refresh` → 10/10; `test:rh-agent-mcp-auth-errors`
   → 3/3.
   *Result: PASS.*
3. **Typecheck + build.** `npm run typecheck` clean on changed files;
   `npm run build` esbuild bundle succeeds (`@google-cloud/kms` external).
   *Result: PASS.*
4. **Fail-closed — missing key env.** `npx tsx scripts/verify/rh-mcp-kms-repository-804.ts`
   with `RH_CREDENTIAL_KEY_NAME` unset → prints configuration error, exit 2.
   *Result: PASS — observed exit 2.*
5. **Fail-closed — live path refusal.** `npx tsx scripts/verify/rh-mcp-kms-repository-804.ts --doc rh-agent-credentials/bundle`
   → refuses, exit 2, no Firestore write.
   *Result: PASS — observed exit 2 (refusal precedes the env check).*
6. **Full rh-agent-mcp surface.** All rh-agent-mcp suites green (194 tests).
   *Result: PASS.*
7. **Real KMS round-trip + Firestore CAS.** Run the live script with ADC +
   `RH_CREDENTIAL_KEY_NAME` per `scripts/verify/rh-mcp-kms-repository-804.md`.
   *Result: DEFERRED to #805 acceptance — cloudkms API not enabled / key not
   provisioned; the check moved to the task that delivers the infrastructure.
   Script delivery itself is verified by scenarios 4–5 + 8.*
8. **run-all gating.** `scripts/verify/run-all.ts` lists the script as
   SKIPPED (missing env) rather than failing.
   *Result: PASS — needsEnv gate in place.*

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| load→null missing, round-trip parse | 1, 7 |
| store CAS conflict + retry | 1, 7 |
| ciphertext-only doc, no plaintext | 1 (key-set + content asserts), 7 |
| unit tests via fake store/cipher | 1, 6 |
| fail closed on missing key | 1, 4 |
| live verify deliberate + scratch-only | 4, 5, 7, 8 |

## Refinement pass

Not applicable — no user-facing surface.

## Regression notes

`EnvCredentialRepository` / `PortableFileCredentialRepository` now throw the
canonical typed errors and use `parseBundle` — verified green via scenarios
2 and 6 (refresh + auth-error suites exercise these repos).
