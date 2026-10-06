# Verify guide — #804 BE KMS cipher + Firestore credential repository

Exercises the real credential-store pipeline end-to-end: KMS encrypt/decrypt →
Firestore doc write → CAS revision guard → load/decrypt round-trip → delete.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `rh-mcp-kms-repository-804.ts` | `KmsCipher` against the real KMS key; `TransactionalCredentialDocumentBackend` transactional CAS; `KmsFirestoreCredentialRepository` ciphertext-only docs, `CredentialRevisionConflictError`, malformed-doc fail-closed, delete | ADC + `RH_CREDENTIAL_KEY_NAME` |

## Usage

```powershell
cd functions
$env:RH_CREDENTIAL_KEY_NAME="projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
npx tsx scripts/verify/rh-mcp-kms-repository-804.ts
```

| Flag | Description |
|---|---|
| `--doc <path>` | Override the scratch doc path (default `rh-agent-credentials/verify-scratch`). The live `rh-agent-credentials/bundle` path is refused. |

**Pass:** every check prints `PASS`, doc is deleted, exit 0.
**Fail:** offending check prints `FAIL` with detail; exit 1.
**Setup failure:** missing `RH_CREDENTIAL_KEY_NAME` or unprovisioned key → exit 2 with instructions.

## Prerequisites

- ADC (`gcloud auth application-default login`) with permission to
  `cryptoKeyVersions.useToEncrypt/Decrypt` on the key and Firestore write access.
- The KMS keyring/key provisioned (task #805).

## Notes

- Only synthetic bundles are written — no real Robinhood token material is ever
  sent through this script; the seed path is the `upload-rh-credential` task (#806).
- The scratch doc is deleted at the end of a completed run. A hard crash or
  mid-run throw can leave it behind — re-running starts from a clean slate
  (the script deletes the doc first), so re-running is safe and idempotent.
