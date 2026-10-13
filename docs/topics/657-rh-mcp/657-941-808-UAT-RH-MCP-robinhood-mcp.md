**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #941  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #808  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-09  
**Last Updated:** 2026-10-09  

# UAT — BE: MCP session cache + concurrency/minInstances (#808)

## Scope

Warm MCP session reuse on the cloud `rhApi` function: one cached
connection per instance, reconnect-once on session failure, token-rotation
invalidation, wedged-transport liveness repair, and `minInstances: 1` /
`concurrency: 8` so requests skip the per-request MCP connect.

## Prerequisites

- `firebase deploy --only functions:rhApi` run from a tree containing the
  #808 changes (deployed 2026-10-09).
- `gcloud` authenticated to project `rel-str`.
- For the owner-path check: a Firebase ID token for `RH_OWNER_UID` —
  `npx tsx .devin/tmp/mint-rh-id-token.ts` prints one (needs ADC + reads
  `functions/.env`). Never paste tokens into docs/issues.

## Scenarios

### 1. Deployed config — PASS

Steps: `npx tsx functions/scripts/verify/rh-mcp-session-cache-808.ts`
(from `functions/`).
Expected: `minInstanceCount=1`, `maxInstanceRequestConcurrency=8`.
Evidence: PASS — `minInstanceCount=1`, `maxInstanceRequestConcurrency=8`
(gcloud functions describe, post-deploy).

### 2. Auth gate — PASS

Steps: same script, unauth POST to `/api/rh/tools/get_accounts`.
Expected: 401.
Evidence: PASS — status 401.

### 3. Warm-session latency — PASS

Steps: same script with `--token <idToken>` — 3 sequential authenticated
`get_accounts` calls.
Expected: call 1 pays connect; calls 2+ reuse the session and are
materially faster.
Evidence: PASS — `1793ms → 439ms → 379ms`; ~1.3s connect cost skipped per
warm request.

### 4. Reuse observable in logs — PASS

Steps:
`gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=rhapi AND jsonPayload.message:\"rh_mcp_session\"" --limit 10 --freshness=15m`
after scenario 3.
Expected: one `connect` event with `reason=cold`; none for calls 2–3.
Evidence: PASS — single `rh_mcp_session;reason=cold;type=connect` entry at
2026-10-10T01:06:01Z, no further connect events for the warm calls.

### 5. Token-rotation invalidation — DEFERRED (self-evidencing)

Cannot be exercised without a real token change. Covered by unit test
(`token rotation invalidates the cached session` — rebuild on
`accessToken` mismatch + subsequent reuse). First natural Robinhood
refresh will log `rh_mcp_session reason=token_mismatch`; spot-check Cloud
Logging on the next rotation, or after a credential re-upload.

### 6. Failure recovery semantics — covered by unit suite

Reconnect-once bound, concurrent-recover single-flight, wedged-session
rotation after 3 timeouts, hung-connect unwedge, McpError-no-teardown —
all proven deterministically in
`tests/functions/rh-agent-mcp-session-cache.test.ts` (11/11). Prod-side
evidence: none expected unless a real session failure occurs; a genuine
`recover` event in `rh_mcp_session` logs would confirm the path end-to-end.

### 7. Batch path through the cache — PASS (API level)

Steps: 3× `POST /api/rh/batch` with `{calls:[{tool:'get_accounts'}]}` and an
owner token against the deployed function.
Expected: 200s with `success:true`, warm timings, no `sessionFailure` key
on the wire.
Evidence: PASS — `588ms → 469ms → 394ms`, all `success=true`,
`sessionFailureOnWire=false` (internal marker stripped at the route
boundary).

### 8. Portfolio page smoke — USER CHECK

Steps: sign in to savanttrader.com → Portfolio page → devtools Network.
Expected: `get_accounts` + `/api/rh/batch` calls return 200, sections
populate, repeat loads faster than pre-cache. (Same wire shape as the
verified #813/#809 smoke — #808 only removes the per-request connect.)
Result: PASS — user-confirmed 2026-10-09 (page loads, sections populate).

## Traceability

| AC | Scenario |
|---|---|
| sequential requests reuse one connection (tests + logs) | 3, 4 |
| auth/session failure → exactly one reconnect + retry | 6 (unit), 5* |
| token change invalidates cached session | 5 |
| concurrency verified + documented; minInstances/concurrency | 1, 6 (unit multiplex test) |

## Regression smoke

- Single-tool `POST /api/rh/tools/:name` path still works (scenario 3 uses it).
- Batch `POST /api/rh/batch` rides the same cache — exercised by the
  portfolio page smoke (scenario 7).
- Local observation API (`npm start` dev loopback) unchanged —
  connect-per-call path, no cache wired.
