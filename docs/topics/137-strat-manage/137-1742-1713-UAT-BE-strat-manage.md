**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1742  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1713  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# UAT: #1713 — per-tick shadow-eval + first-fire accumulation

## Scope

Per-tick shadow exit-eval inside the unified mark pass. Task ACs:

- **AC1** — all 6 `EXIT_STRATEGIES` evaluated on each tick's net mark per
  open position (scope carve-out: positions without `strategyInstanceId`
  and share-leg positions skipped + counted — documented, spec'd)
- **AC2** — `AnalysisResultDoc` records gain `firstFiredAt` + fired mark;
  idempotent across ticks and restarts
- **AC3** — analytics-only: nothing closes positions

Plus the accumulation contract from TEST doc US-6 / "Analysis-doc merge":
tick writes merge into the `{instanceId}_{exitId}` docs the EOD scan owns
without clobbering its shape; the scan carries `firstFired*` forward on
rebuild; terminal outcomes frozen; re-cross resolves at the ORIGINAL fire.

## Prerequisites

- Repo checkout on `prod` with the uncommitted #1713 files present
  (`functions/src/paper-trading/engine/passes/shadow-eval-pass.ts`,
  `options-strategy-pass-orchestrators.ts`,
  `passes/{mark-pass,manage-exit-scan-pass}.ts`,
  `options-strategy-engine/passes/shadow-eval-pass.ts` shim,
  `shared/options-analysis-contracts.ts`, the four spec files,
  `functions/package.json`,
  `scripts/verify/strat-manage-shadow-eval-1713.{ts,md}` + registration,
  `scripts/verify/strat-manage-mark-pass-1712.ts` regression repair).
- `npx tsx` on PATH; `npm --prefix functions` for the canonical gate.
- No RH MCP session, Firestore credentials, or dev server needed — all
  verification injects fakes through the deps seams.

## Getting to the feature

No UI surface — a backend pass fused into the 30-min mark cron. QA
acceptance is at the contract/verification level: per-tick evaluation,
first-fire accumulation semantics, doc-merge parity with the EOD scan,
error isolation, orchestrator wiring. All verification is command-line
from the repo root.

## Scenarios

### S1 — Verify script passes standalone

- **Confirms:** end-to-end pass over production code with faked deps —
  record construction, first-fire stickiness, re-cross resolution, doc
  merge shape, carry-forward, skip paths, orchestrator + scan seams.
- **Steps:** `npx tsx scripts/verify/strat-manage-shadow-eval-1713.ts`
- **Expected:** every check prints `OK   name: value`, ends
  `ALL CHECKS PASSED`, exit 0. Covers: record entryMark in
  order-price space, contractId = trade id, all-6-rule docs written,
  firstFiredAt/firstFiredMark stamped + sticky, re-cross resolves at
  original fire, unmarked records carry forward, no-instance skip,
  multi-expiry error records, eval failure → `evalError` envelope, scan
  rebuild preserving firstFired*.
- **Result:** ☒ PASS — 37 OK checks, `ALL CHECKS PASSED`, exit 0
  (2026-11-24)

### S2 — Task spec files green

- **Confirms:** the new pass spec (17 specs) + updated consumer specs
  under `node:test`.
- **Steps:**
  `npx tsx --test tests/functions/options-strategy-engine/shadow-eval-pass.test.ts tests/functions/options-strategy-engine/options-strategy-passes.test.ts tests/functions/options-strategy-engine/manage-exit-scan-pass.test.ts tests/functions/options-strategy-engine/mark-pass.test.ts`
- **Expected:** `pass 69`, `fail 0`.
- **Result:** ☒ PASS — `tests 69 / pass 69 / fail 0` (2026-11-24)

### S3 — Canonical gate runs the specs

- **Confirms:** all four spec files execute inside `test:paper-trading`
  (includes the review-round registration of the previously-orphaned
  `manage-exit-scan-pass.test.ts`).
- **Steps:** `cd functions && npm run test:paper-trading`
- **Expected:** `pass 520`, `fail 0`.
- **Result:** ☒ PASS — `tests 520 / pass 520 / fail 0` —
  `manage-exit-scan-pass.test.ts` + `shadow-eval-pass.test.ts` present in
  suite (2026-11-24)

### S4 — Typecheck clean

- **Confirms:** `functions` typechecks with the new pass + contract
  fields.
- **Steps:** `cd functions && npx tsc --noEmit -p tsconfig.json`
- **Expected:** exits clean.
- **Result:** ☒ PASS — `tsc --noEmit -p tsconfig.json` exit 0
  (2026-11-24)

### S5 — Orchestrator wiring + eval isolation

- **Confirms:** `runUnifiedMarkPass` invokes `runShadowEvalTick` after
  marking with `{trade, mark}` per marked position; an eval failure
  surfaces as `evalError` without failing marks; mark cron cadence
  unchanged; nothing closes positions.
- **Steps:** inspect
  `functions/src/paper-trading/engine/options-strategy-pass-orchestrators.ts`
  — `runUnifiedMarkPass` accepts `shadowEval` (default
  `runShadowEvalTick`), maps `result.positions` to `{trade, mark}`,
  try/catch → `evalError`; `options-strategy-passes.ts` keeps
  `*/30 13-20 * * 1-5`. Spec-pinned at
  `options-strategy-passes.test.ts` `runUnifiedMarkPass` describe;
  verify check "eval failure → evalError, marks survive".
- **Expected:** eval runs after marks inside one pass; failure isolates;
  schedule unchanged; no close/settlement writes in shadow-eval-pass.ts.
- **Result:** ☒ PASS — cron `*/30 13-20 * * 1-5` unchanged at
  `options-strategy-passes.ts:77`; `runUnifiedMarkPass(provider)` at :102
  (scheduled) + :172 (manual); `shadowEval(...)` → `evalError` isolation at
  `options-strategy-pass-orchestrators.ts:241-250`; orchestrator describe +
  verify `eval failure → evalError, marks survive` pin green; no
  close/settle writes in `shadow-eval-pass.ts` (only
  `FieldValue.delete()` on the analysis doc) (2026-11-24)

### S6 — Sibling-verify regression: #1712 script still green

- **Confirms:** the review-major repair — #1712's verify script fakes now
  carry `trade` (with `strategyInstanceId: undefined` → skipped eval,
  no-credentials safe); the extended summary shape pins.
- **Steps:** `npx tsx scripts/verify/strat-manage-mark-pass-1712.ts`
- **Expected:** `ALL CHECKS PASSED`, exit 0; orchestrator summary
  `{positions:2, errors:1, evaluated:0, fires:0, evalErrors:0}`.
- **Result:** ☒ PASS — `ALL CHECKS PASSED`, exit 0;
  orchestrator summary pins `{positions:2, errors:1, evaluated:0,
  fires:0, evalErrors:0}` (2026-11-24)

## Manual UI/UX refinement pass

- Not applicable — no user-facing surface. Analysis-doc consumption is a
  later FE task.
- **Result:** ☒ PASS — N/A, BE scheduled pass

## Findings

- None.

## Traceability

| Criterion | Scenarios |
|---|---|
| AC1 — 6 rules × tick mark × open position | S1 (all-6-rule docs check), S2 (spec :127), S5 |
| AC2 — firstFiredAt + fired mark, idempotent | S1, S2 (stickiness, same-tick idempotent, re-cross, post-expiry specs) |
| AC3 — analytics-only | S1, S5 (no close writes in pass; orchestrator evalError path) |
| TEST US-6 — intraday firstFiredAt visible | S1 (firstFiredAt = tick timestamp) |
| TEST "Analysis-doc merge" — no clobber | S1 (carry-forward + scan-rebuild checks), S2 (merge specs) |
| TEST edge — missed ticks/restarts | S2 (doc-persisted stickiness specs) |
| Review fix — #1712 verify regression | S6 |

## Regression / smoke

- [ ] `manage-exit-scan-pass.test.ts` now registered + green in the gate
      (was orphaned) — S3
- [ ] `mark-pass.test.ts` trade-carry pin green — S2
- [ ] sibling verify `strat-manage-mark-pass-1712.ts` green — S6

## Verdict

- **PASS** — all six scenarios green; zero findings.

## Results log

- 2026-11-24 — S1-S6 all PASS on first execution (37 verify checks, 69/69 specs, 520/520 gate, tsc clean); UAT → Complete
