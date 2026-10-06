# Verify guide — #806 BE credential upload script + initial seed

Exercises the upload flow end-to-end against real KMS + Firestore: portable
bundle file → `readBundleFile` (parseBundle validation) →
`uploadCredentialBundle` seed → ciphertext doc → reload round-trip → seed
refusal → `--replace` CAS → delete. All on the scratch doc, never the live
`rh-agent-credentials/bundle`.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `rh-mcp-upload-806.ts` | `readBundleFile` file→parse; `uploadCredentialBundle` seed/replace/CAS-conflict; structural evidence (no token material); ciphertext-only doc; reload round-trip; delete | ADC + `RH_CREDENTIAL_KEY_NAME` |

The operational counterpart — `functions/scripts/upload-rh-credential.ts` —
writes the real `bundle` doc. It is the seed itself, not a verification script:
run it once with the real exported bundle.

## Usage

```powershell
cd functions
$env:RH_CREDENTIAL_KEY_NAME="projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
npx tsx scripts/verify/rh-mcp-upload-806.ts
```

| Flag | Description |
|---|---|
| `--bundle <path>` | Portable bundle file to upload (default `../tests/functions/fixtures/rh-credential-bundle-valid.json`, a committed synthetic bundle). |
| `--doc <path>` | Override the scratch doc path (default `rh-agent-credentials/verify-scratch`). The live `rh-agent-credentials/bundle` path is refused. |

**Pass:** every check prints `PASS`, scratch doc deleted, exit 0.
**Fail:** offending check prints `FAIL` with detail; exit 1.
**Setup failure:** missing `RH_CREDENTIAL_KEY_NAME`, unprovisioned key, or
unreadable bundle file → exit 2.

## Prerequisites

- ADC (`gcloud auth application-default login`) with
  `cryptoKeyVersions.useToEncrypt/Decrypt` on the key and Firestore write
  access.
- The KMS keyring/key provisioned (task #805).

## Seeding production (the real run)

```powershell
# 1. Export the local DPAPI bundle to a scratch path (contains live tokens)
npx tsx src/rh-agent-mcp/diagnostics/export-credential-bundle.ts <scratch-path>\rh-bundle.json

# 2. Seed (or --replace after reauthorization)
npx tsx scripts/upload-rh-credential.ts <scratch-path>\rh-bundle.json

# 3. Delete the export immediately — plaintext tokens
Remove-Item <scratch-path>\rh-bundle.json
```

Prints `uploaded_credential` evidence: `revision`, `schemaVersion`, booleans —
never token values.

## Notes

- The scratch doc is deleted at the end of a completed run; the script cleans
  the slate first, so re-running is safe and idempotent.
- Seed mode refuses to overwrite an existing doc — the refusal is the guard
  against clobbering a live bundle with a stale export.
