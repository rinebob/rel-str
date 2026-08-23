# Scripts README

## gen-syncfusion-license.js

- **Purpose**: Generate a TypeScript file (`src/secrets/syncfusion-license.ts`) that exports the Syncfusion license key so the Angular app can call `registerLicense(...)` without committing the key to Git.
- **Output**: `src/secrets/syncfusion-license.ts` with:
  ```ts
  export const SYNC_FUSION_LICENSE_KEY = '...';
  ```

## How it works
- The script reads the env var **`SYNC_FUSION_LICENSE_KEY`** and writes it to a TS file before the Angular build runs.
- It is wired as a prebuild step in `package.json`:
  ```json
  {
    "scripts": {
      "prebuild": "node scripts/gen-syncfusion-license.js",
      "build": "ng build"
    }
  }
  ```
- The Angular app imports and registers the license in `src/app/app.config.ts`:
  ```ts
  import { registerLicense } from '@syncfusion/ej2-base';
  import { SYNC_FUSION_LICENSE_KEY } from '../secrets/syncfusion-license';
  registerLicense(SYNC_FUSION_LICENSE_KEY);
  ```

## Environment variables and dotenv
- Locally, the script loads environment variables via **dotenv**.
- It looks for env files in this precedence (first match wins):
  1. `.env.rel-str`
  2. `.env.local`
  3. `.env`
- Set your key in one of these files (no quotes):
  ```env
  SYNC_FUSION_LICENSE_KEY=YOUR_REAL_SYNCFUSION_LICENSE
  ```
- Ensure `dotenv` is installed (dev dependency):
  ```bash
  npm i -D dotenv
  ```

### Git hygiene
- `.gitignore` is configured to ignore env files and the generated TS file:
  - `.env`, `.env.*`
  - `src/secrets/syncfusion-license.ts`

## CI / Firebase App Hosting
- App Hosting uses **GCP Secret Manager** under the hood. Add the secret and expose it to builds:
  ```bash
  firebase apphosting:secrets:set SYNC_FUSION_LICENSE_KEY
  # Accept adding to apphosting.yaml when prompted, then commit the file.
  ```
- During App Hosting builds, the env var `SYNC_FUSION_LICENSE_KEY` is injected, so the prebuild script can generate the TS file.

## Troubleshooting
- "SYNC_FUSION_LICENSE_KEY env var is missing."
  - Locally: Ensure an env file exists with the key and matches one of the filenames above, then re-run `npm run build`.
  - CI/App Hosting: Ensure the secret is present and included in `apphosting.yaml`, and that file is committed.
- "Cannot find module '@syncfusion/ej2-base'"
  - Install the dependency: `npm i @syncfusion/ej2-base`.
- Type error importing the key
  - Ensure the generator exports `SYNC_FUSION_LICENSE_KEY` and the Angular import matches.

## Security notes
- This pattern keeps the license key out of Git, but when used in a client-only Angular app, it becomes part of the built JavaScript. This is expected for Syncfusion browser licensing.
- For true secrecy, move licensing to a server/SSR context and never ship the key to the browser.

## seed-partner-events.js

- **Purpose**: Seed the Firestore emulator with example documents under the `partner-events` collection to mimic partner Pub/Sub event history.
- **Current status**: This script is not wired into any npm script and there are no backend listeners that react to `partner-events` to update other docs (e.g., `app/refresh-status`). Running it only creates `partner-events/*` docs in the emulator.

### When to use
- Local testing that specifically needs `partner-events` documents present, or if you later add a function/process that reads from `partner-events`.

### Prerequisites
- Firestore emulator running on `127.0.0.1:8088`.
- Set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8088` before running the script.

### Usage examples
Windows PowerShell:
```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8088'; node scripts/seed-partner-events.js
```
Windows CMD:
```cmd
set FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 && node scripts/seed-partner-events.js
```

### Optional npm script wiring
Add to the root `package.json` if you want a shortcut:
```json
{
  "scripts": {
    "seed:partner-events": "set FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 && node scripts/seed-partner-events.js"
  }
}
```

### Notes
- Emulator data persists across runs if you export on exit or use `emulators:export` per the project setup. Otherwise, re-run the seeder as needed.

## verify-sds.js

- **Purpose**: Verify the SDS (symbolDataSync) PDR-triggered pipeline end-to-end against prod. Publishes a crafted PDR message to the `partner-data-ready` topic, then polls Firestore for the expected run doc, sequence doc, and symbol-data writes.

### Prerequisites
- `gcloud auth login` and `gcloud config set project rel-str`
- SDS functions deployed (`symbolDataSync`, `symbolDataSyncWorker`)
- `firebase-admin` installed in `functions/` (for Firestore verification polling)

### Usage examples

POST A DAILY (full universe minus excludeSymbols):
```bash
node scripts/verify-sds.js --phase post --sequence A --interval DAILY --exclude AAPL
```

POST B DAILY (only includeSymbols):
```bash
node scripts/verify-sds.js --phase post --sequence B --interval DAILY --symbols AAPL,MSFT
```

Intraday PRE (bulk snapshot):
```bash
node scripts/verify-sds.js --phase pre
```

Dry run (print message without publishing):
```bash
node scripts/verify-sds.js --phase post --sequence A --interval DAILY --dry-run
```

### Options
| Flag | Default | Description |
|---|---|---|
| `--phase` | `post` | PDR phase (`post` or `pre`) |
| `--sequence` | `A` | POST sequence (`A`, `B`, `C`) |
| `--interval` | `DAILY` | POST interval (`DAILY`, `WEEKLY`, `MONTHLY`) |
| `--symbols` | `AAPL` | Comma-separated symbols for `includeSymbols` (B/C) |
| `--exclude` | (empty) | Comma-separated symbols for `excludeSymbols` (A) |
| `--market-date` | today ET | Override marketDate |
| `--wait-seconds` | `120` | Max seconds to poll for results |
| `--dry-run` | false | Print message without publishing |

## verify-sds-completion.js

- **Purpose**: Verify the SDS completion pipeline (Task #167) — per-interval completion, sequence fan-in, downstream consumer dispatch, and watchdog. Creates test run/sequence docs in Firestore with completed status and verifies the watchdog picks them up and fires sequence completion.

### Prerequisites
- `gcloud auth login` and `gcloud config set project rel-str`
- SDS functions deployed (`sdsWatchdog`, `sdsConsumerDispatch`)

### Usage examples

Verify sequence completion for POST A with all 3 intervals:
```bash
node scripts/verify-sds-completion.js --phase post --sequence A --intervals DAILY,WEEKLY,MONTHLY
```

Verify watchdog is running:
```bash
node scripts/verify-sds-completion.js --watchdog
```

### Options
| Flag | Default | Description |
|---|---|---|
| `--phase` | `post` | PDR phase |
| `--sequence` | `A` | POST sequence (`A`, `B`, `C`) |
| `--intervals` | `DAILY,WEEKLY,MONTHLY` | Comma-separated intervals to complete |
| `--watchdog` | false | Run watchdog verification only |
| `--symbols` | `AAPL,MSFT` | Comma-separated symbols to simulate |
| `--marketDate` | today PT | Override market date |
