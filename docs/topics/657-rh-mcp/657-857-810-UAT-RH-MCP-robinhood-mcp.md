**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #857  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #810  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — production rhApi routing (CORS + absolute URL)

## Scope

Routes the production `/api/rh/**` surface to the deployed `rhApi` function.
Under Firebase App Hosting there is no same-origin rewrite — the FE calls
`https://us-central1-rel-str.cloudfunctions.net/rhApi/api/rh/**` cross-origin
with a Firebase ID token, and `rhApi` answers CORS from the shared
`ST_ALLOWED_ORIGINS` allowlist with a 24h preflight cache.

Superseded AC: `savanttrader.com/api/rh/tools` no longer 404s — intentionally
still 404s; traffic goes to the function URL (pivot recorded on #810).

## Prerequisites

- `rhApi` deployed with the final CORS build (done — post-round-3).
- Node shell with `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`
  (IPv6 hangs surface as fetch/auth failures without it).
- For authed scenarios: an owner ID token (mint via admin SDK `createCustomToken`
  for `RH_OWNER_UID`, exchange via `signInWithCustomToken` — see the #807
  verify script pattern; do not store tokens in docs).

## Scenarios

### 1. Preflight from the production origin

```bash
curl -X OPTIONS https://us-central1-rel-str.cloudfunctions.net/rhApi/api/rh/tools \
  -H 'Origin: https://savanttrader.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type' -i
```
Expected: `204`, `access-control-allow-origin: https://savanttrader.com`,
`access-control-max-age: 86400`.
**Result:** PASS — verified live (all three headers present).

### 2. Allowlist coverage — web.app and hosted.app

Same OPTIONS probe with `Origin: https://rel-str.web.app` and
`Origin: https://rel-str--rel-str.us-central1.hosted.app`.
Expected: 204 + matching ACAO + max-age.
**Result:** PASS — both origins answer 204 + ACAO + max-age 86400.

### 3. Unauthenticated request from an allowed origin

```bash
curl https://us-central1-rel-str.cloudfunctions.net/rhApi/api/rh/tools \
  -H 'Origin: https://savanttrader.com' -i
```
Expected: `401` JSON envelope `{"success":false,"error":"Missing Authorization bearer token"}`
AND `access-control-allow-origin` present (browser surfaces the 401, not a CORS block).
**Result:** PASS — 401 envelope + ACAO.

### 4. Disallowed origin gets no ACAO

Same GET with `Origin: https://evil.example.com`. Expected: 401, NO ACAO header.
**Result:** PASS — no ACAO (request still executes server-side; CORS is not
the auth boundary — owner-token authz is).

### 5. Owner-authenticated cross-origin call

GET `/api/rh/tools` with `Origin: https://savanttrader.com` + `Authorization:
Bearer <owner idToken>`. Expected: 200, `{success:true, tools:[…76]}`, ACAO set.
**Result:** PASS — covered by #807 live verify (owner path → 200, 76 tools);
CORS headers land before auth dispatch (scenario 3 proves ACAO on 401s, so
it is on the 200 path by the same middleware).

### 6. Local dev path unchanged

`environment.ts` `rhApiBaseUrl: '/api/rh'` → `proxy.conf.json` →
`http://127.0.0.1:3456`; local observation API ignores the Authorization
header. Expected: dev flows identical to pre-change behavior.
**Result:** PASS — `environment.ts` and `proxy.conf.json` unchanged in
behavior; FE spec `targets the environment-configured base URL` pins the
`/api/rh` dev value; 6/6 observation-service specs pass.

### 7. Production portfolio page (post-deploy)

After the FE change ships via the GitHub-connected App Hosting pipeline
(requires commit + push to `prod`): log in on savanttrader.com, open the
portfolio page. Expected: real RH data loads; devtools shows calls to
`cloudfunctions.net/rhApi/api/rh/**` with no CORS errors.
**Result:** BLOCKED — pending user commit + push + App Hosting rollout.

### 8. Regression — preflight ordering

A bare OPTIONS on a cold instance must not touch KMS/auth/env (round-3
review fix). In-process evidence: `rhApi CORS layer` test asserts zero inner
handler invocations on preflight.
**Result:** PASS — `16/16` cloud-api tests including the 3 CORS-layer cases.

## Traceability

| Criterion | Scenario |
|---|---|
| Unauth → 401 | 3 |
| Owner authed → 200 tool list | 5 |
| CORS from all app origins | 1, 2 |
| No CORS for foreign origins | 4 |
| Local dev unchanged | 6 |
| Portfolio loads real data in prod | 7 (post-deploy) |
| Preflight doesn't depend on env/KMS | 8 |

## Regression smoke

- Unit/integration: 16/16 `rh-agent-mcp-cloud-api` tests, 6/6 observation
  service specs, functions `typecheck` + build clean.
- Live probes above are the deployment smoke.
