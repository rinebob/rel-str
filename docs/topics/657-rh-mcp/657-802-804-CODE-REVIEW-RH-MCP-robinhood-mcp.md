**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #804  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# CODE REVIEW — #804: KMS cipher + Firestore credential repository

Gate review per `/proj review 657 804`. Three axes (Standards, Spec,
Thermo-nuclear) + full rh-agent-mcp test surface.

## Scope

- `functions/src/rh-agent-mcp/auth/kms-cipher.ts` — KMS-backed `CredentialCipher`
  + `createKmsCipherFromEnv` (fails closed on unset `RH_CREDENTIAL_KEY_NAME`).
- `functions/src/rh-agent-mcp/auth/kms-firestore-credential-repository.ts` —
  `KmsFirestoreCredentialRepository`, `CredentialDocumentBackend` port,
  `TransactionalCredentialDocumentBackend` (CAS txn body),
  `FirestoreDocStore` (admin adapter), `CredentialDocStore` port.
- `functions/src/rh-agent-mcp/auth/credential-repository.ts` — repository
  contract now also houses `CredentialCipher` + error classes.
- `functions/src/rh-agent-mcp/auth/credential-bundle-codec.ts` — shared
  `parseBundle` validator (moved out of the file repo).
- `functions/src/rh-agent-mcp/auth/encrypted-file-credential-repository.ts` —
  trimmed to the file-store implementation.
- `functions/src/rh-agent-mcp/index.ts`, `functions/package.json`
  (`@google-cloud/kms@6.2.0` pinned, esbuild external, test script).
- `tests/functions/rh-agent-mcp-kms-credential-repository.test.ts` (13 tests),
  shared `rh-agent-mcp-credential-fixtures.ts`.
- `functions/scripts/verify/rh-mcp-kms-repository-804.ts` + guide + README/run-all
  registration (`needsEnv` gate added).

## Standards — clean after remediation

No critical/major violations. Addressed during review: `createKmsCipherFromEnv`
unwired/untested → now used by the verify script + env-unset unit test;
3×-duplicated `bundle()`/base64-cipher fixture → shared
`rh-agent-mcp-credential-fixtures.ts`; `StoredDoc` redeclaration → imports
`StoredCredentialDoc`; verify-script `set` → `$env:` syntax; guide doc-overclaim
on cleanup; `run-all.ts` ADC-only gate → typed `VerifyScript.needsEnv` skip.

## Spec — all ACs met

| AC | Verdict |
|---|---|
| load: missing doc → null; round-trip | Met |
| store: CAS aborts on mismatch; loser reloads winner revision | Met |
| ciphertext doc contains no plaintext | Met |
| unit tests pass (fake txn + fake cipher) | Met — `CredentialDocStore` port now exercises the REAL txn body offline (was the one major finding) |

Deviation vs issue text ("inject Firestore + cipher"): repository takes a
`CredentialDocumentBackend` port; Firestore sits behind
`TransactionalCredentialDocumentBackend` + `FirestoreDocStore`. Justified —
this is what makes the CAS body testable offline without cast-based SDK fakes.

## Thermo-nuclear — remediated

- **Major (fixed):** `FieldValue.serverTimestamp()` inside the port-isolated
  backend smuggled the admin dep it was built to exclude → `updatedAt: new Date()`.
- **Minor (fixed):** cross-implementation contracts housed in
  `encrypted-file-credential-repository.ts` → moved `CredentialCipher` + error
  classes to `credential-repository.ts`, `parseBundle` to
  `credential-bundle-codec.ts`.
- **Minor (accepted, documented):** a malformed doc inside the CAS txn reads as
  `revision: null`, so `store(…, null)` silently self-heals corruption rather
  than throwing. Kept: it gives `delete()`-free recovery semantics; flagged for
  the runbook (#811).
- **Minor (deferred):** `CredentialRevisionConflictError` degrades to the generic
  "re-run OAuth bootstrap" message via the auth-error classifier. Retry-once on
  conflict belongs to the refresh-composition/session-cache task (#807/#808) —
  logged, not fixed here.
- Nits addressed: speculative barrel exports trimmed; verify-script shell syntax.

## Tests

- `test:rh-agent-mcp-kms-repository`: 13/13 — repository × in-memory backend,
  transactional backend × in-memory doc store (real CAS body), KmsCipher × fake
  KMS ops, env-factory fail-closed.
- `test:rh-agent-mcp-credentials`: 7/7 (file repo untouched semantically).
- Full rh-agent-mcp surface: 194/194 green; `tsc --noEmit` clean on changed
  files; esbuild clean. (Two pre-existing unrelated errors in the user's
  in-flight screenshot-capture verify scripts — out of scope.)
- Real-env verification (`rh-mcp-kms-repository-804.ts`) is scripted and
  registered; executes once #805 provisions the KMS key — deferred check, not
  a failure.

## Round 2 (post-remediation re-review)

All six round-1 remediations verified held; no new critical/major. New
minor/nit findings, all fixed in this round:

- KMS layer threw bare `Error` → added `KmsUnavailableError` /
  `KmsOperationError` (mirroring the DPAPI pair) + constructor key-name
  guard; malformed-doc throw → `MalformedCredentialDocError`.
- `EnvCredentialRepository` + `PortableFileCredentialRepository` threw
  untyped conflict/busy errors and portable bypassed `parseBundle` → both
  now use the canonical classes + shared codec (codec header's "shared by
  every implementation" claim is now true).
- Verify script hardcoded the live doc path → imports
  `RH_CREDENTIAL_DOC_PATH`; header named the wrong class.
- Doc key set `{ciphertext, revision, updatedAt}` now asserted in the unit
  test and the live verify script.
- Barrel exports completed: port signature types, `CredentialCipher`,
  `parseBundle`, error classes — #806/#807 consume the barrel.
- `parseBundle` timestamp check tightened to require ISO-8601 shape.
- Stale as-built doc snippet import fixed; `memoryDocStore` comment
  softened to what the fake actually provides.

Re-verified: 13/13 KMS suite, 7/7 credential suite, 10/10 refresh,
8/8 API, full surface green; `tsc --noEmit` clean on changed files;
esbuild clean.

## Verdict

**PASS** — two rounds, no remaining critical or major findings. Remaining
items are documented minors deferred to later thread tasks (runbook
self-heal note → #811; CAS-conflict UX mapping → #807/#808).
