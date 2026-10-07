# Code Review — ST Trigger Bands engine (#876)

**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Implement ST Trigger Bands in ST Indicator Library  
**Thread Slug:** st-trigger-bands  
**Issue:** #874  
**Thread Parent:** #862  
**Topic Parent:** #261  
**Task:** #876  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

## Verdict: **PASS**

Standards **PASS** · Spec **PASS** · Thermo-nuclear **PASS**. No critical or major findings; four minors/nits recorded below. Reviewed inline (no sub-agents), against `261-862-863-PRD`, the BE IMPL plan and the BE TEST plan.

## Scope

- `functions/src/indicators/st-trigger-bands.ts` (new, 106 lines)
- `tests/functions/st-trigger-bands.test.ts` (new, 21 cases)
- `functions/scripts/verify/indicator-lib-876-engine.ts`, `indicator-lib-876.md`, plus `README.md` index row and `run-all.ts` registration

## Standards

- Pure module, no Firebase imports, takes the sibling `OHLCV` type, same shape and header style as `st-trend-bands.ts` / `std-dev-lines.ts`. Single responsibility; one exported function and one constant plus the result interface.
- Test file follows `tests/functions/std-dev-lines.test.ts` (node:test + `node:assert/strict`, hand-worked literals, no mocks).
- Verification script follows `indicator-lib-268-engine.ts`: real Firestore bars, numbered checks, guide + README index + `run-all` registration.
- No dead code, no commented-out code, no `any` / type-erased fixtures. `tsc --noEmit` and `npm run build` clean.

## Spec

| Acceptance criterion (#876) | Result |
|---|---|
| Returns `upper`, `lower` and the six flag arrays, one entry per bar | Met (`every output array has the input length`) |
| Body-based length-3 bands; `null` for the first two bars; null comparisons false | Met |
| Crossover previous-bar term against `upper[t-2]` / `lower[t-2]` as Pine | Met, implemented literally (see finding 3) |
| State latches, clears on breakout | Met; "pullback wins" is unreachable (breakout needs a rising band) and is asserted as an invariant in the verify script |
| Unit tests per BE test plan, written red first | Met: 21 cases (golden fixture, wick-vs-body, doji, flat market, re-arm, equal-to-band, no-prior-pullback, 3 mirror-symmetry sets) |
| Verification script prints bands and flags for a real symbol | Met: SPY, 1,823 bars, 18/18 checks incl. exact agreement with an independent reference |
| `cd functions && npm run build` | Met |

BE test-plan items for the callable (`triggerBands` presence, dot markers, filtering, regression) belong to #877 and are not in this task's scope.

## Thermo-nuclear

- Tests assert external behavior (flag arrays for known inputs), not internals. The mirror test is a genuine property check (long flags of a series equal short flags of its price-negation) that exercises the short side without a second set of hand-worked numbers.
- The verification script deliberately re-implements the flags naively; that duplication is the point (independent oracle), not a smell.
- No abstraction leaks: the engine takes bars and returns arrays; wiring into the callable's `TriggerBandsPoint` is left to #877.

## Findings

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Minor | `st-trigger-bands.ts` L75-93: the `t > 0 &&` guards on the crossover, breakout and state-carry expressions are partly redundant in value (`up2` is null for `t < 2`, so those comparisons are already false); they mainly keep the `t - 1` indexing explicit and the arrays strictly boolean at `t = 0`. | Accepted; harmless, keeps `t-1` indexing explicit. |
| 2 | Minor | NaN bar values (`open`/`close` NaN) would produce `NaN` bands rather than `null`; flags stay false because NaN comparisons are false. Real bars are normalized upstream and the verify script maps missing values to 0. | Defer to #877: map non-finite bands to `null` with the callable's existing `toNullable` when building `TriggerBandsPoint`. |
| 3 | Info | Given the `upper[t-2] >= upper[t-1]` gate, the crossover's previous-bar term is always true, and a breakout can never share a bar with a pullback. | Plans updated (BE IMPL risk note, BE TEST plan); engine kept literal to Pine. |
| 4 | Nit | `README.md` order list in `scripts/verify` is numbered by arrival (item 20), not by task number, matching how #844 was appended. | Accepted. |

## Test results

- `npx tsx --test ../tests/functions/st-trigger-bands.test.ts ../tests/functions/std-dev-lines.test.ts ../tests/functions/signal-detection-zero-cross.test.ts` (from `functions/`): **74/74 pass** (new 21 + existing indicator/signal suites).
- `npx tsc --noEmit -p .` and `npm run build` (functions): clean.
- `npx tsx scripts/verify/indicator-lib-876-engine.ts SPY`: **18/18** checks (real data, 2026-10-07).
- Not run: the repo-level Jest suite (FE) and `run-all.ts` (other tasks' scripts need unrelated credentials); this task touches only `functions/` and the verify index.
