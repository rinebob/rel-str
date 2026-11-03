**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** OCC Contract String Group Generator  
**Thread Slug:** occ-string-generator  
**Issue:** #1350  
**Thread Parent:** #1325  
**Topic Parent:** #1243  
**Task:** #1336  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-31  
**Last Updated:** 2026-10-31  

# UAT — BE: Availability contracts + availability proxy route

## Scope

#1336 delivers the ST-side seam for SA's deployed
`partnerContractAvailabilityV1` endpoint: the
`callPartnerContractAvailabilityV1` proxy route (OIDC + Bearer +
`fetchWithRetry`, verbatim params, unreshaped response) and the
`queryContractAvailability` Firebase callable that the FE
`ContractAvailabilityService` already calls. No user-facing UI — the
acceptance surface is wire-level behavior and callable error codes.

Authoritative SA contract: `av-proxy-api/docs/partner/options-data/
contract-availability-discovery.md` (deployed 2026-10-31).

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, `functions` deps installed.
- GCP ADC configured + impersonation rights on the ST caller service
  account (same as the catalog-V2 verify scripts; `needsAdc`).
- IPv4-only Node preload for all network commands:
  `$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`
- Functions emulator for the callable seam: `cd functions; npm run serve`
  (esbuild bundle, port `127.0.0.1:5002`). The emulator mints real OIDC
  via the same local impersonation path — the upstream leg is LIVE SA.

## Start instructions

```powershell
cd C:\aa\projects\rel-str\functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"

# A) Route seam vs LIVE SA — scripted, self-verifying
npx tsx ../scripts/verify/options-contract-availability-1336.ts

# B) Callable seam — start emulator in one shell
npm run serve

# then invoke from another shell (project id = firebase project)
$uri = 'http://127.0.0.1:5002/<project>/us-central1/queryContractAvailability'
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' `
  -Body '{"data":{"symbol":"QQQ","strikeGte":500,"strikeLte":505,"strikeStep":1,"type":"call"}}'
```

Callable error payloads arrive as `{ error: { status, message } }`
(firebase-functions callable envelope).

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Live SA route round-trip | Run verify script (A) | 16/16 checks: bounded QQQ list, step/type/expiration sort honored, `truncated`, `corpusDates`, validation rejects, `OPTIONS_NOT_ENABLED` | **PASS** — 16/16 (live, 2026-11-01) |
| 2 | Callable happy path | `queryContractAvailability.run({data})` via tsx — the real onCall handler (emulator workers die env-wide, see Findings) | `ok=true`, `count`>0, entries are QQQ calls in [500,505] step 1, `truncated`/`corpusDates` present | **PASS** — `ok:true count=2000 truncated=true corpusDateCount=1966`, all 2000 entries honor band+step+type |
| 3 | Missing symbol → `invalid-argument` | `.run({data:{symbol:''}})` | `invalid-argument`, message carries `BAD_REQUEST` | **PASS** |
| 4 | Inverted range → `invalid-argument` | `.run({data:{symbol:'QQQ',strikeGte:600,strikeLte:500}})` | `invalid-argument` + `code=BAD_REQUEST` | **PASS** — `partner 400 code=BAD_REQUEST: … strikeGte exceeds strikeLte` |
| 5 | Unknown symbol → `failed-precondition` | `.run({data:{symbol:'ZZZNOTREAL'}})` | `failed-precondition` preserving `OPTIONS_NOT_ENABLED` | **PASS** — `partner 404 code=OPTIONS_NOT_ENABLED` |
| 6 | `expirations` >30 → `invalid-argument` | `.run` with 31 distinct dates | `invalid-argument` + `BAD_REQUEST` (SA-side cap per discovery doc) | **PASS** — SA: `"at most 30 dates are accepted per request"` → `partner 400 code=BAD_REQUEST`. NOTE: first run used 9 unique dates duplicated 31× and SA accepted it — SA dedupes before counting. |
| 7 | Empty successful result | `.run` strike band 99999–99999.5 | `ok=true`, `contracts=[]`, `count=0` | **PASS** — `count=0` |
| 8 | FE drawer e2e (Run → view lines → send) | `npm start`, `/options/chart`, open drawer, Run | count row + view lines + send emits `date,id` | DEFERRED — joint item on QA #1349 (#1339's surface); requires deployed callable |
| 9 | Post-deploy smoke | After `firebase deploy --only functions`, repeat scenario 2 against prod callable | identical shape | **PASS** — deployed via detached-worktree of `bc6f1fd5` (2026-10-31); `us-central1-rel-str.cloudfunctions.net/queryContractAvailability` → `ok:true count=1222 truncated=false corpusDateCount=1966`, all entries in-band (QQQ calls, strikes 500–502) |

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Proxy authenticates OIDC + Bearer, hits live SA | 1 |
| Params serialized verbatim; `expirations[]` comma-joined | 1 |
| Local validation (symbol, inverted ranges) → BAD_REQUEST | 1, 3, 4 |
| Upstream non-200 propagates status + code | 1, 5 |
| `OPTIONS_NOT_ENABLED` preserved for FE | 5 |
| Response unreshaped (`truncated`, `corpusDates`) | 1, 2, 7 |
| Callable name/export matches FE `CallableName` | 2 |
| SA `expirations` ≤30 cap surfaces | 6 |

## Regression smoke

- `npm run test:options-availability` — 15/15 route specs
- `cd functions; npx tsc --noEmit` — clean
- Existing catalog V2 + historical-options routes untouched (diff-scoped);
  full `tests/functions` suite has one unrelated failure in
  `paper-trading/analysis-dataset-writer.test.ts` from concurrent
  uncommitted paper-trading work — not this surface.

## Findings

- **Functions emulator is broken environment-wide (pre-existing, not this
  task).** Every `onCall` function worker spawns and exits ~1s later with
  "killed because it raised an unhandled error" — verified on
  `queryContractAvailability` AND unrelated `stGetStatus`. Likely the
  node24 host vs `nodejs22` runtime mismatch (firebase-tools uses the
  host binary when the requested runtime isn't installed). QA used the
  `CallableFunction.run()` seam instead — the exact same handler code the
  deployed function executes. Worth a `triage`/CHORE: emulator is
  currently useless for any functions QA.
- **SA dedupes `expirations` before enforcing the 30-cap** — 31 submitted
  dates with only 9 unique values passed; 31 distinct dates correctly
  return `BAD_REQUEST`. No action; recorded for FE-drawer behavior.
