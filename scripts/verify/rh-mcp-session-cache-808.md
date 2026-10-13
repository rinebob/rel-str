# Verify — #808 rhApi session cache + minInstances

Verifies the deployed `rhApi` warm-session behavior end-to-end: function
config (`minInstances`, `concurrency`), the auth gate, and warm-session
latency on sequential authenticated calls.

Unit coverage (the authoritative reuse proof) lives in
`tests/functions/rh-agent-mcp-session-cache.test.ts` — sequential requests
assert `transportCount === 1`, dead sessions reconnect once, token rotation
rebuilds, and concurrent `callTool` multiplexes over one transport.

## Script

`functions/scripts/verify/rh-mcp-session-cache-808.ts` (run from `functions/`)

## Prerequisites

- `rhApi` deployed with the #808 config: `firebase deploy --only functions`
- `gcloud` CLI authenticated for project `rel-str` (config check only)
- For the authenticated half: a Firebase ID token for the `RH_OWNER_UID`
  account — `await getAuth().currentUser.getIdToken()` in the app console.

## Usage

```powershell
cd functions
# Config + auth-gate checks only (no token needed)
npx tsx scripts/verify/rh-mcp-session-cache-808.ts

# Full path — adds three timed sequential get_accounts calls
npx tsx scripts/verify/rh-mcp-session-cache-808.ts --token <idToken>
```

## Pass criteria

- `gcloud functions describe rhApi` reports `minInstanceCount >= 1` and
  `maxInstanceRequestConcurrency === 8` — FAILS until #808 is deployed.
- `POST /api/rh/tools/get_accounts` without a token returns 401.
- With `--token`: three sequential calls each return `200` +
  `success: true`; timings print so the warm-path is visible.

## Observing reuse in prod

Cloud Logging on the `rhApi` function — filter `jsonPayload.type="connect"`.
One `rh_mcp_session { type: "connect", reason }` per instance warm-up or
rotation (`cold` | `token_mismatch` | `recover`), NOT per request. If every
request logs a connect, the cache is not engaged.

## Failures

- `minInstanceCount=0` — function not redeployed since #808; run
  `firebase deploy --only functions`.
- 401 on authed calls — expired ID token; re-mint.
- `success: false` on authed calls — credential/repo problem; see the #807
  guide and the #811 runbook.
