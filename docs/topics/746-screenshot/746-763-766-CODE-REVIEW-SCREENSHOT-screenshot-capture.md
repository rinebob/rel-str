**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #763  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #766  
**Domain:** SCREENSHOT  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-10-04  
**Last Updated:** 2026-10-04  

# Code Review — #766 SVG renderer core

## Scope reviewed

- `functions/src/screenshot-capture/` — `render-model.ts`, `chart-theme.ts`, `svg-primitives.ts`, `svg-layout.ts`, `svg-renderer.ts` (all new)
- `tests/functions/screenshot-capture/` — `svg-layout.spec.ts`, `svg-renderer.spec.ts`, `svg-primitives.spec.ts` (new)
- `functions/scripts/verify/screenshot-capture-766-render.ts` + `screenshot-capture-766.md` + `run-all.ts` + `README.md` registration
- Post-remediation additions: `shared/flex-chart-theme.ts`, `shared/flex-chart-scale-math.ts` (canonical hoists); `src/app/features/shared/components/flex-chart/chart-theme.ts`, `strategies/log-transform.ts`, `strategies/price-format.ts` → re-export shims; `@flex-chart/{theme,scale-math}` aliases in `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js`

## Standards axis

Round 1: 2 documented-standard violations + ~7 judgement-call smells. All remediated.

- **violation → fixed** — `functions/scripts/verify/README.md` "Order across tasks" list omitted #766 while the index table included it; two indexes disagreed. Added item 15.
- **violation → fixed** — `chart-theme.ts` header claimed "only the slots the renderer consumes are carried" while 10 of 15 slots had zero consumers; dead slots "kept for later" violate §3. Resolved wholesale by the shared hoist — the palette is now the canonical `ChartPalette`, not a curated mirror.
- **judgement → fixed** — `toLogAxis`/`fromLogAxis`/`nicePriceStep`/`nicePriceTicks`/`formatPrice` verbatim ports in `svg-layout.ts` duplicated pure FE code. Hoisted to `shared/` (see Thermo axis); the stated rootDir justification was factually wrong.
- **smells → fixed** — duplicated `w`/`d`/`o` opts emission across `vline`/`hline`/`polyline` → `strokeAttrs(opts)`; `text()`'s default fill hardcoded `axisText` → `fill` is now required (all callers passed it anyway — dead default); identical `candle`/`range` cases merged; self-contradictory "Half-open … inclusive" doc corrected; `PLOT_HEADER_X` moved to the constants block; `MAX_X_TICKS` moved module-level.

## Spec axis

Round 1: height math, scales, palette, marker, metadata, header — all MET output-for-output. One contract gap + five parity deviations. All remediated.

- **gap → fixed** — nothing documented that FE pane numbering is bottom-up (Syncfusion stacks `chartRows` bottom-up → visual order is main, lower-4→lower-1). Both fixtures baked the inverted order. `RenderPane.panes` now carries the assembler contract explicitly; spec + verify fixtures emit main → lower-3 → lower-1.
- **parity → fixed** — reference lines painted behind series; FE `stripLines` use `zIndex: 'Over'`. Now emitted last inside each clipped pane group.
- **parity → fixed** — `logTickLine` used for every pane's gridlines; FE reserves it for the log-scale price axis and uses `gridLine` elsewhere. `renderPaneAxis` selects per pane id + `layout.logScale`; spec asserts both colors present.
- **parity → fixed** — `MAIN_PANE_INSET = 4` had no FE counterpart (primary axis sets no `plotOffset`). Removed — only lower panes inset.
- **parity → fixed** — x labels dropped the year (`'Mar 5'`); FE category labels carry it (`'Mar 5, 2026'`). Fixed + spec updated.
- **parity → fixed** — line series bridged interior non-finite points; FE `emptyPointSettings: Gap` breaks the polyline. `renderLine` now splits into segments; spec asserts two paths across an interior `NaN`.
- Noted and kept — `eventBarIndex` exceeds the spec's "latest bar" wording but defaults correctly and the PRD's trailing-context deferral doesn't forbid the parameter. Harmless forward seam.

## Thermo-nuclear axis

Round 1 verdict **NOT MET** — two majors. Both remediated plus all actionable minors.

- **MAJOR → fixed** — `shared/` hoist. The justification "the functions tsconfig rootDir excludes src/app" was wrong (`rootDir` is `..`; the feature already used `shared/` via `@screenshot-capture/*`). Moved FE `chart-theme.ts` → `shared/flex-chart-theme.ts` and `log-transform.ts` + `price-format.ts` → `shared/flex-chart-scale-math.ts` (verbatim, no edits); the FE files became re-export shims (the `ChartInterval` precedent from #765); new `@flex-chart/theme` + `@flex-chart/scale-math` aliases wired in all three configs. Deleted ~170 duplicated lines plus the palette-mirror spec and the output-for-output parity block — drift is now impossible by construction, not test-guarded. All 180 flex-chart FE specs pass through the shims; functions `tsc` + esbuild build clean.
- **MAJOR → fixed** — flat linear price range leaked `NaN` into shipped SVG (`min === max` → divide-by-zero in `toY`), violating the stated no-NaN guarantee and reachable via a 1-bar or flat-bar model. `mainPaneRange` now falls back to a ±1% band (log branch already had ±0.01). Regression spec added (`svg-layout.spec.ts` flat-range + `svg-renderer.spec.ts` no-NaN).
- **minor → fixed** — `Math.floor(barCount/6)` emitted 7 x ticks for barCount 31–35 and wide `'all'` captures; `Math.ceil` caps at 6.
- **minor → fixed** — `clipPath` returned `{def, ref}` but `ref` was never used; the renderer now consumes `clip.ref`.
- **minor → fixed** — contract tension: model said "series order IS paint order" while the renderer silently re-sorted `window` behind. Windows are now a pane-level `windows` field (background annotation, not a series) — the contract is literally true and `WindowSeriesSpec` is gone.
- **minor → fixed** — `seriesValues` had no exhaustiveness guard (a future series kind would silently contribute no y-extent); added a `never` check. `WindowSeriesSpec.data`'s anonymous type named `WindowRange`.
- **nits → fixed** — verify script's stale `x="740"` alternative (labels render at 744); `toBeGreaterThanOrEqual(94)` → exact count 95 on the deterministic fixture; new `svg-primitives.spec.ts` covers `n2` -0 normalization, `escapeXml`, and stroke-attr emission.

## Test results

- `npx jest` full suite, post-remediation: **180 suites / 2601 tests — all PASS**.
- `cd functions && npx tsc --noEmit`: clean. `npm run build` (esbuild bundle): clean — resolves the new aliases.
- `npx tsx scripts/verify/screenshot-capture-766-render.ts`: **9/9 checks**; fixture SVG regenerated at `.devin/tmp/screenshot-capture-766/screenshot-766-daily.svg`.

## Verdict

**PASS** — one remediation round. Both blockers resolved at the root (canonical shared sources, flat-range guard); every actionable minor fixed with regression coverage. The render-model seam is now a clean dumb-painter contract for #767.

## Round 2 (2026-10-04) — verification pass on remediated code

All three axes re-ran against the post-remediation tree. Every round-1 fix verified landed with file:line evidence; shared/ hoist confirmed verbatim-complete (every FE consumer resolves through the shims; all 180 flex-chart specs pass). New findings, all addressed:

- **minor (fixed)** — `svg-layout.ts` re-exported the scale helpers solely for its spec — single-consumer indirection; spec now imports `@flex-chart/scale-math` directly.
- **minor (fixed)** — the `windows` contract shape was written anonymously in both `render-model.ts` and `svg-renderer.ts`; now a named `RenderPaneWindows` export.
- **minor (fixed)** — dead struct fields: `ChartLayout.width` and `AxisTick.value` removed.
- **minor (fixed)** — `seriesValues` let a single NaN point collapse a pane's auto-range to {0,1}; values are now finite-filtered. Same class fixed in `mainPaneRange` (non-finite bars filtered) and in `renderCandle`/`renderRange` (non-finite points skipped — consistent guard policy across all series kinds).
- **minor (fixed)** — `data-bar-width`/`data-plot-x` emitted at 2dp; the crop seam multiplies bar-width by index so rounding drifts wide `'all'` captures. Now full precision.
- **minor (fixed)** — `nicePriceTicks` could infinite-loop on non-finite bounds (inherited verbatim from the FE original); a `Number.isFinite` early return added in `shared/flex-chart-scale-math.ts` — strict improvement for both consumers.
- **minor (fixed)** — pane *order* was encoded in fixtures but never asserted; spec now asserts pane id sequence and strictly increasing `rect.y`. Main-pane zero-inset assertion added.
- **minor (fixed)** — `eventBarIndex >= barCount` drew the marker off-canvas; guarded.
- **nit (fixed)** — the x-label year was marked "FE parity" but FE live axis labels actually drop the year (`chart-axis-label.service.ts` `{month:'short', day:'numeric'}` — the year-bearing `label` field is vestigial). Kept the year (deliberate: a static capture is clearer with it); comments corrected to name it a deviation.
- **nit (fixed)** — gridlines painted over series on all panes; now under series for linear/lower (`majorGridLines` parity), over only for log-main (`stripLines zIndex 'Over'`).
- **nit (fixed)** — last x label could overflow into the axis gutter; `edgeLabelPlacement`-style end-anchoring added. Top pane now gets its top-edge divider. `MONTH_ABBR`/`LOWER_TICK_COUNT` moved to the constants block; `size: 9` literals named `SMALL_LABEL_SIZE`; floating bar-index comment moved to the model header; `log-transform` header reference updated to `@flex-chart/scale-math`.
- **considered and rejected** — hoisting `mainPaneRange` into `shared/` so FE strategies share one viewport composition: the FE delegates degenerate equal-bounds ranges to Syncfusion, which expands them internally; the SVG has no such engine, so the flat-range guard is capture-only by design. Adopting it FE-side would change working behavior for no FE-visible benefit — scope creep. The divergence is documented at the function.
- **noted, acceptable** — `LogTickStripLine`/`buildLogTickStripLines` are Syncfusion-shaped and FE-consumed only, now in `shared/flex-chart-theme.ts`; palette-cohesive, no import leak. `polyline`/`rangeFill` share ~4 lines of path-builder code — too small to abstract.

Axes: Standards CLEAN · Spec all-MET (year-in-labels documented as deliberate deviation) · Thermo-nuclear **approval bar met**.

## Test results (round 2)

- `npx jest tests/functions/screenshot-capture`: **39 tests — all PASS**.
- `cd functions && npx tsc --noEmit`: clean.
- `npx tsx scripts/verify/screenshot-capture-766-render.ts`: **9/9 checks**; fixture SVG regenerated at `.devin/tmp/screenshot-capture-766/screenshot-766-daily.svg`.
- Targeted re-run after round-2 edits: `flex-chart` + `screenshot-capture` suites — **16 suites / 219 tests — all PASS** (covers the `nicePriceTicks` guard on the FE side).

## Next

`/proj qa 746 766`
