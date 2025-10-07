# partnerProxyTest Runbook (Prod)

This document captures the exact steps used to successfully call the deployed HTTPS function `partnerProxyTest` and proxy to the partner Time Series API.

- Function path: `functions/src/partner-proxy.ts`
- Deployed function name: `partnerProxyTest`
- Region: `us-central1`
- Runtime identity: `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
- Upstream audience: `https://partnertimeseriesv2-lsluydmucq-uc.a.run.app`

## Prerequisites

- gcloud CLI installed and authenticated
- Active project set: `rel-str`
  
```powershell
# Verify
gcloud config get-value core/project
# Set if needed
gcloud config set project rel-str
```

## 1) Lock down the function (remove public access)

Ensure the Cloud Run service for the function (`partnerproxytest`) is private.

```powershell
gcloud run services remove-iam-policy-binding partnerproxytest `
  --region=us-central1 `
  --member=allUsers `
  --role=roles/run.invoker `
  --project=rel-str

# Verify
gcloud run services get-iam-policy partnerproxytest `
  --region=us-central1 `
  --project=rel-str
```

Expected: No `allUsers` in `roles/run.invoker`. Keep only trusted identities.

## 2) Allow a trusted caller (for testing)

Grant invoker to a caller identity you will use to test, e.g. your Google user or a service account.

```powershell
# Example: allow the current user (for manual tests)
gcloud run services add-iam-policy-binding partnerproxytest `
  --region=us-central1 `
  --member="user:rinebob111185@gmail.com" `
  --role=roles/run.invoker `
  --project=rel-str

# The function itself runs as this SA (already configured in code)
# serviceAccount: rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com
```

Optional: If you want to simulate a service account caller via impersonation, your user must have `roles/iam.serviceAccountTokenCreator` on that SA:

```powershell
gcloud iam service-accounts add-iam-policy-binding `
  rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com `
  --member="user:rinebob111185@gmail.com" `
  --role="roles/iam.serviceAccountTokenCreator" `
  --project=rel-str
```

## 3) Mint an ID token and call the function (PowerShell)

Audience must be the function URL base (no query string).

```powershell
$aud = "https://us-central1-rel-str.cloudfunctions.net/partnerProxyTest"
$sa  = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"

# Mint Google ID token by impersonating the function SA (recommended for backend-to-backend simulation)
$token = (gcloud auth print-identity-token --impersonate-service-account=$sa --audiences=$aud).Trim()

# Verify the token was captured
$token.Substring(0,20) + "..."
$token.Length
```

Call the function (robust method)

Use UriBuilder + HttpUtility to construct the URL. This avoids PowerShell issues with `&` in query strings and quoting.

```powershell
Add-Type -AssemblyName System.Web
$builder = [System.UriBuilder]$aud
$qs = [System.Web.HttpUtility]::ParseQueryString($builder.Query)
$qs["symbol"]   = "AAPL"
$qs["interval"] = "DAILY"
$qs["range"]    = "1y"
$builder.Query   = $qs.ToString()
$uri = $builder.Uri.AbsoluteUri

$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod -Uri $uri -Headers $headers -Method GET | ConvertTo-Json -Depth 10
```

Expected: JSON payload matching the upstream partner response (proxied by the function).

## 4) Upstream auth model (“either” support)

The partner Cloud Run service must accept Google ID tokens for service-to-service calls:

- Google token path: `iss = accounts.google.com`, `aud = https://partnertimeseriesv2-lsluydmucq-uc.a.run.app`
- Cloud Run IAM must grant `roles/run.invoker` to `serviceAccount: rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`.
- If the partner also supports Firebase ID tokens for end-user flows, they must branch verification logic by token type (do not run Firebase Admin verification on Google tokens).

If the upstream still rejects with 403, coordinate with the partner to confirm:

- Correct audience string they expect (Cloud Run base URL or custom domain).
- IAM includes the above service account as invoker.

## 5) Troubleshooting

- Check function IAM
```powershell
gcloud run services get-iam-policy partnerproxytest `
  --region=us-central1 `
  --project=rel-str
```

- Confirm function runtime identity
```powershell
gcloud functions describe partnerProxyTest `
  --gen2 --region=us-central1 --project=rel-str `
  --format="value(serviceConfig.serviceAccountEmail)"
```

- Read recent function logs
```powershell
gcloud functions logs read partnerProxyTest --gen2 --region=us-central1 --project=rel-str --limit=50
```

- Common errors
  - `403` from function: caller is not granted `roles/run.invoker` on `partnerproxytest`, or missing Authorization header.
  - `500` with `Forbidden` body: upstream partner service rejected the Google ID token. Verify partner-side IAM and audience, and that their app-layer supports the Google token path.

## 6) Notes

- For local emulation, the Firebase emulator ignores the `serviceAccount` identity. Use ADC or deploy to validate the service-to-service flow.
- Keep both your function and the partner service private in production. Grant `run.invoker` only to trusted identities and always send `Authorization: Bearer <ID_TOKEN>` when calling.
