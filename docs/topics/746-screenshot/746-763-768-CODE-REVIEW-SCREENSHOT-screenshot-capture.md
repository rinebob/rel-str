**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #763  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #768  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# Code Review — #768 captureChartSnapshot callable + SVG storage

## Scope reviewed

- `functions/src/screenshot-capture/` — `capture-chart.ts` (onCall + `handleCaptureChartSnapshot` + `parseCaptureChartSpec`), `storage-writer.ts` (new); `chart-data-loader.ts` (`InsufficientBarsError` + extracted `assertSufficientBars`)
- `shared/screenshot-capture-contracts.ts` (`MAX_CAPTURE_DIMENSION`), `shared/screenshot-capture-utils.ts` (`symbolPathSegment`)
- `tests/functions/screenshot-capture/capture-chart.spec.ts` (new — 47 tests)
- `functions/scripts/verify/screenshot-capture-768-callable.ts` + `screenshot-capture-768.md` + `run-all.ts`/`README.md` registration
- `functions/src/index.ts` (export), IMPL doc utils line

## Standards axis

1 hard documented-standard finding + 4 judgement calls. All remediated or accepted with rationale.

- **violation → fixed** — IMPL doc error contract requires `internal` failures "logged with symbol+spec"; the catch logged only message/stack. `spec` is hoisted out of the try and logged on `capture_chart_snapshot_error` (`capture-chart.ts:199-206`). Matches `indicator-series.ts:151` which logs `symbol` on error.
- **judgement → fixed** — no auth on a write-side-effect callable. See Thermo axis; `unauthenticated` added.
- **judgement → fixed** — lowercase `symbol` failed the `symbol-data/` doc lookup while paths still rendered uppercase. `parseCaptureChartSpec` now `.trim().toUpperCase()`s once — doc lookup, header, and path all agree.
- **judgement → fixed** — duplicate `intervals` (`['daily','daily']`) wrote the same path twice; deduped via `new Set`. Redundant `30 as const` in the verify script dropped.
- **verified clean** — `File.save(body, { metadata: { contentType }, resumable: false })` matches `@google-cloud/storage` `SaveOptions`; mock gap covered because the verify script asserts `exists()`, byte-identical round-trip, and `contentType` against real GCS — exactly what a mock can't prove. `getStorage().bucket()` parameterless is deploy-verified behavior (resolves via `FIREBASE_CONFIG`); the verify script documents why it passes the bucket name explicitly under local ADC.

## Spec axis

All three ACs MET; the AC's literal path/overwrite wording is superseded by the shipped #765 contract (see below).

- **contract partial → fixed** — the error log, per the Standards finding above.
- **spec gap → fixed** — TEST doc edge case "reject absurd dimensions (0, negative, > cap)" had no cap. `MAX_CAPTURE_DIMENSION = 4096` added to shared contracts; `width`/`height` > cap → `invalid-argument` (spec: width/height-over-cap cases).
- **test coverage gap → fixed** — insufficient-bars logic was only exercised via the verify script. Extracted pure `assertSufficientBars` (loader) — spec now covers default-30 window, `'all'` → ≥1, and error fields (interval/available/required). Also added `unauthenticated`, all three `internal` mappings (assemble/render/write), and intervals dedupe.
- **AC wording superseded (not code)** — the issue body says `screenshots/{symbol}/{yyyy-MM-dd}-{event}-{positionType}-{interval}.svg` + "deterministic overwrite on same symbol/event/day"; the reviewed #765 contract + IMPL own `st-trade-screenshots/…{HHmmss}…` (never-overwrite by design). Implementation follows the shipped contract; paths are deterministic given spec+timestamp (spec asserts identical paths on repeat; overwrite-safe for retry). Issue text is stale — worth amending at ship.
- **PNG deferred** — TEST Journey 1's "SVG+PNG" is #769's scope (rasterizer + `.png` sibling writes); the artifact contract already carries `pngPath?`.
- **verified correct** — `{svg, paths, artifacts}` via `buildCaptureChartResult` (canonical constructor); refId segment present/absent correctly; `invalid-argument` before any pipeline touch; per-interval artifacts in request order.
- **noted** — `internal` rethrow forwards `err.message` (indicator-series convention); UTC date derives marketDate + path (same precedent as `todayIso()`; post-close US captures land on the next UTC day — flag if trading-day semantics are wanted later).

## Thermo-nuclear axis

Verdict **MET** — seams earn their keep; deps-injection mirrors `PaperSignalOrderDeps`; `InsufficientBarsError` as plain-Error→`HttpsError` is the right layer boundary; `storage-writer` is the real mock seam shared by callable + verify (not a Middle Man).

- **major → fixed** — unauthenticated write callable: every repo *write* callable enforces `request.auth` (paper-trading, manual passes, stManualRun); the only unauthenticated precedent (`stGetSymbolIndicatorSeriesV2`) is read-only. Handler now takes `{ data, auth }` and throws `unauthenticated` before the pipeline; verify script passes a synthetic `auth.uid`. The dev-page caller is already auth-guarded.
- **major → fixed** — error logging contract (same as Standards).
- **minor → fixed** — sequential write loop → `Promise.all` over the artifact map (render + path + write collapsed into one expression).
- **noted, accepted** — loader's swallow→empty-bars→`failed-precondition` masks transport errors: pre-existing `getCachedBarsFromSymbolData` contract, same flaw as `indicator-series`, already accepted by the #767 review. Hand-rolled validation vs the repo's `ajv` dep: `ajv` exists only for MCP tool-schema validation; every callable precedent hand-rolls — not a divergence. `captureTimestamp` UTC slicing matches `todayIso()` precedent.

## Test results

- `capture-chart.spec.ts` — 47/47 (validation matrix, result shape, path convention, auth, all error mappings, `assertSufficientBars` units)
- Touched-surface sweep — 7 suites / 129 tests green (screenshot-capture + shared contracts/utils)
- `functions tsc --noEmit` clean; `esbuild` bundle clean; `tsconfig.app.json --noEmit` clean
- `scripts/verify/screenshot-capture-768-callable.ts` — 14/14 against prod Firestore + real GCS writes (exists, byte round-trip, contentType, deterministic repeat, error contract); `…-767-assemble.ts` — 20/20 post-change regression

## Round 2 — remediation verification

Three-axis re-run on the post-remediation files; scoped to verify fixes + catch remediation regressions only.

- **Standards** — all 5 round-1 fixes verified in place (auth gate before parse, spec+symbol on the error log, `MAX_CAPTURE_DIMENSION` on both dims, `assertSufficientBars` extracted, dedupe/uppercase/`Promise.all`). `CaptureChartSnapshotRequest` is a truthful structural subset of `CallableRequest`. No new violations.
- **Spec** — PASS on every AC: `{svg, paths, artifacts}` shape, `invalid-argument` before pipeline, `failed-precondition` via `InsufficientBarsError`, deterministic paths. Auth change didn't disturb the callable contract; `Promise.all` preserves request-order artifacts; spec coverage claims confirmed real (cap, dedupe, auth, all `internal` mappings).
- **Thermo** — **MET**. Hoisted `let spec` + `spec?.` in catch is correct; no `spec!` casts; dedupe rejects non-arrays correctly; writer seam unchanged. Two non-blocking notes: IMPL doc's error contract doesn't list `unauthenticated` (doc drift — amend at ship alongside the path-prefix text); verify script's `paths[i] === artifacts[i].svgPath` ordering assumption will need updating when #769 adds `pngPath`.

## Verdict

**PASS** — one remediation round, round-2 verification clean on all three axes. Convergent findings: `internal` logging contract now carries symbol+spec; write callable now auth-gated per repo precedent; dimension cap added per TEST doc; loader bar-check extracted + unit-tested. Known spec-text staleness (path prefix, same-day overwrite, `unauthenticated` in IMPL error contract) documented for ship-time issue amendment.
