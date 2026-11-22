**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1503  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Code Review — BE Task: Legacy simulator deprecation note (#1503)

## Verdict

**PASS** — r1 surfaced 2 minor findings (both axes independently flagged
the same two), both remediated in-cycle and re-verified; Standards clean,
Spec MET on both acceptance criteria, Thermo-nuclear APPROVE-WITH-NITS
with no blockers.

## Change summary

Comment-only deprecation per IMPL §7: `@deprecated` JSDoc on
`runBacktestSimulation` (`backtest-simulator.ts`) and on its deployed
entry point, the `stBacktestPermutation` task-queue callable
(`backtest-worker.ts`) — both naming the superseding surface (Selection
Replay + Backtest Analytics, Threads #1240/#1266/#1270) and the policy
("retained for reference — do not extend"). New static verify script
`options-simulator-deprecation-1503.ts` (14 checks: marker presence +
content on both surfaces with strict adjacency, plus caller-unchanged
pins) + guide `.md` + registrations (`run-all.ts`, both verify READMEs).
No behavioral change.

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| Comment present on simulator + callable entry | MET | `backtest-simulator.ts:123-128` (JSDoc directly above `runBacktestSimulation`); `backtest-worker.ts:26-30` (JSDoc directly above `stBacktestPermutation` — confirmed the simulator's only deployed entry: sole invoker `backtest-worker.ts:87`, exported via `index.ts:101`) |
| No callers removed or changed | MET | `git diff` on `backtest/` is comment-only; worker import (:15), invocation (:87-96), signature head, and `index.ts` re-export all pinned by the verify script |

## Findings (r1 → disposition)

**Minor — remediated in-cycle:**

1. `docAbove()` didn't deliver its documented adjacency guarantee — lazy
   `exec` anchored the match at the *first* `/**` in the file, so the
   "doc" spanned the file header through the declaration; marker phrases
   could have false-positived from unrelated earlier comments (Standards
   M1 = Thermo F1). → Fixed: search pins `head.lastIndexOf('/**')` and
   full-matches the tail to the declaration. Proven by sabotage probe:
   marker planted in the file header with the function doc deleted now
   correctly returns null (previously would have passed).
2. Callable section omitted the `@deprecated` tag check the sim section
   had, and the guide's "Same assertions" was untrue 4-vs-5 (Standards
   M2 = Thermo F2). → Fixed: 14th check added; guide updated to 14 checks.

**Nits — judged, no change:**

- F3 "task-queue callable" vs strict `onCall` vocabulary — kept: repo
  convention and the task's own AC language ("callable entry") use
  "callable" loosely for deployed entry functions.
- F4 "retained for reference" understates live-serving status — kept:
  it is the IMPL doc's prescribed text verbatim; recorded as a wording
  suggestion for the deferred retirement task.
- F5 `See runBacktestSimulation` pointer — dropped (import sits two
  lines up; the marker already names the successor surface).
- `@deprecated` placement divergence between the two blocks — kept:
  tag-after-description is correct JSDoc when extending an existing
  block; archive.ts puts it first only because those blocks are pure
  deprecation notes.
- `check()` `detail` param unused — kept: sibling-convention signature.
- F7 no marker on `stBacktestStart` (the `onCall` orchestrator entry) —
  out of scope per IMPL §7 verbatim ("one comment block on
  `runBacktestSimulation` + its callable"); flagged as a suggestion for
  the deferred retirement task.
- Check-name "comment"→"JSDoc" imprecision — fixed while in-file.

## Test results

- Verify script: **14/14 DRY** (static source assertions, no env)
- `tests/functions/st-cloud-function/*.test.ts`: **17/17** (tsx --test)
- `npm run build` (functions): clean
- No spec files reference the simulator directly; comment-only diff
  cannot regress behavior — the caller-unchanged pins are the regression
  surface.

## Pass protocol

```text
First pass complete — 3 axes run in parallel: Standards clean w/ 2 minors
+ 4 nits; Spec all-ACs MET + info notes; Thermo APPROVE-WITH-NITS
Second pass complete — F1 + F2 fixed in-cycle, F1 proven via sabotage
probe; nits judged (kept/dropped with reasoning); 14/14 verify, 17/17
specs, build clean
Convergence: PASS — no criticals/majors; all minors remediated + verified
```
