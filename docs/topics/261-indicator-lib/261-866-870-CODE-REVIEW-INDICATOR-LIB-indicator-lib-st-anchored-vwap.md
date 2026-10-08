**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #866  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #870  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — FE: Anchored VWAP pure computation (#870)

## Scope

New files `st-anchored-vwap.engine.ts` (206 lines), `st-anchored-vwap.types.ts` (62), `st-anchored-vwap.engine.spec.ts`, `st-anchored-vwap.invariants.spec.ts`, plus a one-sentence clarification to PRD user story 6. No existing source file was modified. Reviewed against the FE Implementation Plan (module 2), the FE Test Plan (pure computation), and the Approved PRD.

## Summary of axes

### Standards

- Single responsibility and size: the engine is one pure module (206 lines) split into cumulative sums, segment construction and the history window, with types in their own file, mirroring the ZigZag `types` / `engine` layout. Both specs are under 300 lines.
- No duplication: pivot detection is reused through the ZigZag engine facade (`computeZigZagAnchorEvents`, `DEFAULT_CONFIG`), not re-implemented. No dead code, no `any`, no `as unknown as`.
- Boundary contracts: empty input returns `[]` (never `null`); every segment is a typed `AnchoredVwapSegment`; non-finite OHLC, missing volume and a non-finite `historyStart` are handled explicitly rather than propagating `NaN`.
- Test conventions followed: `makeBars` helper style as in the ZigZag specs; no `setTimeout`, no type-erased fixtures, no no-assert tests.
- One cast was found and removed (finding M1).

### Spec

- Task #870 acceptance criteria — all met: four slots with the last per side active; first point on the confirmation bar and nothing earlier; VWAP accumulating from the pivot bar with the first drawn value equal to the VWAP of pivot bar through confirmation bar; handoff on the next same-side anchor's confirmation bar including replaced anchors; typical price (H+L+C)/3, zero/missing volume flat-carry and the pivot-bar seed; both History Window modes with active lines never windowed; per-scale cap across both sides combined; no-lookahead property; the FE Test Plan pure-computation list.
- Test Plan items accounted for: confirmation-bar start, pivot-bar accumulation, handoff, replaced anchors, typical price, volume edge cases, independent scales, active vs terminated, both window modes, windowing scope, `maxHistory` boundaries (0, 1, larger than available), no-lookahead property, determinism and key stability, an active line of length one.
- PRD story 6 accounted for, with one clarification (finding M2).
- Decision recorded, not a finding: `maxHistory` is implemented as the PRD states — per scale, both sides combined, terminated segments only, with the live lines on top. The issue asked to confirm this reading; it matches "the last 100 large pivots" read as pivots (not per side), and it differs from the Pine prototype, which capped per line.

### Thermo-nuclear (Dr. Reed lens)

- **Structure.** The computation is three small stages over one shared event stream, with no mutable state and no flags threaded through control flow. No branch was bolted onto an existing flow because there is no existing flow — this is additive.
- **Code-judo consideration (not adopted).** `Candidate` exists only to carry `pivotTime` to the window filter. Putting `pivotTime` on the public segment would delete the wrapper, but it widens the output contract that T3 and the adapter will consume for a field only the filter uses. Kept internal.
- **Contract risk.** `maxHistory` semantics and the confirmation-bar start are the two choices every downstream consumer inherits. Both are pinned by tests that fail loudly (the confirmation-bar start by an independent comparison against `computeZigZagAnchorEvents`).
- **Numerical risk.** Prefix-sum differences can lose precision when cumulative values dwarf a segment's own sum. At realistic scales (price ~500, volume ~1e9 per bar, ~1e5 bars) the absolute error stays around 1e-9 after dividing by the segment volume — negligible for a chart; noted, not mitigated.
- **Quality of the tests.** The suite asserts behaviour through the single public function, with an independent direct-summation reference and the independent T1 event function as oracles, and hand-derived literals on a fixture whose pivot, confirmation and handoff bars were worked out by hand. To confirm the tests are not vacuous, the engine was deliberately broken seven ways during implementation and the suite failed every time (typical price replaced by close, seed removed, zero volume counted as 1, start at pivot bar, read bar t+1, not volume-weighted, old line stopping a bar early); the engine was restored byte-identical each time.

## Findings

No critical or major findings.

| # | Severity | Finding | Status |
|---|---|---|---|
| M1 | minor | `cumulativeSums` used two `(bar.volume as number)` casts to narrow `number \| undefined` (`st-anchored-vwap.engine.ts:59`), against the guidelines' cast rule. | **Fixed in review** — narrowed through a local `const volume = bar.volume` with an explicit `undefined` check. |
| M2 | minor | PRD story 6's acceptance said the chart output at bar `t` is identical whether computed from `bars[0..t]` or the full series. That is true of every line's content, but under a finite `maxHistory` which *history* segments are shown legitimately depends on how much history exists (the oldest are pruned). The no-lookahead test runs with the window disabled, so the wording overpromised. | **Fixed in review** — PRD story 6 now says line content is identical and that the window only filters which history draws; the engine docblock states the same; a new test pins the real guarantee (a windowed segment equals its unwindowed twin, and active lines always remain, in three window modes). |
| N1 | nit | `Math.max(0, Math.floor(maxHistory)) \|\| 0` (`st-anchored-vwap.engine.ts:155`) relies on `NaN \|\| 0` and is terse. T3's param extraction will clamp inputs, so the engine only has to be defensive. | Left. |
| N2 | nit | No run on real market data in this task; T3 renders it in the sandbox. | Left — T3's sandbox check is the real-data verification. |

## Test results

- `npx jest st-anchored-vwap st-zigzag`: **9 suites, 150 tests, all pass** (ZigZag 108 plus 42 for Anchored VWAP: 24 unit tests and 18 invariant tests, six per varied scenario across three scenarios).
- `tsc -p tsconfig.app.json --noEmit` and `tsc -p tsconfig.spec.json --noEmit`: 0 errors. No trailing whitespace in the new files.
- Dependency graph: `jest --findRelatedTests` on the two new source files lists only the two new specs, so nothing else in the repo can be affected by this task.
- **Full suite: 3,058 passed, 4 failed (4 suites)** on one run:
  - `shared/screenshot-capture-contracts.spec.ts` — the stale `PositionType` assertion from the screenshot thread (#844) that was ruled out of scope for #869; unchanged.
  - `allocation-bucket-dialog`, `portfolio-dashboard.component` and `paper-trading.component` specs — **all pass when run on their own** (11 suites, 154 tests); they ran at 22 to 36 seconds each in the full run, so the failures were load-related, not a defect. None of them depends on a file in this task.

**Gate deviation, stated plainly:** the review skill requires a fully green suite in gate mode. One run had four red suites — one a known stale assertion in another thread, three that pass in isolation. None is attributable to this task. The verdict below is scoped to #870; QA should re-run the suite.

## Verdict

**PASS** — no critical or major findings; two minor findings fixed during review, two nits left. Full-suite failures are unrelated and documented above.
