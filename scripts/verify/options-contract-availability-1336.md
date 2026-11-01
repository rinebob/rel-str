# Verify Guide — options-contract-availability-1336

Task: #1336 — BE: Availability contracts + availability proxy route
Pipeline stage: callable → proxy → OIDC → SA `partnerContractAvailabilityV1` → verbatim response

## Script

`options-contract-availability-1336.ts` — calls the real
`callPartnerContractAvailabilityV1` against the live SA endpoint (the same
code path the `queryContractAvailability` callable dispatches to). Covers:

1. **Live query** — QQQ calls, strike 500–520 step 5: `ok:true`, `count ==
   contracts.length`, availability-shaped entries (`contractId`,
   `expiration`, `strike`, `type`, `firstObserved`, `lastObserved`), bounds
   + step + type honored server-side, `truncated` boolean, `corpusDates`
   present when `corpusDateCount` advertised.
2. **Local validation** — missing/blank symbol and all three inverted
   ranges → `PartnerHttpError` status 400 `code:'BAD_REQUEST'`, thrown
   before any IAM/upstream call.
3. **Error propagation** — unknown symbol surfaces SA's own verdict
   (`OPTIONS_NOT_ENABLED` 404) as `PartnerHttpError`, not a 500.

## Usage

```bash
npx tsx scripts/verify/options-contract-availability-1336.ts
```

No arguments. Needs ADC (or `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`) — the
same credential path the deployed function uses; on this machine the
partner OIDC flow already works locally (spread-proxy verify precedent).
`NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` may be
needed for outbound HTTPS on broken-IPv6 networks.

## Pass

Every check prints `OK` and the script exits 0 (16 checks).

## Fail

The offending check prints `FAIL` with the actual value; exit 1.
A live-query failure with `403 audience mismatch` means SA changed the
`aud` convention on their side — the function-URL vs base-host audience
was the fix on 2026-10-31 (`PARTNER_CONTRACT_AVAILABILITY_V1_AUDIENCE`
env var can override without a redeploy).
