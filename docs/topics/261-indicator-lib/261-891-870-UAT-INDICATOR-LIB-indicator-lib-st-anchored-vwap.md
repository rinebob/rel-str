**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #891  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #870  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — FE: Anchored VWAP pure computation (#870)

## Scope

Task #870 adds `computeAnchoredVwap(bars, config)`, a pure function that turns two scales of ZigZag anchor events into Anchored VWAP line segments: each line is drawn from its anchor's **confirmation bar** (never back to the pivot bar), accumulates `hlc3 x volume` from the **pivot bar**, ends on the next same-side anchor's confirmation bar (replaced anchors included), carries flat across missing volume, and is filtered by the History Window in both modes.

It has **no user-facing surface of its own** — nothing renders it until T3. This UAT therefore confirms the function's contract and its guarantees by running it, and shows that the tests would catch a wrong implementation. The visual, real-data check belongs to T3 (sandbox).

Covers Task #870 acceptance criteria, the FE Implementation Plan (module 2), the FE Test Plan (pure computation) and PRD user stories 1 to 3, 5, 6, 8 to 11 (the computation side; rendering stories 12 to 13 belong to T3 and T4).

## Prerequisites

- Repo `C:\aa\projects\rel-str`, branch `prod`, dependencies installed (`npm install`).
- The #870 files are present (uncommitted is fine): `st-anchored-vwap.engine.ts`, `.types.ts`, `.engine.spec.ts`, `.invariants.spec.ts` under `src/app/features/shared/components/flex-chart/indicators/`.
- Task #869 (the ZigZag anchor-event walk) is shipped; the function depends on it.
- No secrets, services, accounts or feature flags are needed.

## Start instructions

All scenarios run from the repo root in PowerShell. Scenario 5 temporarily edits the engine file and restores it; do it on a clean copy or be ready to `git checkout` the file if interrupted.

## Scenarios

### 1. Lines, handoffs, volume and history window — unit contract (automated)

- **Confirms:** the function draws what the contract says on a 31-bar fixture whose pivot, confirmation and handoff bars were worked out by hand, plus the typical-price, volume and history-window rules.
- **Steps:** `npx jest st-anchored-vwap.engine`
- **Expected:** all pass. Includes: four slots with the last line per side active; every first point on the confirmation bar; contiguous points; handoff on the next anchor's confirmation bar; a replaced-anchor chain at the 25% scale; the first drawn value equal to the VWAP of pivot bar through confirmation bar (116); volume weighting (114.4); (H+L+C)/3; zero and missing volume carrying flat; the pivot-bar seed when no volume has accumulated; non-finite closes never producing non-finite values; an active line of one point on the final bar; both history-window modes, the per-scale combined cap, and active lines never windowed.
- **Result:** PASS — 1 suite, 24/24 (2026-10-07).

### 2. Independent oracles and no-lookahead — invariants (automated)

- **Confirms:** the output agrees with independent sources of truth on varied random-walk series (random volume including zero-volume bars), and never looks ahead.
- **Steps:** `npx jest st-anchored-vwap.invariants`
- **Expected:** all pass for each of three scenarios (different thresholds and depths): both scales and both sides produce lines; every line starts on the confirmation bar reported by the independent `computeZigZagAnchorEvents`; handoffs match the next anchor and the last line is active to the final bar; every point matches a direct-summation VWAP reference (a different algorithm from the engine's prefix sums); the History Window is a pure filter (a windowed segment equals its unwindowed twin and active lines remain); and the output from `bars[0..t]` equals the full output restricted to bars up to `t` at every sampled `t`.
- **Result:** PASS — 1 suite, 18/18 (2026-10-07).

### 3. The ZigZag engine underneath is unchanged (automated)

- **Steps:** `npx jest st-zigzag`
- **Expected:** all ZigZag suites pass.
- **Result:** PASS — 7 suites, 108/108 (2026-10-07).

### 4. Type safety (automated)

- **Steps:** `npx tsc -p tsconfig.app.json --noEmit` and `npx tsc -p tsconfig.spec.json --noEmit`
- **Expected:** no errors.
- **Result:** PASS — 0 errors in both (2026-10-07).

### 5. The tests are not vacuous — deliberate breakages (automated, temporary edits)

- **Confirms:** a wrong implementation fails the suite.
- **Steps:** one at a time, make each edit to `st-anchored-vwap.engine.ts`, run `npx jest st-anchored-vwap`, then restore the original. Edits: (a) typical price replaced by close; (b) remove the typical-price seed; (c) count zero/missing volume as 1; (d) start lines at the pivot bar; (e) read bar `t+1`; (f) drop volume weighting; (g) stop the old line one bar before the next confirmation bar; (h) in unset mode keep the oldest segments; (i) ignore `historyStart` eligibility.
- **Expected:** every edit makes at least one test fail; the restored engine passes 42/42.
- **Cleanup:** restore the engine byte-identically and re-run the suite.
- **Result:** PASS (2026-10-07). Failing tests per breakage, of 42: typical=close 5; no seed 1; zero volume as 1 7; start at pivot bar 15; reads t+1 11; unweighted 7; stops early 6; keeps oldest 2; date ignored 2. Engine restored byte-identical (verified), 42/42 after restore.

### 6. Full repository test suite (automated)

- **Confirms:** nothing anywhere in the repo is broken by this task.
- **Steps:** `npx jest --coverage=false`
- **Expected:** all pass.
- **Result:** PASS (scoped to this task) — 197 of 198 suites and 3,070 of 3,071 tests pass. The single failure is `shared/screenshot-capture-contracts.spec.ts › PositionType › is limited to stock in this thread`, a stale assertion in another thread's code (it expects `['stock']` but the screenshot thread's #844 added three more values). It is not in the dependency graph of any #870 file (`jest --findRelatedTests` lists only the two #870 specs), and the user ruled it out of scope earlier (2026-10-07). The three suites that failed on load during the code review (allocation-bucket-dialog, portfolio-dashboard.component, paper-trading.component) passed in this run.

### 7. Refinement pass

- **Result:** Not applicable — no user-facing surface (pure computation). The real-data visual check happens when T3 renders the lines in the flex-chart sandbox.

## Negative / edge scenarios

Covered by scenarios 1 and 2 rather than manual steps: empty bars; too few bars to confirm a pivot; a flat series with no pivots; only one side having pivots; zero, missing and non-finite volume; non-finite closes; `maxHistory` of 0, 1 and larger than available; a `historyStart` after every pivot; a non-finite `historyStart`; an active line of length one.

## Traceability

| Task #870 acceptance criterion | Scenario |
|---|---|
| Four slots; last per side active, rest terminated | 1, 2 |
| First point on the confirmation bar; nothing earlier | 1, 2, 5 (d) |
| VWAP accumulates from the pivot bar; first drawn value | 1, 2 |
| Handoff on the next anchor's confirmation bar; replaced anchors drawn | 1, 2, 5 (g) |
| (H+L+C)/3; volume flat-carry; pivot-bar seed | 1, 2, 5 (a to c, f) |
| History Window both modes; active lines never windowed | 1, 2, 5 (h, i) |
| `maxHistory` per scale, both sides combined | 1 |
| No-lookahead property | 2, 5 (e) |
| FE Test Plan pure-computation tests pass | 1, 2 |
| (Regression) ZigZag engine unaffected; repo healthy | 3, 4, 6 |

## Regression / smoke checklist

- [x] T1 ZigZag specs green (scenario 3)
- [x] Typecheck clean (scenario 4)
- [x] Full suite has no failure attributable to this task (scenario 6)
- [x] Engine file restored after the breakage checks (scenario 5)
