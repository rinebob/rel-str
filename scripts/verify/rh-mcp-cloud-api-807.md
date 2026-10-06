# Verify — #807 rhApi cloud function

Verifies the deployed `rhApi` onRequest function (`rh-agent-mcp/cloud-api/rh-api.ts`)
end-to-end against production: auth gate, shared route dispatch, KMS+Firestore
credential path, and the structured reauth response.

## Script

`functions/scripts/verify/rh-mcp-cloud-api-807.ts`

## Prerequisites

- `rhApi` deployed: `firebase deploy --only functions:rhApi`
- Function URL defaults to `https://us-central1-rel-str.cloudfunctions.net/rhApi`;
  override with `RH_API_URL` (e.g., an emulator).
- Network access from the shell (uses `fetch`, no ADC needed for the
  unauthenticated checks).
- For the authenticated half: a Firebase ID token for the `RH_OWNER_UID`
  account. Mint one in the app (`await getAuth().currentUser.getIdToken()`)
  or programmatically via `createCustomToken` + the
  `signInWithCustomToken` REST exchange (owner ADC required).

## Usage

```powershell
# Unauthenticated gate only — always safe, every check rejects pre-dispatch
cd functions; npx tsx scripts/verify/rh-mcp-cloud-api-807.ts

# Full path — real get_accounts through the live KMS credential repo
cd functions; npx tsx scripts/verify/rh-mcp-cloud-api-807.ts --token <idToken>
```

## Pass / fail

- PASS — all unauth checks return structured `401 { success:false, error }`;
  with `--token`: tools list non-empty, `get_accounts` returns
  `success:true`, reauth returns `state:'REAUTHORIZATION_REQUIRED'`. exit 0.
- FAIL — any check mismatches; prints which check. exit 1.
- exit 2 — bad arguments (`--token` without a value, unknown flags).

## Notes

- POSTs without a token 401 **before** any credential/MCP work — auth runs
  ahead of dispatch.
- The `get_accounts` call exercises the real chain: owner auth → shared
  dispatch → `KmsFirestoreCredentialRepository.load()` (Firestore read + KMS
  decrypt) → MCP session → Robinhood → redacted response.
- Gotcha fixed during implementation: Functions Framework pre-parses JSON
  bodies (`req.body`); the stream-based `readBody` hangs forever under
  `onRequest` — the shared handler uses `req.body` when present.
