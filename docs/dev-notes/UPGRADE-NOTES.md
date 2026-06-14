# Upgrade Notes — June 2026

## Git Workflow
- **Single branch: `prod` only.** No more `dev` branch. Commit and `git push` directly on `prod`.
- `git pull` to get latest, `git push` to publish.

## Angular Upgrade (June 13, 2026)

### Versions
| Package | Before | After |
|---|---|---|
| `@angular/core` | 19.2.x | 21.2.x |
| `@angular/cli` | 19.2.x | 21.2.x |
| `@angular/material` | 19.2.x | 20.2.x |
| `@angular/cdk` | 19.2.x | 20.2.x |
| `@angular/fire` | 19.2.0 | 20.0.1 |
| `@ngrx/signals` | 19.2.1 | 21.1.1 |
| `@syncfusion/*` | 29–30.x | 33.x |
| `typescript` | ~5.8.x | ~5.9.x |

### Known Constraints
- **Material/CDK are at v20** (not v21) because `@angular/fire` v20 has peer deps requiring `@angular/core ^20`.
- When `@angular/fire` v21 stable releases, upgrade all at once:
  ```
  ng update @angular/core@22 @angular/material@21 @angular/fire@21
  ```

### `legacy-peer-deps`
- `.npmrc` at project root contains `legacy-peer-deps=true` to handle the `@angular/fire` v20 / Angular 21 peer dep mismatch.
- This applies to both local `npm install` and App Hosting's `npm ci`.

### TypeScript
- Pinned to `~5.9.3` — Angular 21 build tools (`@angular-devkit/build-angular`) require `>=5.9 <6.0`. Do not bump to 6.x until Angular 22 upgrade.

## Syncfusion License Key

### How it works
- The license key is **never committed to git**.
- `src/secrets/` is gitignored entirely.
- The prebuild script `scripts/gen-syncfusion-license.js` generates `src/secrets/syncfusion-license.ts` at build time from the `SYNC_FUSION_LICENSE_KEY` environment variable.

### Local dev setup
1. Create `.env.local` at project root (already gitignored via `.env.*`):
   ```
   SYNC_FUSION_LICENSE_KEY=your_key_here
   ```
2. Run once to generate the file:
   ```
   node scripts/gen-syncfusion-license.js
   ```
3. `ng build` / `ng serve` will re-run this automatically via the `prebuild` script.

### App Hosting (CI)
- `SYNC_FUSION_LICENSE_KEY` is stored as a secret in Firebase App Hosting and injected at build time.
- The prebuild script picks it up automatically — no manual steps needed.

## rh-agent (Robinhood Trading Agent)

### Location
- Source: `functions/src/rh-agent/`
- Files: `agent.ts`, `strategies.ts`, `indicators.ts`, `scheduler.ts`, `watchlist.ts`, `index.ts`
- Architecture doc: `docs/rh-agent/RH-AGENT-ARCH.md`

### Functions setup
- Node 20, ESM/NodeNext (`type: module` in `functions/package.json`)
- Added deps: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `dotenv`
- CLI entry point: `npx tsx src/rh-agent/index.ts` (via `npm run dev` in `functions/`)
