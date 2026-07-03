# How to Backfill `rs-bars`

## Purpose

Manually trigger a full backfill of the `rs-bars/{SYMBOL}` collection for a single symbol or a batch of symbols. The backfill fetches daily, weekly, and monthly OHLCV bars from SavantAPI with `adjusted: true` and writes them to Firestore.

## Location

```text
functions/scripts/trigger-bars-backfill.ts
functions/scripts/run-backfill-batches.ts
functions/scripts/symbols-to-backfill.txt
functions/src/rs-bars/rs-bars-sync.ts
```

Run all commands from the `functions/` directory:

```powershell
cd C:\aa\projects\rel-str\functions
```

## Prerequisites

- Firebase Application Default Credentials (ADC) set up locally.
- `gcloud` CLI logged in with access to the `rel-str` project.
- Your account must have `roles/iam.serviceAccountTokenCreator` on the Compute Engine default service account:
  - `145446780542-compute@developer.gserviceaccount.com`
- The target `rs-bars` collection exists in Firestore.

## One symbol (smoke test)

```powershell
npx tsx scripts/trigger-bars-backfill.ts AAPL
```

## Batch of symbols

1. Save the comma-separated symbol list to `functions/scripts/symbols-to-backfill.txt`.
2. Run the batch runner (default batch size is 50):

```powershell
npx tsx scripts/run-backfill-batches.ts
```

Override batch size or symbol file:

```powershell
$env:BATCH_SIZE="25"
$env:SYMBOL_FILE="scripts/my-symbols.txt"
npx tsx scripts/run-backfill-batches.ts
```

## Authentication

The `rsBarsSyncAdminHttp` function is an `onRequest` HTTPS endpoint. It verifies the bearer token as a service-account ID token with the function URL as the audience.

The script uses gcloud service-account impersonation (no downloaded key required):

```powershell
gcloud auth print-identity-token --audiences="https://us-central1-rel-str.cloudfunctions.net/rsBarsSyncAdminHttp" --impersonate-service-account="145446780542-compute@developer.gserviceaccount.com"
```

If you need to use a different service account, override it:

```powershell
$env:IMPERSONATE_SERVICE_ACCOUNT="your-sa@rel-str.iam.gserviceaccount.com"
```

## Monitoring

Check the task worker logs:

```powershell
gcloud functions logs read rsBarsSyncSymbol --project=rel-str --limit=50
```

Watch for OOM messages. If you see memory errors, the function may need more memory than its current `512MiB` setting.

## UI Button vs. Admin Script

| Function | Type | Best for | Auth |
|----------|------|----------|------|
| `rsBarsSyncAdminHttp` | `onRequest` (raw HTTPS) | Frontend UI button, admin scripts, CI/CD, batch jobs | Firebase Auth ID token or service-account ID token |

### Migration status

The frontend UI button is migrated to `rsBarsSyncAdminHttp`. `RhAgentService.triggerBarsBackfill()` fetches the current user's Firebase Auth ID token and sends a `POST` with `Authorization: Bearer <token>`.

The backend verifies the token with `google-auth-library` using the function URL as the audience. Any valid Google ID token works (Firebase Auth user or service account), so both the UI button and local scripts can use the same endpoint.

If you want to restrict the UI button to admin users, add a custom claim or check the token's `email` in `verifyAdminToken()` before allowing the backfill.

## Troubleshooting

### `IAM_PERMISSION_DENIED` for `iam.serviceAccounts.getAccessToken`

Your user account lacks the `Service Account Token Creator` role on the impersonated service account. Add it:

```powershell
gcloud iam service-accounts add-iam-policy-binding 145446780542-compute@developer.gserviceaccount.com --project=rel-str --member="user:YOUR_EMAIL" --role="roles/iam.serviceAccountTokenCreator"
```

### `Error 401: Unauthenticated`

The function rejected the token. Verify:
- The token is an ID token, not an access token.
- The token audience matches the function URL exactly.
- The function name in the URL matches the deployed function (`rsBarsSyncAdminHttp`).

### Cloud Task worker runs out of memory

Increase `memory` in `rsBarsSyncSymbol` configuration and redeploy:

```typescript
memory: '1GiB',
```

Full backfills load years of daily/weekly/monthly data, so memory needs scale with the backfill window.

## Historical Notes

- The original `rsBarsSyncAdmin` was a callable (`onCall`) function. Local scripts using ADC could not authenticate to it because `onCall` requires Firebase user ID tokens, not ADC access tokens.
- The fix was to add a parallel `onRequest` endpoint (`rsBarsSyncAdminHttp`) that accepts service-account ID tokens via gcloud impersonation.
- The task worker `rsBarsSyncSymbol` was also upgraded from `256MiB` to `512MiB` to handle full backfills without OOM errors.
