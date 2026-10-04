**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #774  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #765  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# UAT — #765 Contracts: screenshot-capture spec + result types

## Scope

Shared TypeScript contracts for `captureChartSnapshot`: `CaptureChartSpec`, `CaptureChartResult`, `CaptureArtifact`, `ChartInterval` (canonical), `CaptureInterval` (D/W subset), `CaptureEvent`, `PositionType`, plus builders `buildScreenshotStoragePath` and `buildCaptureChartResult` in `shared/screenshot-capture-utils.ts`. No runtime feature surface — this task delivers type contracts and pure builders consumed by #767/#768/#770.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, `npm install` + `functions/npm install` already done.
- No credentials, emulators, or network access required — all checks are local compile/test commands.

## Scenarios

### 1. Unit suite — contract surfaces

- **Steps:** `npx jest shared/screenshot-capture --coverage=false`
- **Expected:** both spec files pass — enum wire values (`ChartInterval` lowercase, `CaptureEvent` four values, `PositionType` stock-only), defaults (D+W, 30 bars, `'all'` sentinel), readonly-assignability regression, path builder cases, result-builder invariant.
- **Result:** PASS — 19 tests, 2 suites.

### 2. Path convention behavior

- **Steps:** covered by `shared/screenshot-capture-utils.spec.ts` — `st-trade-screenshots/{SYMBOL}/{date}-{time}-{event}-{positionType}[-{ref6}]-{interval}.{ext}`; refId ≤6 alnum/dot truncation; refId-sanitizes-empty → segment omitted; symbol sanitize; `HHmmss` never-overwrite; empty-symbol throw.
- **Expected:** exact strings asserted (e.g., `st-trade-screenshots/GOOG/2026-10-03-143022-order-filled-stock-ord123-daily.png`).
- **Result:** PASS — 9 path-builder tests green.

### 3. Result assembly invariant

- **Steps:** `buildCaptureChartResult([daily, weekly])` — `svg === artifacts[0].svg`, `paths` = flattened svg+png paths, empty-array edge returns `''`/`[]` without throwing.
- **Expected:** derived fields cannot diverge from `artifacts`.
- **Result:** PASS — 3 tests green.

### 4. Functions-context compile + alias resolution

- **Steps:** `cd functions && npx tsc --noEmit -p tsconfig.json`; then `npx tsx -e "import { CaptureEvent } from '@screenshot-capture/contracts'; import { buildScreenshotStoragePath } from '@screenshot-capture/utils'; …"`.
- **Expected:** tsc clean; aliases resolve and execute (enums + path builder callable).
- **Result:** PASS — tsc exit 0; tsx resolves both aliases.

### 5. ChartInterval unification

- **Steps:** `cd functions && npx tsx -e "import { ChartInterval } from './src/st-cloud-function/indicator-computation'; import { ChartInterval as S } from '@screenshot-capture/contracts'; console.log(ChartInterval.DAILY === S.DAILY)"`.
- **Expected:** `daily true` — the re-exported enum is reference-identical to the shared canonical (no dual-enum fracture); `indicator.types.ts` re-export verified by app-side compile in scenario 6.
- **Result:** PASS.

### 6. App-context compile (full build)

- **Steps:** `npm run build` (ng build) — exercises `src/…/indicator.types.ts` → `@screenshot-capture/contracts` through `tsconfig.app.json` → root `tsconfig.json` paths.
- **Expected:** production build completes with no alias/type errors.
- **Result:** see Execution log below.

### 7. Manual UI/UX refinement pass

- **Result:** Not applicable — no user-facing surface (contracts and pure builders only).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Types compile in both functions and app builds | 4, 5, 6 |
| `positionType` stock-only; `CaptureEvent` four values | 1 |
| `CaptureChartSpec` shape (all fields incl. `visibleBars` number-or-`'all'`) | 1 |
| `CaptureChartResult` `{svg, paths}` (+ artifacts) | 1, 3 |
| Storage path convention `st-trade-screenshots/…` never-overwrite | 2 |
| `ChartInterval` wire-compatible with existing indicator-series API | 5 |

## Regression / smoke

- Full suite `npx jest --coverage=false` — no unrelated suite broken by the `ChartInterval` re-export conversion.
- `functions` esbuild bundle build — re-export + new alias must bundle (deferred to `npm run build:functions` / deploy-time; esbuild resolves tsconfig paths identically to existing `@*/contracts` aliases — verified by tsc + tsx).

## Execution log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Unit suite | PASS | 19 tests, 2 suites green |
| 2 | Path convention | PASS | exact-string assertions incl. `ord123` truncation, `BRK.B`, empty-symbol throw |
| 3 | Result invariant | PASS | svg=first artifact, flattened paths, empty edge |
| 4 | Functions compile/alias | PASS | `tsc --noEmit` exit 0; tsx resolves both aliases |
| 5 | ChartInterval identity | PASS | `daily true` via re-export |
| 6 | App build | PASS | `ng build` — "Application bundle generation complete" (18.1s), no alias/type errors |
| 6b | Functions bundle | PASS | `cd functions && npm run build` — esbuild `lib\index.js` 1.7 MB in 116ms |
| 7 | UI/UX refinement | N/A | no user-facing surface |
