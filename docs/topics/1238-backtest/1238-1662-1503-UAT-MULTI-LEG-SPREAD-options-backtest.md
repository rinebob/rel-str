**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1662  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1503  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1503 legacy simulator deprecation note

## Scope

Comment-only deprecation per IMPL §7: an `@deprecated` JSDoc marker on
`runBacktestSimulation` (`backtest-simulator.ts`) and on its deployed
entry point, the `stBacktestPermutation` task-queue callable
(`backtest-worker.ts`) — both naming the superseding surface (Selection
Replay + Backtest Analytics, Threads #1240/#1266/#1270) and the policy
("retained for reference — do not extend"). No behavioral change.

Acceptance criteria covered:

1. Comment present on simulator + callable entry
2. No callers removed or changed

Plus review remediations: `docAbove()` adjacency guarantee (r1 minor —
leftmost-match false-positive channel) and the callable's `@deprecated`
check (r1 minor).

## Prerequisites

- Repo `C:\aa\projects\rel-str` on branch `prod`, deps installed.
- No credentials, env vars, or services required — every scenario is
  static source assertion or local test.
- Commands run from `C:\aa\projects\rel-str\functions` unless noted.

## Getting to the feature

No user-facing route exists — this is a source-comment change on two
backend files. The "feature" is observable in the source itself:
`functions/src/st-cloud-function/backtest/backtest-simulator.ts:123` and
`functions/src/st-cloud-function/backtest/backtest-worker.ts:26`, and via
the verify script. All scenarios are command-line.

## Automated evidence

| Suite | Command | Expected |
|---|---|---|
| Verify DRY | `cd functions && npx tsx scripts/verify/options-simulator-deprecation-1503.ts` | 14/14 |
| st-cloud-function specs | `cd functions && npx tsx --test ../tests/functions/st-cloud-function/*.test.ts` | 17/17 |
| Functions build | `cd functions && npm run build` | clean |
| Diff audit | `git diff functions/src/st-cloud-function/backtest/` | comment-only additions |

## Scenarios

### S1 — Marker on `runBacktestSimulation`

- **Confirms:** AC1, first surface.
- **Steps:** `cd functions && npx tsx scripts/verify/options-simulator-deprecation-1503.ts`
  — section `— Superseded marker on runBacktestSimulation —`.
- **Expected:** 5 OK lines — JSDoc directly above the export; names the
  superseding surface ("superseded by Selection Replay + Backtest
  Analytics"); names Threads `#1240`/`#1266`/`#1270`; states the policy
  ("retained for reference", "do not extend"); carries `@deprecated`.
- **Result/evidence:** PASS — 5/5 OK lines in the verify run (14/14 total), 2026-11-22

### S2 — Marker on `stBacktestPermutation` callable

- **Confirms:** AC1, second surface (the simulator's only deployed entry —
  sole invoker `backtest-worker.ts:87`, re-exported `index.ts:101`).
- **Steps:** same script — section `— Superseded marker on
  stBacktestPermutation callable —`.
- **Expected:** 5 OK lines — same content assertions on the comment
  directly above the callable export.
- **Result/evidence:** PASS — 5/5 OK lines incl. the callable deprecated-tag check

### S3 — No callers removed or changed

- **Confirms:** AC2.
- **Steps:**
  1. Same script — section `— No callers removed or changed —` (worker
     import, worker invoke, simulator signature head, `index.ts`
     re-export).
  2. `git diff functions/src/st-cloud-function/backtest/` — every `+`
     line is a comment line (`* `), zero non-comment changes.
- **Expected:** 4 OK lines + a comment-only diff.
- **Result/evidence:** PASS — 4/4 caller pins OK; git diff audit = comment-only (every added line is a comment line — zero code deltas)

### S4 — Adjacency guarantee (r1 remediation proof)

- **Confirms:** the `docAbove()` fix — a marker living only in the file
  header cannot satisfy the checks when the function's own doc is absent.
- **Steps:** run the in-repo sabotage probe — strip the function's JSDoc
  and plant the marker text in the file header, then evaluate `docAbove`.
  (Probe snippet recorded in the review doc's findings; re-executable via
  node -e against `docAbove` in the verify script.)
- **Expected:** real file → doc found; sabotaged file → `null` (checks
  fail), not a false positive.
- **Result/evidence:** PASS — real file to doc found (function JSDoc only); sabotaged file (marker planted in file header + fn doc deleted) to null, checks fail correctly. No false positive.

### S5 — Regression + build

- **Confirms:** nothing else broke.
- **Steps:** `npx tsx --test ../tests/functions/st-cloud-function/*.test.ts`
  from `functions/`; `npm run build` from `functions/`.
- **Expected:** 17/17 specs pass; build emits `lib/index.js` cleanly.
- **Result/evidence:** PASS — 17/17 st-cloud-function specs (tsx --test); npm run build clean (lib/index.js 2.1mb, 85ms)

## Manual UI/UX refinement pass

Not applicable — comment-only change on two backend source files; no UI
surface exists or was touched.

## Findings

- None during implementation or review beyond the two r1 minors
  (remediated in-cycle, proven in S4).

## Traceability

| Requirement | Scenario |
|---|---|
| AC1: comment on simulator + callable entry | S1, S2 |
| AC2: no callers removed or changed | S3 |
| r1 minor: `docAbove` adjacency guarantee | S4 (verify-section checks in S1/S2 exercise it; sabotage probe proves it) |
| r1 minor: callable `@deprecated` check | S2 |
| Regression | S5 |

## Regression / smoke

- [x] `stBacktestPermutation` still exported from `index.ts` (S3)
- [x] Worker still imports + invokes `runBacktestSimulation` (S3)
- [x] Simulator signature unchanged (S3)
- [x] st-cloud-function specs green (S5)
- [x] Functions build clean (S5)

## Verdict

**PASS** — all 5 scenarios green; both ACs covered; both r1 minors proven remediated.

## Results log

| Date | Scenario | Result | Evidence |
|---|---|---|---|
| 2026-11-22 | S1 marker on runBacktestSimulation | PASS | verify 14/14 — section 1 all OK |
| 2026-11-22 | S2 marker on stBacktestPermutation | PASS | verify 14/14 — section 2 all OK |
| 2026-11-22 | S3 no callers removed or changed | PASS | 4/4 pins OK; git diff comment-only |
| 2026-11-22 | S4 adjacency sabotage probe | PASS | real→doc found; planted-header→null |
| 2026-11-22 | S5 regression + build | PASS | 17/17 specs; build clean |
| 2026-11-22 | Refinement pass | N/A | no user-facing surface |
