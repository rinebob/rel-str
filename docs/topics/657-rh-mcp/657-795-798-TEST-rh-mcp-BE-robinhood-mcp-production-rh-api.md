**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #798  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Domain:** RH-MCP  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# TEST — BE: Production RH API

## E2E User Journeys (manual, prod)

- Sign in on savanttrader.com → portfolio dashboard loads live accounts/positions/orders; zero 404s on `/api/rh/**`.
- Observation dashboard lists all tools; `get_accounts` executes and returns redacted account data.
- Order ticket: review + place a real (tiny) order, then cancel it — round-trips through `place_equity_order`/`cancel_equity_order`.
- Signed-out curl to `/api/rh/tools` → 401; signed-in non-owner (if a second account exists) → 403.

## Integration Tests (`tsx --test`, `tests/functions/`)

- `rhApi` route dispatch end-to-end: fake transport + fake repository + fake auth — list tools, execute tool, batch, reauth state.
- Session cache: connect once → two `callTool`s reuse the same session; auth failure → refresh + reconnect + retry once; token change → rebuild.
- Repository + refresh composition: `RepositoryOAuthProvider.saveTokens` → `store(expected)` CAS path through the real refresh code with fake KMS/Firestore.

## Unit Tests

- `KmsFirestoreCredentialRepository`: load missing → null; round-trip; `store` CAS aborts on revision mismatch; concurrent stores — loser reloads winner's revision; ciphertext never equals plaintext bundle.
- `KmsCipher`: key-name plumbing + error mapping (fake KMS client).
- Auth middleware: no header → 401; bad token → 401; wrong uid → 403; owner uid → pass.
- `handleExecuteTool` shared module: unknown tool → validation error; invalid JSON → 400; toolName/path mismatch → 400.
- Batch: empty calls → 400; >20 calls → 400; per-call errors isolated (one failure doesn't abort the batch); sequential ordering on one session.

## Test Seams

- Highest: in-process HTTP request against the `rhApi` request handler (same pattern as `rh-agent-mcp-observation-api.test.ts` — real server, fake transport/repository).
- Lower: repository unit tests with fake Firestore txn + fake cipher; session cache with fake transport factory.

## Existing Coverage

- `executeObservationTool`, `listObservationTools`, redaction, schema validation — already covered by `test:rh-agent-mcp-tools` / `test:rh-agent-mcp-api`; reused, not re-tested.
- `connectLocalRobinhoodMcpSession` + refresh policy — covered by `test:rh-agent-mcp-refresh`.

## Edge Cases

- Missing/empty credential doc → structured `REAUTHORIZATION_REQUIRED`.
- `invalid_grant` on refresh → reauth state, not a 500.
- KMS decrypt permission error → 500 with safe message, no ciphertext in logs.
- Request body > 1 MB → 413 (existing `readBody` limit).
- Stale MCP session id after warm idle → transparent reconnect once.
- Batch partially failing → per-item `{success:false}` entries, HTTP 200 envelope.
- No secrets/token values in any log line or error body.
