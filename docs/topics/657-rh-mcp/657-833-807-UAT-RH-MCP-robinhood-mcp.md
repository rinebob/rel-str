**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #833  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #807  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# UAT — #807: rhApi onRequest — shared dispatch, owner auth, reauth route

## Scope

The production `/api/rh/**` HTTP surface: a `rhApi` Cloud Function that
authenticates Firebase ID tokens, gates to `RH_OWNER_UID`, dispatches tool
list/execute through the shared route table against the KMS+Firestore
credential repository, and returns a structured reauthorization state.
Acceptance criteria under test:

1. No/bad token → 401; non-owner → 403; owner → allowed.
2. Tools list and tool execution via shared dispatch + cloud repository.
3. Reauth route returns `REAUTHORIZATION_REQUIRED`, never interactive OAuth.
4. Mutation tools pass the same auth path as reads.
5. Route/method tests pass in-process with fakes.

## Prerequisites

- `firebase` CLI logged in, `functions/.env` populated (`RH_OWNER_UID`,
  `RH_CREDENTIAL_KEY_NAME`), application-default credentials present.
- `rhApi` deployed: `https://us-central1-rel-str.cloudfunctions.net/rhApi`.
- To mint test tokens: a `createCustomToken` script run under
  `functions/` (admin SDK with `serviceAccountId:
  rel-str@appspot.gserviceaccount.com`), exchanged at
  `identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken` with
  the web API key from `src/environments/environment.ts`. Any uid works —
  use `RH_OWNER_UID` for the owner case, any other string for non-owner.

## Scenarios

### 1. Unauthenticated gate (no token needed)

```
cd functions && npx tsx scripts/verify/rh-mcp-cloud-api-807.ts
```

Expected: 5 checks PASS — GET /tools, bad-token GET /tools, POST tool,
POST reauth all return 401 with a `{success:false, error}` envelope
before dispatch.

### 2. Owner happy path

```
npx tsx scripts/verify/rh-mcp-cloud-api-807.ts --token <ownerIdToken>
```

Expected: adds — GET /tools → 200 with a non-empty list (76 at time of
writing); POST /api/rh/tools/get_accounts → 200 `{success:true}`;
POST /api/rh/auth/reauth → 200 `{success:false,
state:"REAUTHORIZATION_REQUIRED", message:"Run the local OAuth bootstrap,
then upload-rh-credential..."}`.

### 3. Non-owner rejection

Mint a token for a uid ≠ `RH_OWNER_UID`, then:

```
curl -i https://us-central1-rel-str.cloudfunctions.net/rhApi/api/rh/tools \
  -H "authorization: Bearer <nonOwnerIdToken>"
```

Expected: 403 `{success:false, error:"Forbidden"}` — same on tool POSTs
and reauth (auth runs before dispatch).

### 4. Mutation path authorization

```
curl -i -X POST .../rhApi/api/rh/tools/place_equity_order \
  -H "authorization: Bearer <ownerIdToken>" -d '{}'
```

Expected: 200 with a structured VALIDATION failure envelope — proving the
mutation tool reached the same authenticated executor rather than being
route-rejected. Unauthenticated version of the same call → 401.

### 5. Audit hygiene in function logs

```
gcloud logging read 'resource.type="cloud_run_revision" AND
  resource.labels.service_name="rhapi" AND jsonPayload.message:"rh_api"'
--limit 20 --format json
```

Expected: `rh_api_call` entries carrying only `{tool, category, outcome}`
and `rh_api_auth_reject` entries carrying `{reason[, uid]}` — no token
values, request arguments, or response payloads anywhere.

### 6. Production-site regression check

```
curl -i https://savanttrader.com/api/rh/tools
```

Expected: still 404 — the Hosting rewrite is task #810, deliberately not
part of this task. No regression vs. pre-#807 behavior.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| 401 no/bad token, 403 non-owner, owner allowed | 1, 2, 3 |
| Tools list + execution through shared dispatch + cloud repo | 2 |
| Structured reauth state | 2 |
| Mutation tools same auth path | 4 |
| Route/method tests in-process | npm run test:rh-agent-mcp-cloud-api (12 tests) |
| No secrets in logs | 5 |

## Regression / smoke

- Local observation API still serves `/api/rh/tools` on loopback
  (`rh-agent-mcp-observation-api` suite, 8 tests).
- `savanttrader.com` unauthenticated shell still loads (Hosting untouched).

## Results

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| 1 | Unauth gate | PASS | `rh-mcp-cloud-api-807.ts` (no token): 5/5 — 401 before dispatch on all routes, structured envelope |
| 2 | Owner happy path | PASS | `--token <ownerIdToken>`: GET /tools → 200 (76 tools), POST get_accounts → `success:true`, reauth → `REAUTHORIZATION_REQUIRED` |
| 3 | Non-owner 403 | PASS | `createCustomToken('qa-nonowner-807')` → 403 `{success:false,"error":"Forbidden"}` on GET /tools, POST tool, POST reauth |
| 4 | Mutation auth path | PASS | owner POST place_equity_order `{}` → 200 VALIDATION envelope (reached the executor); unauth POST → 401 |
| 5 | Audit hygiene | PASS | Cloud Logging: `rh_api_call` = `{tool, category, outcome}` only; `rh_api_auth_reject` = `{reason[, uid]}` only — no token/arg/payload material |
| 6 | Site regression | PASS | `savanttrader.com` GET → 200 SPA shell, POST → 404 text/html — unchanged pre-#807 behavior; rewrite is #810 |

Executed 2026-10-06 against the final deployed build (post round-2 review
remediation). In-process suite: 48/48 green incl. 13 cloud-handler tests;
`tsc --noEmit` clean.
