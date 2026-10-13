**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #866  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #945  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-11  
**Last Updated:** 2026-10-11  

# Code Review — FE: ST Anchored VWAP ZigZag leg overlay + line1/line2 rename + rightDepth default (#945)

## Verdict

**PASS** — after remediation. First pass failed on 2 majors (double pivot walk, lone-anchor vertex hole); both were fixed and re-verified on the final diff. All majors/minors resolved; residual items are accepted nits.

## Scope

`st-anchored-vwap.types.ts` (`small`/`large` → `line1`/`line2`; `AnchoredVwapScale`→`AnchoredVwapSet`; leg types — `AnchoredVwapVertex`/`AnchoredVwapLeg`/`AnchoredVwapLegSet`/`AnchoredVwapResult`), `st-anchored-vwap.engine.ts` (`legsForSet`, `computeAnchoredVwapResult`, single walk per set), `st-anchored-vwap.indicator.ts` (renamed params, `rightDepth` default 2, `showZigZag`, 16 fixed series), `st-zigzag.pivots.ts`/`types.ts`/`engine.ts` (new `computeZigZagAnchorResult` + `ZigZagAnchorResult`, shared `projectionFor`), `st-zigzag.indicator.ts` (shared `boolParam`), new `indicator-params.ts` (shared `numParam`/`colorParam`/`boolParam`), `chart-data-adapter.service.ts` (16 series, per-point color theming), `flex-chart.component.html` (`[type]`/`[dashArray]`/`[pointColorMapping]` bindings), `indicator-registry.spec.ts`, the three AVWAP spec files + adapter spec, sandbox AVWAP hunks only (boolean checkbox branch, `onAvwapParam` boolean early-return, renamed controls + `showZigZag` spec), and the PRD/IMPL/TEST docs.

Unrelated working-tree WIP (Trigger Bands promotion #932, sandbox-settings #934, screenshot/order-execution chain) was excluded from the review.

## First-pass findings → remediation

| # | Sev | Finding | Resolution |
|---|-----|---------|------------|
| 1 | Major | `legsForScale` re-ran `computeZigZagPivots` per set purely for the projection — a second full walk `walkPivots` had already produced (`st-anchored-vwap.engine.ts`) | RESOLVED — new `computeZigZagAnchorResult(bars, config)` in `st-zigzag.pivots.ts:334` returns `{events, projection}` from one walk; `computeZigZagAnchorEvents` delegates (skipping the projection scan); `legsForSet` takes `(events, projection, set)` — no bars, no config, one walk per set total |
| 2 | Major | A set with a single anchor event emitted zero chain vertices — the anchor of a live VWAP line was unmarked | RESOLVED — `AnchoredVwapLegSet.vertices` carries the deduplicated anchor chain independent of leg count; builder emits one chain point per vertex; engine spec lone-anchor test + indicator spec chain test added |
| 3 | Minor | `boolParam` byte-identical to `toBool` in `st-zigzag.indicator.ts` | RESOLVED — `indicator-params.ts` exports shared `numParam`/`colorParam`/`boolParam`; both indicator files import; `toBool` deleted |
| 4 | Minor | Template branched on a type literal for `pointColorMapping` | RESOLVED — `pointColorMapping` is a series-model field (`'color'` on the MultiColoredLine chain, `''` elsewhere); `[pointColorMapping]="line.pointColorMapping"` |
| 5 | Minor | scale/set naming drift (`AnchoredVwapScale`, "two scales") | RESOLVED — `AnchoredVwapScale`→`AnchoredVwapSet`, field `scale`→`set` across types/engine/indicator/specs; header wording updated |
| 6 | Minor | Vacuous/thin leg invariants — self-referential `lastVertex` fallback, index-only vertex checks, no developing-tip causality | RESOLVED — `developing.from` deep-equals last vertex, `to.index` strictly greater; segment↔vertex alignment asserts bar always marked + price coincides when anchor survived same-bar collapse; new per-truncation developing-tip causality invariant |
| 7 | Doc | IMPL said "no second pivot run" while the code ran one | RESOLVED — the remediation made it true; doc updated to name `computeZigZagAnchorResult`, `projectionPivots: true`, and the same-bar collapse carve-out |

## Accepted / non-blocking

- Same-bar high+low collapse keeps the later event's price on the shared vertex — documented trade-off (one line series can't draw two vertices at one index); the dropped event still anchors its VWAP segment.
- `computeAnchoredVwap` kept as the segments-only public seam (TEST plan names it the highest seam) though internal callers use `computeAnchoredVwapResult`.
- `legs.find(l => l.set === set)` kept over index access — robust to ordering changes; trivial cost.
- `st-anchored-vwap.indicator.spec.ts` ≈460 lines — over the 400-line smell line; accepted for a spec file.
- Checkbox `[checked]` treats a hand-edited persisted `'false'` string as truthy — reachable only via localStorage editing; `boolParam` parses it correctly downstream.
- `indicator-registry.spec.ts`/`adapter spec` use existing repo conventions; no SDK contract drift (bindings verified against the trigger-band MultiColoredLine and ZigZag precedents).

## Spec axis — acceptance criteria

| Criterion | Verdict |
|---|---|
| Vertex per anchor event incl. `replaced` (same-bar collapse to later event documented) | Met |
| Legs connect consecutive events; same-side events continue; hue = destination side | Met |
| Developing leg: last anchor → projection; render-only; absent with zero anchors | Met |
| Every segment's `(pivotBar, price)` coincides with a vertex (collapse carve-out) | Met |
| No-lookahead extends to legs (chain prefix + developing tip) | Met |
| `showZigZag` off → leg series empty, VWAP unaffected, count stays 16 | Met |
| `line1`/`line2` rename across all public surfaces | Met |
| `rightDepth` default 2, clamp ≥ 2 preserved | Met |
| ZigZag engine semantics unchanged (registration gates, `replaced`, confirmBar) | Met — `walkPivots`/`processPivot`/`isPivotPoint`/`isValidProjection`/`findProjectionPivot` untouched; `computeZigZagPivots`/`computeZigZagAnchorEvents` outputs byte-identical; ZigZag specs pass unmodified |
| Sandbox `showZigZag` checkbox + renamed controls + override survival | Met |

## Test results

```
Test Suites: 9 passed, 9 total
Tests:       252 passed, 252 total
```

9 suites: `st-anchored-vwap.{engine,indicator,invariants}`, `st-zigzag.{engine,pivots,indicator}`, `chart-data-adapter.service`, `indicator-registry`, `flex-chart-sandbox.component`. `tsc --noEmit` clean on `tsconfig.app.json` and `tsconfig.spec.json`; `ng build --configuration development` clean.

Two full-suite failures elsewhere (`shared/screenshot-capture-contracts`, `OrderComponent`/`Functions` provider) are pre-existing unrelated working-tree WIP, not caused by this change.

## Second pass (re-review on post-remediation diff)

**Verdict: PASS** — all three axes re-ran on the final diff; no new critical or major findings.

### R2 residual fixes applied

- Weak spec oracle strengthened — the leg invariant now reads `legSet.vertices` directly instead of reconstructing the chain from `confirmed` legs (a lone-anchor set would have been invisible to the old check).
- Docstring drift corrected — remaining `scale`/`one anchor event` comment wording now matches the `set`/`vertices` model and the same-bar collapse carve-out.
- Added direct parity spec for `computeZigZagAnchorResult` in `st-zigzag.anchors.spec.ts` — asserts `{events, projection}` equals both single-purpose wrappers in one walk.

### Scope note — not a defect

Spec and thermo axes flagged the diff as bundling per-set depths, `showLine1`/`showLine2`, and a line-2 recolor (`#FFA500`/`#00C853`) beyond #945's scope. Verified: this is **task #955's implementation stacked in the same working tree** (issue exists at `5_IMPLEMENT`), not scope creep inside #945. Review verdict covers the #945 surface as it exists on disk; #955 remains its own task for its own review.

### R2 accepted nits (deferred / won't fix)

- `AnchoredVwapLegSet.vertices` + `confirmed` is derivable duplication — kept; tests and the builder both consume the precomputed forms, and recomputing legs from vertices at each call site is churn for no correctness gain.
- Same-bar collapse is render-layer logic living in the pure engine — accepted as documented design (see R1).
- `st-zigzag.pivots.ts` ≈419 lines — over the informal 300-line guideline; splitting the walk helpers is a separate refactor, not for this task.
- The 4-tuple `[set, devThreshold, leftDepth, rightDepth]` in `computeAnchoredVwapResult` is positional — a named config would read better but the #955 per-set-depths shape is mid-flight; revisit there.
- Local `scale` variable names remain in spec loop vars (cosmetic; renaming them churns files #955 is actively editing).
- One-point `MultiColoredLine` may render invisibly without markers — QA/visual verification item, carried to the QA checklist.

### R2 verification

```
Test Suites: 15 passed, 15 total
Tests:       349 passed, 349 total
```

`tsc --noEmit` clean on `tsconfig.app.json` and `tsconfig.spec.json`. Suite count includes the sandbox and ZigZag regression specs alongside the three AVWAP suites — all green with #955's per-set-depth changes interleaved in the same files.

## QA refinement — surviving-anchor chain (2026-10-11)

During `/proj qa`, visual inspection flagged the chain drawing same-side legs (high→high / low→low) — the spec'd "vertex per anchor event including `replaced`" read wrong against ST ZigZag grammar. Decision (user, option B): **vertices are surviving anchors only** — an event immediately followed by a `replaced` event drops out of the chain. Superseded anchors keep their terminated VWAP segments; only the mark is removed. Caveat accepted: the overlay is retroactive (a vertex can vanish when superseded); VWAP segments remain strictly causal.

Implementation: `legsForSet` filters events where `events[i+1]?.replaced`; same-bar collapse retained. Specs updated (superseded-anchor drop, weakened prefix invariant → "rewrite forward only"), IMPL/TEST docs synced, QA issue #954 checklist updated. 117 AVWAP tests green; `tsc` app+spec clean.
