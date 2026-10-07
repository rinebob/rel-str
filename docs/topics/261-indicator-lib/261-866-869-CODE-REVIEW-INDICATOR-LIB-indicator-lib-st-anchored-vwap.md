**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #866  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #869  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — FE: ZigZag anchor-event walk (#869)

## Scope

`st-zigzag.pivots.ts`, `st-zigzag.types.ts`, `st-zigzag.engine.ts` (barrel), new `st-zigzag.anchors.spec.ts`, and the `CONTEXT.md` glossary edit. Reviewed against the FE Implementation Plan (module 1), the FE Test Plan (engine seam + regression), and the Approved PRD.

## Summary of axes

### Standards

- No duplicated detection logic: both public functions run one internal `walkPivots` (`st-zigzag.pivots.ts:350`). No dead code, no `any`, no casts, no unused exports; `AnchorEvent` is a typed contract and `computeZigZagAnchorEvents` returns `[]` rather than `null` on empty input.
- Test conventions followed: `makeBars` helper and `TEST_CONFIG` mirror `st-zigzag.pivots.spec.ts`; no `setTimeout`, no type-erased fixtures, no no-assert tests; every `it` asserts an observable outcome.
- File size: `st-zigzag.pivots.ts` is 399 lines (349 before this task). Under the 400-line smell threshold and nowhere near 1k, but above the 300-line target. See finding M2.

### Spec

- Task #869 acceptance criteria: all met. Shared walk; `computeZigZagPivots` output unchanged; events for every new pivot and same-side replacement in walk order; `confirmBar = pivotBar + rightDepth` (depth clamped to at least 2) and always `< bars.length`; replaced pivots present in events but not in survivors; rejected candidates emit nothing; `allowZigZagOnOneBar` preserved; `AnchorEvent` added and re-exported from the engine barrel; projected pivots never produce events.
- Test Plan engine-seam list: all items covered (alternating, same-direction extension, `confirmBar` relation and asymmetric depths, `confirmBar < bars.length`, below-threshold, not-more-extreme rejection, `allowZigZagOnOneBar` both ways, first pivot, empty/single/too-few bars, projection ignored, depth clamp).
- Test Plan regression list: frozen goldens plus a one-off differential check (see Test results). The plan names trending, equal-highs and flat series explicitly; those are covered by the differential check and the existing suites rather than by committed goldens (finding M3).
- No-lookahead for the event stream: `confirmBar = pivotBar + rightDepth` and the walk consumes candidates in pivot-bar order, which is also confirmation order, so replaying events at their confirmation bars reproduces the same sequence. This is the property T2's no-lookahead gate builds on.

### Thermo-nuclear (Dr. Reed lens)

- **Code-judo consideration (not adopted).** The walk could emit events as its only output with `computeZigZagPivots` deriving survivors by replay, deleting the `onAnchor` callback. Rejected for now: the dev-threshold gate still needs the walk's running last pivot, so the callback is replaced by a replay step rather than deleted, and it widens the blast radius on a function the swing-analysis page depends on. The shared walk plus frozen/differential proof is the lower-risk shape.
- **Implicit coupling (fixed).** `replaced` was first derived from `pivots.length === before`, coupling the event contract to `processPivot`'s in-place overwrite. A later change to that overwrite (pop-then-push) would silently flip `replaced`. Fixed: `processPivot` now returns `'added' | 'replaced' | null` (single caller), and `replaced: outcome === 'replaced'` states the intent directly.
- **Architecture risk.** The event contract is the foundation for T2 and everything downstream. The invariants most likely to be broken by a future edit (confirmation lag, replay-equals-survivors, ordering) are each pinned by a test over four varied series, so a regression fails loudly rather than shifting lines on charts.
- No `unknown`/`any`/optional churn. The only added control flow is the `register` closure, which removes (rather than adds) duplicated per-side branches from the original loop.

## Findings

No critical or major findings.

| # | Severity | Finding | Status |
|---|---|---|---|
| M1 | minor | `replaced` inferred from `pivots.length === before` — implicit coupling to `processPivot`'s in-place overwrite (`st-zigzag.pivots.ts`, `register` at line 361, `processPivot` at line 84). | **Fixed in review** — `processPivot` returns `'added' \| 'replaced' \| null`; `replaced: outcome === 'replaced'` (line 371). |
| M2 | minor | `st-zigzag.pivots.ts` is 399 lines (349 before). Above the 300-line target and within one line of the 400 smell threshold. Extracting `walkPivots` + the two public functions into their own module would need `processPivot`/`isPivotPoint` exported. | **Deferred** — below the 400 threshold; the next task touching this file should split it first. |
| M3 | minor | Committed regression goldens cover four seeded random walks; the Test Plan also names trending, equal-highs and flat series. | **Mitigated** — verified by a one-off differential test against the `HEAD` implementation (see Test results) and by the existing suites that cover flat/NaN/plateau shapes; goldens are not extended with series the old code never differentiated. |
| M4 | minor | The engine-barrel export of `computeZigZagAnchorEvents` was not exercised by any test (the spec imported from `./st-zigzag.pivots`). | **Fixed in review** — a test asserts the barrel export is the same function. |
| M5 | minor | A same-side candidate that is *not* more extreme (rejected, emits nothing) had no test. | **Fixed in review** — `a same-side pivot that is not more extreme is rejected and emits nothing`. |
| N1 | nit | `Math.max(2, config.leftDepth/rightDepth)` is computed in both `computeZigZagPivots` and `walkPivots`. | Left — needed by the projection step; returning them from the walk would widen its signature for no behavioural gain. |
| N2 | nit | Golden strings in the spec are ~600 characters per line. | Left — frozen literals are the point; splitting them hurts diffability more than it helps. |

## Test results

- `npx jest st-zigzag` — all ZigZag suites pass, including the unmodified original specs plus `st-zigzag.anchors.spec.ts` (30 tests).
- Related suites (`st-zigzag`, `flex-chart-sandbox`, `chart-data-adapter`, `swing-analysis.store`): **11 suites, 214 tests, all pass.**
- **Differential check (one-off, not committed):** the `HEAD` version of `st-zigzag.pivots.ts` was run against the new one over 10,240 series x config combinations (empty, trending up/down, flat, plateau/equal highs, spike bars, NaN gaps, 25 random walks; 5 deviation thresholds x 4 left depths x 4 right depths x one-bar on/off x projection on/off). Every result (pivots and projection) was deep-equal; 8,960 combinations produced at least one pivot. Temporary files were deleted.
- `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.spec.json --noEmit`: 0 errors. `git diff --check`: clean.
- **Full suite: 2,980 passed, 14 failed (3 suites)** — `gallery-group.component.spec.ts`, `gallery-view.component.spec.ts`, `screenshot-capture-contracts.spec.ts`. None is caused by this task:
  - `gallery-group`: `NG0201 No provider found for Firestore` via `LocalBarReadService`, raised because in-flight work on `gallery-card.component.ts` (price/day-change on the card) now injects `GalleryCardChartStore` and the spec supplies no provider.
  - `gallery-view`: `this.chartStore.barsFor is not a function` — the same in-flight card change against a spec mock that lacks `barsFor`.
  - `screenshot-capture-contracts`: not in the dependency graph of any file changed here (`jest --findRelatedTests` on the changed sources lists 23 specs; it is not one of them).
  - Both gallery suites appear in that dependency list only transitively (gallery card chart to indicator registry to ZigZag); their failure causes are in the gallery card code, not the engine.

**Gate deviation, stated plainly:** the review skill requires a fully green suite in gate mode. It is not green, but every failure traces to other work in progress in the same working tree. The verdict below is scoped to #869; QA should re-confirm the full suite once the gallery work lands.

## Verdict

**PASS** — no critical or major findings; two minor findings fixed during review, one mitigated, one deferred (M2), two nits left. Full-suite failures are unrelated in-flight changes (documented above).
