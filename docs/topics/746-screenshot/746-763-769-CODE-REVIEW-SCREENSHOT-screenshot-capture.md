**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #763  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #769  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# Code Review — #769 PNG rasterization (resvg + bundled font + PNG siblings)

## Scope reviewed

- `functions/src/screenshot-capture/rasterizer.ts` (new — `rasterizeSvgToPng` + `bundledFontFiles`)
- `functions/src/screenshot-capture/capture-chart.ts` (`rasterizeSvgToPng` dep, per-interval `.png` write, `pngPath` on artifacts)
- `functions/package.json` (`@resvg/resvg-js ^2.6.2` + `--external:@resvg/resvg-js`), `package-lock.json`
- `functions/assets/fonts/` (Roboto 400/500/700 TTFs + README + LICENSE.txt)
- `tests/functions/screenshot-capture/rasterizer.spec.ts` (new), `capture-chart.spec.ts` (PNG assertions)
- `functions/scripts/verify/screenshot-capture-769-rasterize.ts` + `.md` (new); `screenshot-capture-768-callable.ts` adapted; `README.md`/`run-all.ts` registered
- IMPL doc module-layout + dependency lines updated

## Standards axis

No violations. Two judgement items + three nits; cheap ones remediated.

- **judgement → resolved** — caret range `^2.6.2` vs the IMPL's "(pinned ≥7-day-old release)" wording: caret is the dominant repo style (ajv/busboy/firebase-admin) and the lockfile resolves exactly 2.6.2; the IMPL text was the drifted artifact — corrected to "caret per repo convention; lockfile pins".
- **judgement → verified** — cwd-candidate font resolution is mildly brittle but documented (`import.meta` breaks under jest's CJS transform); missing fonts fail loudly with searched paths → `internal`. Deployed path verified: firebase.json ignores only node_modules/.git/logs so `assets/fonts/` ships; cwd=`/workspace` at GCF resolves `assets/fonts`.
- **nit → fixed** — Apache-2.0 §4a wants license text distributed with vendored fonts: `LICENSE.txt` added beside the TTFs.
- **nit → fixed** — spec label "does not depend on host system fonts" overstated what it proved (bundled Roboto passes either way); renamed to "renders text when only the bundled family is named" — the meaningful assertion under `loadSystemFonts:false`.
- **nit → accepted** — `pngDimensions` helper duplicated between jest spec and verify script (different run contexts; 6 lines); `bundledFontFiles()` re-stats 3 files per capture (~ms, low-frequency callable — caching unwarranted).

## Spec axis

All three ACs PASS.

- **AC1 PNG sibling at same stem** — `svgPath`/`pngPath` built from an identical `pathSpec` spread differing only in `ext`; spec asserts exact paths, verify regexes both conventions.
- **AC2 non-empty + correct dims + legible text** — SVG root always carries spec `width`/`height` (svg-renderer:279-280); resvg `fitTo` default 'original' honors it (spec IHDR checks at 800×560 and 320×200); verify asserts signature + dims + >10KB body + `image/png` per artifact. Legibility is correctly flagged as the manual QA eyeball. Implementation uses the real resvg-js API (`font.fontFiles` + `loadSystemFonts:false` + `defaultFontFamily:'Roboto'`) — the ticket's "loadFont" wording predates the pinned version.
- **AC3 build external** — `--external:@resvg/resvg-js` in the build script; lockfile captures the linux-x64-gnu optional binary (all 13 platform entries present) so deploy-time `npm install` resolves the glibc binary.
- **No #768 regression** — `{svg, paths, artifacts}` shape unchanged; `paths` interleaves svg→png per artifact; 768 verify script updated accordingly and still 14/14.

## Thermo axis

Verdict **MET** — all eight probes answered clean.

- **Deploy reality** — `assets/fonts/` ships (not ignored); cwd candidates cover jest repo-root, `functions/` (tsx verify, emulators, functions:shell), and GCF `/workspace`. Only an exotic cwd (e.g. `functions/scripts`) misses — nit, fails loudly if hit.
- **napi binary** — all platform optionalDeps locked incl. `linux-x64-gnu` (resolved+integrity+cpu/os).
- **Sync rasterize in Promise.all** — order-preserving, writes awaited; CPU cost trivial for ≤2 intervals under a 60s timeout.
- **Orphaned SVG on PNG-write failure** (minor, accepted) — if the png write throws after the svg lands, the svg object remains without a sibling; retry mints a new `HHmmss` so no overwrite happens and orphans accumulate silently. Acceptable for a manual dev-page trigger; revisit if automated pipeline callers arrive.
- **Per-call TTF parse** — ~ms per rasterize; not worth a cache for this call frequency.
- Boundary checks clean: malformed SVG throws → `internal`; `pngPath?` optional handled by `buildCaptureChartResult`; no new casts or silent catches.

## Test results

- `rasterizer.spec.ts` — 6/6, real resvg rasterization under jest (napi binary loads, IHDR dims, font-driven pixel divergence, malformed-SVG throw)
- `capture-chart.spec.ts` — 48/48 incl. PNG sibling paths, `image/png`+Buffer bodies, flatten order, rasterize→`internal`
- Touched-surface sweep — 8 suites / 136 tests green
- `functions tsc --noEmit` + `esbuild` bundle clean (resvg externalized, lib/index.js 1.7mb)
- `screenshot-capture-769-rasterize.ts` — **17/17 against real GCS** (font resolution, pngPath, interleave, path convention, exists, PNG signature, 800×560 IHDR, >10KB body, image/png, SVG sibling intact)
- `screenshot-capture-768-callable.ts` — 14/14 post-adaptation

## Verdict

**PASS** — one light remediation round (LICENSE vendored, spec label corrected, IMPL wording drift fixed). Accepted carryover: orphaned-SVG-on-partial-write semantics and per-call font stats — both right-sized for a low-frequency capture tool. Remaining human item for QA: open the two stored PNGs and confirm chart text is legible with the bundled font.
