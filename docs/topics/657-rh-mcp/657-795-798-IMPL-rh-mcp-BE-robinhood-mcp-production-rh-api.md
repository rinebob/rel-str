**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #798  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# IMPL — BE: Production RH API

Backend implementation plan for the `/api/rh/**` surface in production. Primer
on the credential concepts: `657-798-DESIGN-rh-mcp-cloud-credentials-kms-primer.md`.

## Components

### 1. `KmsFirestoreCredentialRepository` — `rh-agent-mcp/auth/kms-firestore-credential-repository.ts`

Implements `RobinhoodCredentialRepository` (`load / store / delete`).

- **Doc path:** `rh-agent-credentials/bundle` — flat domain-prefixed root
  collection per AGENTS.md (`rh-agent-` prefix). Even segment count.
- **Doc shape:** `{ ciphertext: string /* base64 */, revision: number, updatedAt: Timestamp }`.
- `load()`: read doc → `null` if missing → KMS `decrypt` → `JSON.parse` →
  `RobinhoodCredentialBundle`.
- `store(bundle, expectedRevision)`: `runTransaction` — read doc, abort if
  `doc.revision !== expectedRevision` (CAS), `encrypt` new bundle, write
  `{ ciphertext', revision+1 }`. Encrypt inside the txn callback is fine (KMS
  calls are fast, txn retries replay it — encrypt is deterministic-safe since
  we don't depend on ciphertext equality).
- `delete()`: delete doc.
- Injected deps: `Firestore`, `KmsCipher` interface (`encrypt/decrypt`) — fakes
  in tests, real KMS client in prod.

### 2. `KmsCipher` — `rh-agent-mcp/auth/kms-cipher.ts`

Thin wrapper over `@google-cloud/kms` `KeyManagementServiceClient`:
`encrypt(Uint8Array)`, `decrypt(ciphertext)`; key resource name from env
`RH_CREDENTIAL_KEY_NAME` (`projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials`).

New dep: `@google-cloud/kms` — add to `functions/package.json` (pinned version,
≥7 days old) and add `--external:@google-cloud/kms` to the esbuild build line.

### 3. `rhApi` function — `rh-agent-mcp/cloud-api/rh-api.ts`

`onRequest({ region: 'us-central1', timeoutSeconds: 120, memory: '512MiB', minInstances: 1, concurrency: 8 })`.

**Shared dispatch:** extract the route table + handlers from
`local-api/robinhood-observation-api.ts` into a shared module
(`rh-agent-mcp/api-shared/routes.ts`) taking `{ repository, reauthMode }`.
`onRequest` req/res are Express objects (http-compatible) — `readBody` /
`sendJson` work unchanged.

- `GET /api/rh/tools` → `listObservationTools()`
- `POST /api/rh/tools/:name` → `executeObservationTool(name, args, …, { repository })`
- `POST /api/rh/batch` → `{ calls: [{ tool, args }] }`, cap 20 calls, sequential
  execution over ONE session — see session cache below
- `POST /api/rh/auth/reauth` → `200 { success: false, state: 'REAUTHORIZATION_REQUIRED', message: 'Run local OAuth bootstrap + upload-rh-credential' }` — never invokes interactive OAuth.

**AuthZ middleware** (runs before any route): `Authorization: Bearer <idToken>`
→ `getAuth().verifyIdToken` → `uid === process.env.RH_OWNER_UID` else 401/403.
Same JSON error envelope as existing routes.

**Audit:** `logger.info('rh_api_call', { tool, category, outcome })` — never
args or payloads.

### 4. Session cache — `rh-agent-mcp/cloud-api/rh-session-cache.ts`

Module-scope `{ connection, accessToken }` singleton:

- `getSession(repository)`: reuse if cached AND the repository's current access
  token matches the cached one (refresh → rebuild); else connect fresh.
- `callTool` wrapper: on `McpSessionNotConnectedError` / auth-category failure →
  close, refresh via `connectLocalRobinhoodMcpSession`, reconnect, retry once.
- Concurrent `callTool` on one MCP `Client` — verify SDK multiplexes over
  StreamableHTTP (JSON-RPC ids); if not, serialize through an in-instance
  promise queue. Covered by a test with a fake transport.

### 5. Upload script — `functions/scripts/upload-rh-credential.ts`

`npx tsx scripts/upload-rh-credential.ts <bundle-path>` — loads portable bundle
(from `export-credential-bundle.ts`), constructs `KmsFirestoreCredentialRepository`
against prod (ADC), `store()` initial revision `null → 1`. Prints structural
evidence only (revision, schemaVersion) — never token values.

### 6. Provisioning + wiring (CONFIG)

- KMS: `gcloud kms keyrings create rh-agent --location us-central1`; `keys create credentials`; IAM `roles/cloudkms.cryptoKeyEncrypterDecrypter` to the functions service account on that key.
- `RH_OWNER_UID` env var on the function (owner's Firebase UID).
- `firestore.rules`: explicit deny block `match /rh-agent-credentials/{doc}` (default-deny already covers; explicit block documents intent).
- `firebase.json` hosting: `"rewrites": [{ "source": "/api/rh/**", "function": { "functionId": "rhApi", "region": "us-central1" } }]`.
- Export `rhApi` from `functions/src/index.ts`.

## Ordering / dependency

```text
repo+cipher ──► upload script ──► seed creds ─┐
KMS+env+rules ─┘                              ├─► rhApi ──► session cache ──► batch
                                              └─► hosting rewrite + deploy + smoke
```

Hosting rewrite can deploy as soon as `rhApi` exists (functional API); session
cache + batch ship as follow-on deploys.

## Verification

`npm run test:rh-agent-mcp-api` extended + new specs:
`rh-agent-mcp-kms-repository.test.ts`, `rh-agent-mcp-cloud-api.test.ts`,
`rh-agent-mcp-session-cache.test.ts`, `rh-agent-mcp-batch.test.ts` —
all `tsx --test` under `tests/functions/` with fake transport/repository/KMS.
