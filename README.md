# RelStr

This project was generated with [Angular CLI](https://github.com/angular/angular-cli) version 17.3.4.

## Development server

Run `ng serve` for a dev server. Navigate to `http://localhost:4200/`. The application will automatically reload if you change any of the source files.

## Code scaffolding

Run `ng generate component component-name` to generate a new component. You can also use `ng generate directive|pipe|service|class|guard|interface|enum|module`.

## Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Running unit tests

Run `ng test` to execute the unit tests via [Karma](https://karma-runner.github.io).

## Running end-to-end tests

Run `ng e2e` to execute the end-to-end tests via a platform of your choice. To use this command, you need to first add a package that implements end-to-end testing capabilities.

## Further help

To get more help on the Angular CLI use `ng help` or go check out the [Angular CLI Overview and Command Reference](https://angular.io/cli) page.

## Syncfusion Licensing and Firebase App Hosting Secrets

This project uses Syncfusion components and registers a license key at runtime. The license key is sourced differently for local development and for deployed builds.

### Local development

- Create/update a file at the project root: `.env.rel-str`
- Add your license key:

```
SYNC_FUSION_LICENSE_KEY=YOUR_LICENSE_KEY
```

- Generate the license file and start the dev server:

```
npm run prebuild
npx ng serve
```

- What the prebuild does:
  - `scripts/gen-syncfusion-license.js` loads `.env.rel-str` and writes `src/secrets/syncfusion-license.ts` containing `export const SYNC_FUSION_LICENSE_KEY = '...'`.
  - `src/app/app.config.ts` imports `SYNC_FUSION_LICENSE_KEY` and calls `registerLicense(SYNC_FUSION_LICENSE_KEY)` before bootstrapping providers.

- Tip: You can chain generation into start (optional):

```
"start": "node scripts/gen-syncfusion-license.js && ng serve"
```

### Deployed environment (Firebase App Hosting)

- `apphosting.yaml` maps an env var to a Secret Manager secret:

```
env:
  - variable: SYNC_FUSION_LICENSE_KEY
    secret: SYNC_FUSION_LICENSE_KEY
```

- App Hosting injects the env var during build. The `prebuild` script runs and generates `src/secrets/syncfusion-license.ts` from that env var.

- Deploy happens on push (CI). To force a redeploy after rotating secrets, make an empty commit and push:

```
git commit --allow-empty -m "chore(apphosting): trigger deploy after secret rotation"
git push
```

### Rotating the secret (Firebase CLI + gcloud)

- Set/update the secret value (interactive):

```
firebase apphosting:secrets:set SYNC_FUSION_LICENSE_KEY --project <project-id>
```

- Non-interactive:

```
firebase apphosting:secrets:set SYNC_FUSION_LICENSE_KEY --value "NEW_KEY" --project <project-id>
```

- Access/verify the latest value:

```
firebase apphosting:secrets:access SYNC_FUSION_LICENSE_KEY --project <project-id>
```

- Listing secrets is not currently supported by `firebase apphosting:secrets:list`. Use `gcloud` instead:

```
gcloud secrets list --project <project-id>
gcloud secrets describe SYNC_FUSION_LICENSE_KEY --project <project-id>
gcloud secrets versions list --secret=SYNC_FUSION_LICENSE_KEY --project <project-id>
```

### Troubleshooting

- Banner still appears locally:
  - Ensure the filename is exactly `.env.rel-str` at the repo root.
  - Re-generate the license file: `npm run prebuild`.
  - If needed, delete `src/secrets/syncfusion-license.ts` and re-run prebuild.
  - Restart the dev server after generation: `npx ng serve`.

- Banner still appears after deploy:
  - Confirm the secret has a non-empty value via `firebase apphosting:secrets:access ...`.
  - Ensure `apphosting.yaml` contains the mapping shown above and is committed.
  - Check build logs to ensure the `prebuild` step ran.
  - Verify that `src/app/app.config.ts` calls `registerLicense(SYNC_FUSION_LICENSE_KEY)`.

- Security notes:
  - Do not commit `src/secrets/syncfusion-license.ts` to version control (it is generated).
  - Keep the license in Secret Manager for production; use `.env.rel-str` for local only.

## Local Partner Integration (OIDC)
To run the rel-str emulators and call PROD SavantAPI endpoints using Google OIDC tokens (via service account impersonation), see the step-by-step guide with a Quickstart block:

- docs/partner/guide-rs-emulators-call-savantapi-prod.md

The guide covers:
- Required IAM permission (roles/iam.serviceAccountTokenCreator)
- Environment variables for the emulator session
- Starting emulators and verifying endpoints
- How our Functions mint ID tokens with the email claim via IAM Credentials

## Prod Backfill (pairs-data archive) — 2019 to Today

Use the admin HTTP endpoint `recomputeRegisteredBackfill` to recompute and write RS POST history for all registered pairs. This writes both the unified `pairs-data/{PAIR}` mirror and yearly archive shards `pairs-data/{PAIR}/archive-YYYY/{YYMMDD}`.

- Endpoint: `https://us-central1-rel-str.cloudfunctions.net/recomputeRegisteredBackfill`
- Auth: Bearer `ADMIN_BACKFILL_TOKEN` (set as a Functions environment variable)
- Recommended strategy: Run per-year chunks with a small delay between pairs to avoid throttling.

Parameters
- `phase`: `post` (historical backfill uses POST-only)
- `from`, `to`: inclusive date range `YYYY-MM-DD`
- `concurrency`: number of pairs processed in parallel (start with 3–5)
- `delayMsBetweenPairs`: millisecond delay between pairs (e.g., 1500–5000ms)
- `missingOnly`: set `true` for a gap-fill pass; otherwise `false` to rebuild

PowerShell (Windows)
```powershell
$BASE_URL = "https://us-central1-rel-str.cloudfunctions.net/recomputeRegisteredBackfill"
$TOKEN    = "local-admin"   # must match the deployed ADMIN_BACKFILL_TOKEN
$HEADERS  = @{ "Authorization" = "Bearer $TOKEN"; "Content-Type" = "application/json" }

$startYear = 2019
$endYear = [int](Get-Date -Format 'yyyy')
foreach ($y in $startYear..$endYear) {
  $from = "{0}-01-01" -f $y
  $to = if ($y -eq $endYear) { (Get-Date -Format 'yyyy-MM-dd') } else { "{0}-12-31" -f $y }

  $body = @{
    phase = "post"
    from = $from
    to = $to
    concurrency = 3
    delayMsBetweenPairs = 2000   # 2s delay between pairs
    limit = 5000                 # ignored when from/to provided
    days = 0                     # ignored when from/to provided
    missingOnly = $false
  } | ConvertTo-Json

  Write-Host "Backfill $from .. $to"
  Invoke-RestMethod -Uri $BASE_URL -Method Post -Headers $HEADERS -Body $body
  Start-Sleep -Seconds 5         # brief pause between years
}
```

curl (bash)
```bash
BASE_URL="https://us-central1-rel-str.cloudfunctions.net/recomputeRegisteredBackfill"
HDR_AUTH="Authorization: Bearer local-admin"
HDR_CT="Content-Type: application/json"

for YEAR in 2019 2020 2021 2022 2023 2024 2025; do
  FROM="${YEAR}-01-01"
  TO="${YEAR}-12-31"
  if [ "$YEAR" = "$(date +%Y)" ]; then TO="$(date +%F)"; fi

  DATA=$(cat <<JSON
{
  "phase": "post",
  "from": "$FROM",
  "to": "$TO",
  "concurrency": 3,
  "delayMsBetweenPairs": 2000,
  "limit": 5000,
  "days": 0,
  "missingOnly": false
}
JSON
)
  echo "Backfill $FROM .. $TO"
  curl -sS -X POST "$BASE_URL" -H "$HDR_AUTH" -H "$HDR_CT" -d "$DATA"
  sleep 5
done
```

Notes
- Ensure Functions env var `ADMIN_BACKFILL_TOKEN` is set; calls without the correct bearer token return 401.
- Backfill writes both mirrors and archive shards. FE Archive mode reads from `archive-YYYY` collections.
- If you re-run backfill as a gap-fill, set `missingOnly: true`.
- You can adjust `concurrency` and `delayMsBetweenPairs` to match upstream and Firestore throughput.
