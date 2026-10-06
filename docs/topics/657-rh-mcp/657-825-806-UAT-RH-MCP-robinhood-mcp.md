**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #825  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #806  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# UAT — #806: upload-rh-credential script + initial seed

Ops-script task. Acceptance = live cloud state + fresh runs of the verify
script and the real CLI's guard paths. No UI surface.

## Prerequisites

- `gcloud` authenticated as the owner account, project `rel-str`.
- ADC (`gcloud auth application-default login`) — owner user holds
  `cryptoKeyEncrypterDecrypter` on the credentials key.
- `RH_CREDENTIAL_KEY_NAME` set (see `functions/.env` locally).
- The live doc already seeded (done during implementation): the seed
  scenario verifies state + guard, not a re-seed.

## Scenarios

1. **Live upload pipeline re-run (scratch doc).**
   `cd functions`; `npx tsx scripts/verify/rh-mcp-upload-806.ts`
   → all checks PASS, exit 0. Exercises `readBundleFile` → seed →
   ciphertext-only doc → reload → seed refusal → replace CAS → delete on
   `rh-agent-credentials/verify-scratch`.
   *Result:* **PASS** — 11/11 checks, `=== PASS ===`, exit 0 (2026-10-06,
   owner ADC, real KMS + Firestore).
2. **Live bundle doc is seeded correctly.** Read
   `rh-agent-credentials/bundle` via admin SDK → exists, `revision: 1`,
   keys exactly `ciphertext,revision,updatedAt`, ciphertext is base64.
   *Result:* **PASS** — exists, `revision: 1`, keys exactly
   `ciphertext,revision,updatedAt`, ciphertext matches `^[A-Za-z0-9+/=]+$`.
3. **Seed guard against the real doc.** From `functions/`:
   `npx tsx scripts/upload-rh-credential.ts ..\tests\functions\fixtures\rh-credential-bundle-valid.json`
   → fails with `CredentialRevisionConflictError` (doc exists at rev 1),
   exit 1, doc unchanged (still revision 1 afterward).
   *Result:* **PASS** — `CredentialRevisionConflictError`, exit 1; doc
   re-read confirms `revision: 1` unchanged.
4. **Usage errors exit 2.** `npx tsx scripts/upload-rh-credential.ts`
   (no args) → usage line, exit 2. With `--repalce` (typo) →
   "Unknown flag" / usage, exit 2 — typo'd flags cannot silently become
   seed mode.
   *Result:* **PASS** — no args → usage line, exit 2; `--repalce` →
   usage line, exit 2 (never reaches Firestore).
5. **Missing env fails closed.** Without `RH_CREDENTIAL_KEY_NAME`:
   → message naming the var, exit 2.
   *Result:* **PASS** — `RH_CREDENTIAL_KEY_NAME is not set — provisioned
   in task #805.`, exit 2.
6. **Bad bundle file fails closed.** `--bundle` pointing at
   `tests/functions/fixtures/rh-credential-bundle-malformed.json` →
   `InvalidCredentialBundleError`, exit 1, nothing written.
   *Result:* **PASS** — `InvalidCredentialBundleError`, exit 1.
7. **No token material in output.** Seed run evidence object +
   verify run output contain only structural fields (revision,
   schemaVersion, hasAccessToken, …) — grep the captured output for the
   synthetic fixture tokens must find nothing.
   *Result:* **PASS** — full verify output captured and searched for the
   fixture's `access_token`/`refresh_token` values: no matches.
8. **Unit suite.** `npx tsx --test tests/functions/rh-agent-mcp-upload-credential.test.ts`
   → 9/9 green; credential-surface regression sweep green; `tsc --noEmit`
   clean.
   *Result:* **PASS** — 9/9 tests, `tsc-exit=0`.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| script writes ciphertext doc at `rh-agent-credentials/bundle` rev 1 | 1, 2, 3 |
| reload through the repository returns equivalent bundle | 1 (reload check), 2 |
| no token values printed or logged | 1, 7 |

## Refinement pass

Not applicable — ops script, no user-facing surface.

## Regression / smoke

- `rh-mcp-kms-repository-804.ts` still passes against the scratch doc
  (unchanged pipeline). **PASS** — `=== PASS ===`, exit 0.
