**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #794  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #769  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# UAT — #769 PNG rasterization in captureChartSnapshot (resvg + bundled font)

## Scope

PNG rasterization added to the #768 callable: `rasterizer.ts` (`rasterizeSvgToPng` via `@resvg/resvg-js`), bundled Roboto 400/500/700 at `functions/assets/fonts/` (Apache-2.0, `LICENSE.txt` vendored), `capture-chart.ts` gains a `rasterizeSvgToPng` dep and writes a `.png` sibling per `.svg` (`image/png`, same path stem), `artifacts[].pngPath` + `paths` interleaving `[svg, png]` per interval, `package.json` build gains `--external:@resvg/resvg-js`, verify script `screenshot-capture-769-rasterize.ts`. No new callable surface — same spec, richer artifacts.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`; `npm install` + `functions/npm install` done (`@resvg/resvg-js@2.6.2` + platform binaries in lockfile).
- ADC for real Firestore + GCS (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`).
- GOOG has cached `symbol-data/` bars.
- Node IPv4 preload for network commands if DNS hangs: `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.

## Scenarios

### 1. Rasterizer unit suite — real resvg rasterization

- **Steps:** `npx jest tests/functions/screenshot-capture/rasterizer.spec.ts --coverage=false`
- **Expected:** 6 specs pass — PNG signature, IHDR dimensions (800×560 default + custom), text pixels diverge when glyph content changes (bundled-font path exercised), malformed SVG throws.
- **Result:** PASS — 6/6.

### 2. Callable unit suite — PNG sibling wiring

- **Steps:** `npx jest tests/functions/screenshot-capture/capture-chart.spec.ts --coverage=false`
- **Expected:** 48 specs pass — PNG write per interval at same stem, `image/png` contentType, Buffer bodies, `artifacts[].pngPath`, `paths` interleave order, rasterizer failure → `internal`, prior #768 contract intact.
- **Result:** PASS — 48/48 (screenshot-capture dir total: 6 suites / 117 tests).

### 3. Real end-to-end verify — PNG objects in the live bucket

- **Steps:** `cd functions && npx tsx scripts/verify/screenshot-capture-769-rasterize.ts GOOG`
- **Expected:** `17/17 checks passed` — bundled Roboto files resolve; every artifact carries `pngPath`; `paths` interleave svg+png; PNG path convention; PNG objects exist in `rel-str.appspot.com`; PNG signature; 800×560 dims; body > 10KB (text rendered); `image/png` contentType; SVG siblings intact.
- **Result:** PASS — 17/17. Artifacts at `gs://rel-str.appspot.com/st-trade-screenshots/GOOG/2026-10-05-143022-manual-stock-verify-{daily,weekly}.{svg,png}`.

### 4. Stored-PNG visual check (manual / refinement pass)

- **Steps:** open the two PNGs the verify script wrote — pulled to `.devin/tmp/screenshot-capture-768/` (or GCS console → `st-trade-screenshots/GOOG/…-daily.png`, `…-weekly.png`).
- **Expected:** visible chart content (candles, indicator panes, volume, event markers); legible header + axis text via bundled Roboto; 800×560 shape; no clipping/corruption; visually consistent with the SVG siblings.
- **Result:** PASS — both PNGs inspected: crisp header (`GOOG · manual · 2026-10-05T14:30:22Z · stock · verify · daily|weekly`), legible price axis ($325–$360 daily / $280–$400 weekly) and date axis, full chart content rendered, no clipping or corruption, consistent with SVG output.

### 5. Compile + bundle gates

- **Steps:** `cd functions && npm run typecheck` and `cd functions && npm run build`.
- **Expected:** both exit 0 — tsc clean; esbuild bundles with `--external:@resvg/resvg-js` (native module resolves from node_modules at deploy; lockfile carries `linux-x64-gnu` for Cloud Build).
- **Result:** PASS — tsc clean; `lib/index.js` 1.7mb bundled.

### 6. Regression — #768 verify adapted for PNG artifacts

- **Steps:** `cd functions && npx tsx scripts/verify/screenshot-capture-768-callable.ts GOOG`
- **Expected:** `14/14 checks passed` — the script was updated for the new dep wiring and interleaved `paths`; same spec+timestamp still produces identical paths; error contract (`invalid-argument`/`unauthenticated`/`failed-precondition`) unchanged.
- **Result:** PASS — 14/14.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Each stored SVG has a PNG sibling at the same path stem | 2, 3 |
| PNG is non-empty | 1, 3 |
| PNG has correct dimensions | 1, 3 |
| Text is legible with the bundled font | 1, 3, 4 |
| `npm run build` succeeds with resvg external | 5 |
| Review findings addressed (LICENSE vendored, spec label, IMPL wording) | 1, 5 |

## Regression / smoke

- #768 callable verify — scenario 6 (deterministic paths, error contract, SVG siblings intact).
- Full jest suite deferred to ship — touched-surface sweep is scenario 2's 117 tests.

## Execution log

| Check | Command | Result |
|---|---|---|
| Rasterizer specs | `npx jest tests/functions/screenshot-capture/rasterizer.spec.ts --coverage=false` | 6/6 PASS |
| Screenshot suites | `npx jest tests/functions/screenshot-capture --coverage=false` | 6 suites / 117 PASS |
| Functions typecheck | `cd functions && npm run typecheck` | clean |
| Functions build | `cd functions && npm run build` | `lib/index.js` 1.7mb, resvg external |
| #769 live verify | `npx tsx scripts/verify/screenshot-capture-769-rasterize.ts GOOG` | 17/17 PASS |
| #768 regression verify | `npx tsx scripts/verify/screenshot-capture-768-callable.ts GOOG` | 14/14 PASS |
| Visual inspection | opened stored daily + weekly PNGs | PASS — legible text, full content, 800×560 |

## Findings

None. Review's accepted minor stands: a failed PNG write can orphan a same-stem SVG — acceptable for a manual low-frequency tool since retries mint a new timestamp.
