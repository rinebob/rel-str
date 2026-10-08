**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #866  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #871  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# Code Review — FE: Anchored VWAP indicator, registry, adapter series and render (#871)

## Scope

New: `st-anchored-vwap.indicator.ts` (definition + fixed-slot series builder), its spec, `indicator-registry.spec.ts`, `base-indicators.spec.ts`. Modified: `flex-chart.types.ts` (`StIndicator.ST_ANCHORED_VWAP`), `indicator-registry.ts`, `chart-data-adapter.service.ts` (`anchoredVwapSeries`) and its spec, `flex-chart.component.ts` / `.html` (series exposure, render loop, generic-loop exclusion), and the FE implementation and test plan docs.

**Shared files.** The Trigger Bands thread (#862) has uncommitted edits in the same flex-chart files (`flex-chart.types.ts`, the component `.ts` and `.html`, `indicator-registry.ts`, the adapter and its spec). Only the Anchored VWAP hunks were reviewed here; both sets of changes coexist and pass together.

**Decisions applied (2026-10-08, user):** history drawn in the same colour and width as the active line (no fading); no `historyStart` param or date picker ("let the ZigZag handle the dates"); fixed 12 series. Two further deviations from the plan, both explained below: no `IndicatorCalculator`, and the adapter uses the first AVWAP config only.

## Summary of axes

### Standards

- **Size and responsibility:** the indicator module is 160 lines and does two things only — declares the menu entry and maps engine segments onto fixed series. All computation stays in the pure engine; the adapter stays a thin map-and-theme layer, mirroring `zigZagSeries` and `triggerBandSeries`. The new spec is 296 lines, under the 300 target.
- **Reuse:** the engine, `PriceBar`, `IndicatorOption`, `buildDefaultConfig`, `themeColor` and `transformY` are reused; nothing re-implemented.
- **Contracts:** the builder always returns an array of exactly 12 series (never `null`); params are validated (`num`, `colorParam`) rather than trusted; `null` break points are typed (`y: number | null`).
- **No `any`, no `as unknown as`, no index signatures.** One benign `as const` per literal.
- **No calculator registered, on purpose.** `computeIndicators` explicitly supports indicators without a calculator (it returns `data: []`), and the chart legend is hidden, so a calculator returning `[]` would have been dead code per guideline 3. A test pins this behaviour.
- **Opt-in only:** `INDICATORS_BY_INTERVAL` is untouched; `base-indicators.spec.ts` pins that none of the daily/weekly/monthly base sets include it.
- Two readability findings were fixed during review (M1, M2).

### Spec

Task #871 acceptance criteria, as amended by the decisions above:
- Enum member, definition with every param and default: **met** (no `historyStart`, by decision).
- Registered in `ST_INDICATOR_OPTIONS` and `SERIES_TYPE_MAP`; `INDICATORS_BY_INTERVAL` untouched: **met** (no `indicatorCalculators` entry, by design).
- `buildDefaultConfig` valid defaults; `BASE_CONFIGS` module load does not throw: **met** (`base-indicators.spec.ts` loads the module).
- Builder always 12 series including empty data; adjacent segments alternate history series; no two points at one index; null separators: **met**, including three varied random-walk scenarios checked against the engine as oracle.
- Active vs history styling; large thicker than small; hue encodes side: **met** (history identical to active — no fading, by decision).
- Adapter `anchoredVwapSeries`: themed colours, mapped `y`, `null` breaks preserved, `[]` without a config, no data, or no bars: **met**.
- Template renders the 12 series with Gap handling and the generic main-pane loop excludes `ST_ANCHORED_VWAP`: **implemented and compile-verified, no automated test** (finding M4).
- `computeIndicators` and the legend tolerate an indicator with no calculator: **met** (test + the legend is hidden).
- Enabling it in the sandbox shows four lines plus history, and works with no ZigZag enabled: **not yet observed in a browser** — the adapter test proves the no-ZigZag case at the data level, and the visual check is the first QA item.
- FE Test Plan indicator, registry and adapter tests: **met**. The sandbox control tests belong to T4.

### Thermo-nuclear (Dr. Reed lens)

- **Structure:** the new code is additive and flat — one pure function, one computed, one template loop. No branching bolted onto existing flows apart from one extra exclusion in the generic-loop condition.
- **Series-structure risk (the one Dr. Reed cares about):** Syncfusion reinitialises the chart when its series structure changes. The fixed 12 series mean tuning params or loading new data never changes the structure. Toggling the indicator on or off does (0 to 12), exactly like ZigZag and Std Dev Lines.
- **Contract risk — gaps:** the design relies on `y: null` + `emptyPointSettings: { mode: 'Gap' }` breaking a Line series between packed segments. Round 2 verified this against the installed Syncfusion source (see below): a `null` y makes the point empty, Gap mode makes it invisible, and the Line series restarts its path at the next visible point. The browser check in QA is now confirmation, not discovery.
- **Safety of the separator index:** the break point sits at `endBar + 1`. Packed segments in one series are never closer than two bars (same-side confirmation bars differ by at least `rightDepth + 1` for replacements and at least 2 for alternating pivots), so the break never collides with the next segment's first index. The random-walk tests assert unique, strictly increasing indices at depth 2/2, the tightest case.
- **Performance:** `anchoredVwapSeries` is O(bars) per recompute (two ZigZag walks, prefix sums, packing) and recomputes on config or data change; series data are new arrays on each recompute, as with ZigZag. Fine at daily/weekly volumes.
- **Scaling smell (pre-existing, recommend not act):** every bespoke overlay adds a computed in the adapter, a template `@for`, and another comparison in the generic-loop exclusion (now five: trend bands, std dev, ZigZag, AVWAP, Trigger Bands). The next one should trigger a registry-driven "bespoke overlay" abstraction instead of a sixth comparison.
- **Test quality:** tests assert external behaviour through public functions, use the engine and hand-built fixtures as independent oracles, and avoid `any`/`as never`. To confirm they are not vacuous, five real breakages were applied and each failed at least one test: history-b receiving history-a's segments, no null separators, nulls pushed through the log transform, colours not themed, and multiple AVWAP configs all rendered. (A sixth, a width change, was a no-op edit and proves nothing.)

## Findings

No critical or major findings.

| # | Severity | Finding | Status |
|---|---|---|---|
| M1 | minor | `computeAnchoredVwapSeries` described each scale with a positional five-element tuple (`st-anchored-vwap.indicator.ts:129`), hard to read and easy to mis-order. | **Fixed in review** — an array of named objects. |
| M2 | minor | The adapter mapped non-null points with `this.mapY({ ...p, y: p.y })` (`chart-data-adapter.service.ts:430`), a spread used only to narrow a type, inconsistent with the Trigger Bands computed beside it. | **Fixed in review** — `{ ...p, y: p.y === null ? null : this.transformY(p.y) }`. |
| M3 | minor, **decision for the user** | After the decision to drop the date picker, the engine's `historyStart` path (T2) is unreachable from the app: no param feeds it. Per guideline 3 an unwired feature should be removed, but it is shipped, tested and in the approved PRD and glossary. | **Open** — keep as latent capability, or remove it from the engine, types, tests, PRD and glossary. |
| M4 | minor | The template wiring (12 `e-series` with Gap, and the generic-loop exclusion) has no automated test. The Syncfusion chart cannot mount under jsdom (an attempted render spec threw on a null `setAttribute`), which is why the Test Plan states the render is verified visually. | **Accepted gap** — mitigated by the AOT development `ng build` passing and QA's visual check. |
| N1 | nit | The generic-loop exclusion condition in `flex-chart.component.html:220` now has five comparisons. | Deferred — see the scaling note above. |
| N2 | nit | The pseudo-random `makeWalk` helper is duplicated in two Anchored VWAP specs (repo convention is per-spec helpers). | Left. |

## Test results

- **Focused:** `npx jest st-anchored-vwap indicator-registry base-indicators chart-data-adapter flex-chart`: **21 suites, 339 tests, all pass** (includes the existing flex-chart component specs, which compile the template).
- **Types:** `tsc` app and spec: **0 errors** (a transient two-error spec run was seen once mid-review, from another thread's files being edited; clean on re-run).
- **AOT:** `ng build --configuration development` passed before the two small review edits; both edits are type-checked and covered by the suites above.
- **Full suite: 3,188 passed, 2 failed (2 suites).**
  - `shared/screenshot-capture-contracts.spec.ts` — the stale `PositionType` assertion in the screenshot thread; unchanged since #869 and #870.
  - `signal-detail.component.spec.ts` — a **new** failure, **not** from this task: it expects `st-trigger-bands` entries that the Trigger Bands thread (#862) is still wiring (that spec and `signal-detail.component.ts` carry that thread's pending edits). The same single test fails identically with the Anchored VWAP registration temporarily removed (registry restored byte-identical afterwards).

**Gate deviation, stated plainly:** the review skill wants a fully green suite in gate mode. Two suites are red, both from other threads, neither attributable to #871. The verdict is scoped to #871; QA should re-run the suite.

## Verdict

**PASS** — no critical or major findings; two minor findings fixed during review, one minor finding awaiting a user decision (M3), one accepted test gap (M4), two nits left. Round 2 (below) confirmed the gap assumption from source and corrected one QA-checklist error. QA's first job is the visual check that has not yet been done.

## Round 2 (2026-10-08) — assumption check

Prompted by the question of whether round 1 was too permissive. Two things round 1 had taken on faith were checked:

1. **Gap on Line series (was unproven).** Installed `@syncfusion/ej2-charts`: `chart-series.js` `setEmptyPoint` marks a point with a null/NaN y as empty and, for mode `Gap` (and `Drop`), sets `point.visible = false` and `yData[i] = null`. `line-series.js` `render` only extends the path for visible points; for an invisible point it resets `prevPoint = null` and `startPoint = 'M'` (that reset happens unless the mode is `Drop`), so the next visible point starts a new sub-path. That is exactly the behaviour the 12-series packing needs. Not yet seen in a browser.
2. **Signal-detail menu (round 1 implied AVWAP appears there).** It does not: `signal-detail.component.ts` `activeChartIndicatorOptions` filters its option list by the per-interval `INDICATORS_BY_INTERVAL` table, and the Anchored VWAP id is not in it (Trigger Bands is, explicitly). This matches the plan (sandbox only). The QA checklist item that said the signal-detail menu offers it was wrong and has been corrected.

**Re-validation on the current tree:** `tsc` app and spec 0 errors; `npx jest st-anchored-vwap st-zigzag indicator-registry base-indicators chart-data-adapter flex-chart signal-detail`: **22 suites, 350 tests, all pass**. The `signal-detail` spec that was red in round 1 now passes: it was the Trigger Bands thread's unfinished wiring, since completed. The full suite is re-run at QA.

**Round 2 verdict: PASS stands.** No new findings against the code.
