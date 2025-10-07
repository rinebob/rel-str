# RSH Data-Ready Webhook — Partner Integration Guide (SavantAPI)

RSH (Relative Strength Heatmap) is our Firebase/Cloud Run–backed application that computes and serves Relative Strength (RS) metrics and related signals to an Angular frontend. In this integration, SavantAPI acts as the upstream data provider for OHLCV and related datasets. When SavantAPI completes a scheduled load (e.g., pre-close or post-close), it notifies RSH via this webhook so RSH can begin RS computation and downstream processing without polling.

This guide explains how SavantAPI should notify the RSH backend when a scheduled data load completes. The webhook is server-to-server and secured with Google OIDC ID tokens.

Related spec: `docs/partner/savantapi-data-ready-webhook.md` (payload fields, validation rules, and processing contract).

## At a glance (Prod)

- Audience (aud): https://us-central1-rel-str.cloudfunctions.net
- Endpoint: https://us-central1-rel-str.cloudfunctions.net/partner/data-ready
- Allowlisted service account(s): TBD – SavantAPI to provide SA email(s) to be allowlisted per environment

## Endpoint

- Method: `POST`
- URL (prod): `https://us-central1-rel-str.cloudfunctions.net/partner/data-ready`
- Content-Type: `application/json`

Response semantics:
- `202 Accepted` on successful verification and enqueue; processing continues asynchronously.
- `4xx` on auth/validation errors. Do not retry.
- `5xx` on transient errors. Retry with exponential backoff.

## Authentication (Google OIDC ID token)

- Required for all calls. Firebase tokens are not required for this webhook.
- Audience (`aud`): base service URL (no path, no trailing slash), e.g. `https://us-central1-rel-str.cloudfunctions.net`
- Issuer (`iss`): `https://accounts.google.com` (or `accounts.google.com`)
- Email allowlist: calls must originate from a service account email pre-approved by RSH.
  - RSH configures `ALLOWED_SERVICE_ACCOUNT_EMAILS` per environment (comma-separated emails).

IAM on RSH side:
- The Cloud Run service is private. RSH only grants `roles/run.invoker` to the partner service account(s).

## Payload Schema (v1)

See `docs/partner/savantapi-data-ready-webhook.md` for full definitions. Minimal v1:

```json
{
  "version": "v1",
  "runId": "2025-09-11-post",
  "phase": "post",
  "intervals": ["DAILY"],
  "time": 1736726400000,
  "baselinesUpdatedCount": 20,
  "symbolsUpdatedCount": 500,
  "universeVersion": "us-eq-2025-09-11"
}
```

Recommended additional fields (optional in v1): `marketDate`, `tz`, `durationMs`, `phaseWindow`, `datasetManifest`, `env`, `traceId`.

## Idempotency & Retries

- Idempotency key: `runId`. Re-sending the same `runId` is safe; RSH deduplicates.
- Retry policy: on `5xx` only. Use exponential backoff (e.g., a few attempts over ~10–15 minutes).
- Do not retry on `4xx` (fix the request).

## Examples

Replace placeholders:
- `<SA_EMAIL>`: your calling service account email (to be allowlisted by RSH)

### PowerShell (for validation using impersonation)

```powershell
$SA_EMAIL = "<SA_EMAIL>"
$RSH_BASE = "https://us-central1-rel-str.cloudfunctions.net"
$RSH_ENDPOINT = "$RSH_BASE/partner/data-ready"

# Google ID token (aud = base URL)
$ID_TOKEN = (gcloud auth print-identity-token `
  --impersonate-service-account=$SA_EMAIL `
  --audiences=$RSH_BASE).Trim()

# Minimal v1 payload
$Body = @{
  version = "v1"
  runId = "2025-09-11-post"
  phase = "post"
  intervals = @("DAILY")
  time = 1736726400000
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Uri $RSH_ENDPOINT -Method POST `
  -Headers @{ Authorization = "Bearer $ID_TOKEN" } `
  -ContentType 'application/json' `
  -Body $Body
```

### curl (bash)

```bash
SA_EMAIL="<SA_EMAIL>"
RSH_BASE="https://us-central1-rel-str.cloudfunctions.net"
RSH_ENDPOINT="$RSH_BASE/partner/data-ready"

ID_TOKEN=$(gcloud auth print-identity-token \
  --impersonate-service-account="$SA_EMAIL" \
  --audiences="$RSH_BASE")

curl -X POST "$RSH_ENDPOINT" \
  -H "Authorization: Bearer $ID_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version":"v1",
    "runId":"2025-09-11-post",
    "phase":"post",
    "intervals":["DAILY"],
    "time":1736726400000
  }'
```

### Node.js (google-auth-library)

```ts
import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';

async function notifyDataReady() {
  const saAudienceBase = 'https://us-central1-rel-str.cloudfunctions.net'; // base URL for aud
  const endpoint = saAudienceBase + '/partner/data-ready';

  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
  const client = await auth.getIdTokenClient(saAudienceBase);

  const body = {
    version: 'v1',
    runId: '2025-09-11-post',
    phase: 'post',
    intervals: ['DAILY'],
    time: 1736726400000
  };

  const resp = await client.request({
    url: endpoint,
    method: 'POST',
    data: body,
    headers: { 'Content-Type': 'application/json' }
  });

  console.log(resp.status, resp.data);
}

notifyDataReady().catch(console.error);
```

## Environments

- Use distinct service accounts per environment, if desired (staging vs prod).
- RSH maintains an email allowlist per environment via `ALLOWED_SERVICE_ACCOUNT_EMAILS`.
- Use the correct base URL (audience) and endpoint per environment.

## Troubleshooting

- `401/403`:
  - Ensure you send an ID token (not access token) in `Authorization: Bearer <id_token>`.
  - `aud` must equal the base service URL (no path). Token issuer should be Google.
  - Confirm your service account email is allowlisted on RSH.
  - Cloud Run must grant `roles/run.invoker` to your SA on the RSH service (RSH will configure this).
- `400`:
  - Validate against the v1 schema. Ensure required fields are present and correctly typed.
- `5xx`:
  - Retry with backoff.

## Contact

Please share the service account email(s) you will use per environment so we can allowlist them and grant `run.invoker` on the RSH service. Provide the expected schedule for pre/post runs so we can monitor end-to-end.
