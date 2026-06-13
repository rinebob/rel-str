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
