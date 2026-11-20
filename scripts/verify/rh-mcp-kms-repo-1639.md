# Verify guide — #1639 BE rewire prod passes to KmsFirestoreCredentialRepository

Exercises the production credential path every deployed consumer now shares:
`createKmsCredentialRepository` → `rh-agent-credentials/bundle` → KMS decrypt →
(optionally) full session connect + real MCP probe.

## Scripts

| Script | Covers | Credentials |
|---|---|---|
| `rh-mcp-kms-repo-1639.ts` | production factory wiring → Firestore doc load → KMS decrypt → bundle shape; `--connect` adds the real refresh → MCP `get_option_chains` probe → revision persistence check | ADC + `RH_CREDENTIAL_KEY_NAME` |

## Usage

```powershell
cd functions
$env:RH_CREDENTIAL_KEY_NAME="projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"
npx tsx scripts/verify/rh-mcp-kms-repo-1639.ts [--connect]
```

| Flag | Description |
|---|---|
| `--connect` | Builds a session through `createRobinhoodMcpSessionManagerFromKms` — the exact factory the noon pass uses — and calls `get_option_chains` for SPY. A token refresh inside connect rotates + persists the grant, bumping the doc revision; the script prints revision before/after as direct evidence durable rotation works. |

**Pass:** every check prints `PASS`, exit 0. With `--connect`, a live grant
prints the probe latency and (on rotation) the revision bump notice.
**Fail:** offending check prints `FAIL` with detail, exit 1 — e.g. doc
missing, malformed bundle shape, probe error (surfaces as the process's
non-zero exit with the error name/message).
**Setup failure:** missing `RH_CREDENTIAL_KEY_NAME` → exit 2.

## Prerequisites

- ADC (`gcloud auth application-default login`) with
  `cryptoKeyVersions.useToEncrypt/Decrypt` on the key and Firestore read.
- The bundle doc seeded (task #806's `upload-rh-credential`).

## Notes

- Structural evidence only — token values are never printed.
- `--connect` performs real Robinhood traffic and, when a refresh occurs, a
  real rotation write to `rh-agent-credentials/bundle`. That write is the
  production behavior this task ships — the doc always ends holding the
  newest grant, never a regression.
- The scheduled `rhCredentialCanary` run covers the same path in prod after
  deploy — the local `--connect` run is the pre-deploy equivalent.
