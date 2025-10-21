# How to use rel-str emulators to call PROD SavantAPI endpoints

This guide explains, in plain English, how to run our local emulators and successfully call the partner (SavantAPI) HTTPS endpoints that live in PROD, using Google-issued ID tokens. You’ll do this without any JSON keys by temporarily “acting as” a specific service account (SA) via impersonation.

## Quickstart (copy/paste in a PowerShell window)
```powershell
# 0) One-time (per machine/user): login ADC if you haven't already
#    This opens a browser and persists credentials
# gcloud auth application-default login

# 1) Environment for this terminal session (used by Functions emulator)
$env:GOOGLE_IMPERSONATE_SERVICE_ACCOUNT = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"
$env:PARTNER_AUDIENCE            = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"
$env:PARTNER_TRACKED_SYMBOLS_URL = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2"
$env:PARTNER_TS_URL              = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2"
# Optional: explicitly set the caller SA (defaults to prod caller SA anyway)
# $env:PARTNER_CALLER_SA = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"

# 2) Start Firebase emulators (keep this running)
npm run emulators:start
```
Open a new PowerShell window to verify endpoints while emulators run:
```powershell
# Diagnostic HTTP function (time series)
curl.exe "http://127.0.0.1:5002/rel-str/us-central1/partnerProxyTest?symbol=AAPL&interval=DAILY&range=1y"

# Callable: tracked symbols
a=$("http://127.0.0.1:5002/rel-str/us-central1/getTrackedSymbols")
b=@{ data = @{ ttlSeconds = 600 } } | ConvertTo-Json
Invoke-RestMethod -Uri $a -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $b | ConvertTo-Json -Depth 5
```

## What you’re doing (in plain English)
- You start Firebase emulators locally so the app and functions run on your machine.
- When our local function needs to call the partner’s PROD endpoint, it must prove “who it is.”
- We prove identity by minting a short‑lived Google ID token for a specific service account (the partner has this SA whitelisted) and for a specific audience (the exact partner function URL).
- We attach that token as `Authorization: Bearer <token>` to the partner HTTP request.
- The partner validates the token (issuer, audience, signature, and email), and if it trusts the SA, it returns data.

## Why impersonation (no JSON keys)?
- Safer: no local key files to leak.
- Simple: you login once with gcloud and set one environment variable so your local runtime mints tokens “as” the caller SA.
- Reversible: remove the IAM role or unset the env var and impersonation stops working.

## TL;DR
1) Make sure your user can impersonate the caller SA (one‑time IAM grant).
2) `gcloud auth application-default login` (one‑time per machine/user).
3) In the terminal where you start the emulators, set (see actual commands below):
   - `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`
   - `PARTNER_*` URLs (audiences)
4) `npm run emulators:start`
5) Call our local function endpoints, which now attach a valid Google ID token (including email) to partner calls.

### How to verify the impersonation grant
- Using gcloud policy binding output (the SA policy should include your user with `roles/iam.serviceAccountTokenCreator`):
  ```powershell
  gcloud iam service-accounts get-iam-policy \
    rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com \
    --project=rel-str --format=json
  ```
  Look for a binding like:
  ```json
  {
    "role": "roles/iam.serviceAccountTokenCreator",
    "members": ["user:your.name@your-domain.com", ...]
  }
  ```
- By minting a token with impersonation and inspecting claims:
  ```powershell
  $sa  = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"
  $aud = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2'
  $token = (gcloud auth print-identity-token --impersonate-service-account $sa --audiences $aud --include-email).Trim()

  function Decode-Base64Url([string]$s) {
    $remainder = $s.Length % 4
    if ($remainder -gt 0) { $s += ('=' * (4 - $remainder)) }
    $s = $s.Replace('-', '+').Replace('_', '/')
    [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($s))
  }
  $parts = $token.Split('.')
  $body  = Decode-Base64Url $parts[1] | ConvertFrom-Json
  $body.email  # should be rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com
  $body.aud    # should equal the exact function URL above
  ```

## Overview
- We are the consumer of SavantAPI. We call partner HTTPS functions using Google OIDC ID tokens.
- Locally, we use Google ADC + SA impersonation (no JSON keys) to mint ID tokens.
- Our Functions emulator uses IAM Credentials `generateIdToken` with `includeEmail=true` so the partner receives the SA email in the token.

## Prerequisites
- gcloud CLI installed and logged in.
- Your user has the IAM role `roles/iam.serviceAccountTokenCreator` on the caller SA:
  - `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com` (or a dev SA if you choose to use one).

Grant example:
```powershell
# Replace with your user email if needed
gcloud iam service-accounts add-iam-policy-binding \
  rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com \
  --member="user:YOUR_USER_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=rel-str
```

## Environment variables (local terminal session)
Set these in the PowerShell window where you will start the emulators:
```powershell
# Use prod caller SA via impersonation (keyless)
$env:GOOGLE_IMPERSONATE_SERVICE_ACCOUNT = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"

# Partner endpoints / audience
$env:PARTNER_AUDIENCE            = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net"
$env:PARTNER_TRACKED_SYMBOLS_URL = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2"
$env:PARTNER_TS_URL              = "https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerTimeSeriesV2"

# Optional override for runtime SA (defaults to the prod caller SA above)
$env:PARTNER_CALLER_SA = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"
```

## Start emulators
```powershell
npm run emulators:start
```
Expected ports (from our Angular config):
- Firestore Emulator: `127.0.0.1:8088`
- Functions Emulator: `127.0.0.1:5002`
- Emulator UI: `127.0.0.1:4010`

## Verify partner calls directly (manual)
Mint a token with email, build a URL safely, and call with PowerShell:
```powershell
$sa  = "rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com"
$aud = 'https://us-central1-alpha-vantage-proxy-api.cloudfunctions.net/partnerListTrackedSymbolsV2'

# Mint ID token with email claim
$token = (gcloud auth print-identity-token \
  --impersonate-service-account $sa \
  --audiences $aud \
  --include-email).Trim()

# Build URL safely
Add-Type -AssemblyName System.Web
$ub = [System.UriBuilder]::new($aud)
$qs = [System.Web.HttpUtility]::ParseQueryString("")
$qs["activeOnly"] = "true"
$qs["limit"]      = "1"
$ub.Query = $qs.ToString()

# Call using Invoke-RestMethod (avoids IE engine)
$headers = @{ Authorization = "Bearer $token" }
$result  = Invoke-RestMethod -Uri $ub.Uri -Headers $headers -Method GET
$result | ConvertTo-Json -Depth 5
```
You should receive a JSON payload. If you get `403 Invalid or unauthorized Google ID token`, check Troubleshooting below.

## Verify via local Functions
Diagnostic HTTP function (time series):
```powershell
curl.exe "http://127.0.0.1:5002/rel-str/us-central1/partnerProxyTest?symbol=AAPL&interval=DAILY&range=1y"
```
Callable for tracked symbols:
```powershell
$uri  = "http://127.0.0.1:5002/rel-str/us-central1/getTrackedSymbols"
$body = @{ data = @{ ttlSeconds = 600 } } | ConvertTo-Json
$result = Invoke-RestMethod -Uri $uri -Method POST -Headers @{ "Content-Type" = "application/json" } -Body $body
$result | ConvertTo-Json -Depth 5
```

## How our code mints tokens (important)
File: `functions/src/partner-proxy.ts`
- We use the IAM Credentials API `generateIdToken` to mint ID tokens with `includeEmail=true`.
- We attach the token as `Authorization: Bearer <token>` to partner requests.
- Audience is the exact partner function URL (e.g., `.../partnerListTrackedSymbolsV2`).
- Caller SA is controlled by `PARTNER_CALLER_SA` (defaults to `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`).
- This works both locally (with impersonation) and in production (runtime SA).

## Angular app emulator config
File: `src/app/app.config.ts`
- Firestore: connects to `127.0.0.1:8088` in local dev.
- Functions: connects to `127.0.0.1:5002` in local dev.
- Port of the Angular dev server (e.g., 4200 or another) does not affect emulator connectivity.

## Production deployment note
- Per our plan, set Functions v2 global options to use the prod caller SA so no keys are needed:
  - `setGlobalOptions({ region: 'us-central1', serviceAccount: 'rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com' })`
- You can override at deploy-time with `PARTNER_CALLER_SA` if needed.

## Troubleshooting
- 403 `Invalid or unauthorized Google ID token`
  - Ensure the token includes `email` claim (use `--include-email` when testing manually). Our Functions already include it.
  - Confirm the audience is the exact function URL (no extra slash):
    - Tracked: `.../partnerListTrackedSymbolsV2`
    - Time series: `.../partnerTimeSeriesV2`
  - Confirm the partner has whitelisted the SA email you’re using.

- “Firebase API called outside injection context” in Angular logs
  - Ensure Firestore observables are created inside Angular’s DI context (we’ve refactored most hot paths; open an issue if it persists).

- Emulator ports mismatch
  - App uses 8088/5002 locally. If you change emulator ports, update `app.config.ts` accordingly.

## Quick reference
- Caller SA: `rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
- Local impersonation env var: `GOOGLE_IMPERSONATE_SERVICE_ACCOUNT`
- Partner URLs: set via `PARTNER_TRACKED_SYMBOLS_URL` and `PARTNER_TS_URL`
- Override SA: `PARTNER_CALLER_SA`
