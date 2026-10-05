**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #793  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #768  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# UAT — #768 captureChartSnapshot callable + SVG storage (tracer bullet)

## Scope

The callable endpoint that turns a `CaptureChartSpec` into stored chart artifacts: `capture-chart.ts` (`captureChartSnapshot` onCall + `handleCaptureChartSnapshot` + `parseCaptureChartSpec`), `storage-writer.ts` (GCS write seam), `chart-data-loader.ts` (`InsufficientBarsError` + `assertSufficientBars`), `symbolPathSegment` + `MAX_CAPTURE_DIMENSION` in shared contracts/utils, `index.ts` export. PNG rasterization is #769 — out of scope. No dev-page caller yet — acceptance is via the handler/verify-script seam.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`; `npm install` + `functions/npm install` done.
- ADC for real Firestore + GCS (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`) — the verify script writes real objects to `gs://rel-str.appspot.com/st-trade-screenshots/{SYMBOL}/`.
- GOOG has cached `symbol-data/` bars (used by prior verifications).
- Node IPv4 preload for network commands if DNS hangs: `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.

## Scenarios

### 1. Callable unit suite — validation, result shape, error mapping, path convention

- **Steps:** `npx jest tests/functions/screenshot-capture/capture-chart.spec.ts --coverage=false`
- **Expected:** 47 specs pass — every field's `invalid-argument` matrix, `unauthenticated` on missing/empty auth, `{svg, paths, artifacts}` shape, `st-trade-screenshots/` path convention with optional `refId` segment, identical paths on repeat (deterministic overwrite), intervals dedupe, dimension cap at `MAX_CAPTURE_DIMENSION`, `failed-precondition`/`internal` mappings, `assertSufficientBars` units.
- **Result:** see Execution log.

### 2. Real end-to-end verify — callable → real GCS writes + error contract

- **Steps:** `cd functions && npx tsx scripts/verify/screenshot-capture-768-callable.ts GOOG`
- **Expected:** `14/14 checks passed`. Confirms: inline `svg`, daily+weekly artifacts, `paths` flattening, path convention, both objects exist in `rel-str.appspot.com` with byte-identical round-trip and `image/svg+xml` contentType, deterministic identical paths on repeat, `invalid-argument`/`unauthenticated`/`failed-precondition` live error codes. Fixed timestamp means reruns overwrite the same objects.
- **Result:** see Execution log.

### 3. Stored-artifact visual check (manual)

- **Steps:** open the two objects the verify script wrote — `st-trade-screenshots/GOOG/2026-10-05-143022-manual-stock-verify-daily.svg` and `…-weekly.svg` in `rel-str.appspot.com` (Google Cloud console → Storage → bucket browser, or `gcloud storage cat` to a local file and open in a browser).
- **Expected:** the ST quick-chart look — candle layers + std-dev channel on main pane, zone/TS lower panes — same renderer as the QA-approved #767 output; this confirms the bucket round-trip produces a viewable artifact end-to-end.
- **Result:** pending user confirmation.

### 4. Compile gates

- **Steps:** `cd functions && npx tsc --noEmit` and `cd functions && npm run build`; `npx tsc -p tsconfig.app.json --noEmit` (repo root).
- **Expected:** all exit 0 — callable + writer + loader compile; esbuild bundles the export; the FE surface still typechecks against the shared-contract additions.
- **Result:** see Execution log.

### 5. Regression — screenshot-capture + shared suites and #767 verify

- **Steps:** `npx jest tests/functions/screenshot-capture shared/screenshot-capture-contracts.spec.ts shared/screenshot-capture-utils.spec.ts --coverage=false`; `cd functions && npx tsx scripts/verify/screenshot-capture-767-assemble.ts GOOG 60`.
- **Expected:** 7 suites / 129 tests green; 767 verify `20/20` — the loader's `assertSufficientBars` addition is additive for valid data.
- **Result:** see Execution log.

### 6. Manual UI/UX refinement pass

- The callable has no app UI surface — the stored SVG artifact is the user-visible product. Scenario 3 is the refinement pass.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Valid spec → `{svg, paths}` + files at conventional path | 1, 2, 3 |
| Invalid spec → `invalid-argument` | 1, 2 |
| Insufficient bars → `failed-precondition` | 1, 2 |
| Deterministic overwrite same spec+timestamp | 1, 2 |
| Callable exported, thin orchestration, writer seam | 1, 4 |
| Unauthenticated → `unauthenticated` (review remediation) | 1, 2 |
| Review findings addressed | 1–5 |

## Regression / smoke

- Shared contracts/utils specs — scenario 5.
- 767 real-data verify — scenario 5 (additive loader change).
- Full jest suite deferred to ship — touched-surface sweep is scenario 1+5.

## Execution log

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Callable unit suite | PASS | 47 specs green; sweep 7 suites / 129 tests |
| 2 | Real verify + error contract | PASS | 14/14 — real GCS exists/round-trip/contentType, deterministic repeat, invalid-argument + unauthenticated + failed-precondition live |
| 3 | Stored-artifact visual (manual) | PASS | user confirmed both GCS SVGs render the quick-chart look ("they're really good") |
| 4 | Compile gates | PASS | functions tsc + esbuild (1.7mb bundle) + app tsc all exit 0 |
| 5 | Regression suites + 767 verify | PASS | 129/129 screenshot-capture + contracts/utils; 767 verify 20/20 |
| 6 | UI/UX refinement | N/A→3 | no app UI; scenario 3 is the visual pass |
