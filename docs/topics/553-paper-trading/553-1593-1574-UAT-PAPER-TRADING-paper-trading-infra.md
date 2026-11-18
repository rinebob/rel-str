**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1593  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1574  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — #1574 BE: Signal-replay exit engine

## Scope

The curated exit engine consumed by #1575's mint + #1576's ingest:
`ma-close-{N}` and `target-{pct}` grammar/evaluators, the `variantLevel`
accessor, `indicators.sma` on `VariantEvalCtx`, `isIndependentCloser`,
`selectGoverningRun` + `smaAt` + `smaIndicatorsFor` (new
`exits/governing-policy.ts`), the eval-pass daily governing recompute
with the atomic `applyGoverningPick` write, the `closedThisPass`
same-day latch, and the `eval-pass-deps.ts` wiring split. Backend
machinery only — no UI surface.

## Prerequisites

- Repo at `prod`, worktree contains the task diff (uncommitted at QA
  time — ships with the task).
- No credentials, emulator, dev server, or browser needed — every check
  is a `node:test` spec, a static verify script, or a file inspection.
- Commands run from `functions/` unless noted.

## Getting to the feature

There is no UI surface — the feature is the nightly exit-eval pass and
the pure policy module. To inspect the delivered behavior:

- `functions/src/paper-trading/exits/governing-policy.ts` — selection +
  SMA helpers.
- `functions/src/paper-trading/exits/eval-pass.ts` — the policy hook
  (§ "Curated policy") + the eval loop.
- `functions/src/paper-trading/exits/eval-pass-deps.ts` — Firestore
  wiring (`defaultEvalDeps`).
- `functions/src/paper-trading/repository.ts` — `applyGoverningPick`.

## Automated evidence

- `npx tsx --test ../tests/functions/paper-trading/exit-variants.test.ts
  ../tests/functions/paper-trading/governing-policy.test.ts
  ../tests/functions/paper-trading/exit-eval-pass.test.ts` — **68/68**
- `npx tsx scripts/verify/paper-trading-curated-exit-engine-1574.ts` —
  **35/35**
- `npm run test:paper-trading` — **348/348**
- `npx tsc --noEmit -p tsconfig.json` + `npm run build` — clean
- `npx jest strategy-builder-form.component.spec.ts` — **48/48** (FE
  picker-subset regression)

## Scenarios

### S1 — Focused spec suite

**Feature:** every evaluator + policy behavior the task added.

1. `cd functions && npx tsx --test
   ../tests/functions/paper-trading/exit-variants.test.ts
   ../tests/functions/paper-trading/governing-policy.test.ts
   ../tests/functions/paper-trading/exit-eval-pass.test.ts`

**Expected:** `ℹ pass 68` `ℹ fail 0` — covering ma-close/target both
directions, `variantLevel`, selection + fallback + watermark
candidacy, marked-vs-unmarked eval, independent-closer close, the
same-day latch, and pick-undefined mirror.

**Result:** PASS — 68/68 (2026-11-17, fresh run).

### S2 — Task verify script

1. `cd functions && npx tsx
   scripts/verify/paper-trading-curated-exit-engine-1574.ts`

**Expected:** `All 35 checks passed.` — grammar, levels, closer
classification, policy selection/fallback/watermark, `smaAt` windowing.

**Result:** PASS — 35/35.

### S3 — Watermark candidacy (the review-caught bug)

**Feature:** a stop breached today still closes the trade — the pin is
"deepest below the trade's high **watermark**", not below the mark.

1. Read `functions/src/paper-trading/exits/governing-policy.ts` — the
   `watermark` reduce derives the trade peak from every run's
   `workingState.highWaterMark`/`lowWaterMark` floored at entry and the
   mark; the candidate filter tests `c.level < watermark` (long).
2. Confirm the spec `breach-day: a stop breached today still governs`
   in `governing-policy.test.ts` and the eval-level `breach day — the
   deepest stop below the watermark fires the real close` in
   `exit-eval-pass.test.ts` (mark 85 vs levels 95/92/90, hwm 100 →
   `ma-close-20` picked + real close at 85).

**Expected:** candidacy vs watermark, spec-pinned end-to-end.

**Result:** PASS — code reads level-vs-watermark; both specs green.

### S4 — Atomic pick/close write shape

**Feature:** flags + mirror never land as observable mid-state.

1. Read `repository.ts` `applyGoverningPick` — ONE `.update({
   variantRuns, governingVariant, updatedAt })`.
2. Read `eval-pass.ts` — the selection block passes `fullRuns` (the
   flag-corrected **full** array — EXITED run history is preserved, not
   an actives-only subset); the closing fire on a policy trade writes
   the same seam with the fired run EXITED + the closer/pick key.

**Expected:** single `.update`, full array, mirror names the pick or
the actual closer.

**Result:** PASS — verified against the file; spec `policy-marked trade
rewrites governing flags + governingVariant each day` asserts the
full-runs payload via the `picks` spy.

### S5 — Same-day close latch + unmarked-trade preservation

**Feature:** a second same-day trigger shadows rather than
re-attempting the ledger; unmarked trades keep static governing.

1. `closedThisPass` in `eval-pass.ts` — set true immediately after
   `applyExit`, gates `closeWanted`.
2. Spec `same-day multi-close latch` — `target-50` closes,
   `target-100` shadow-EXITED, zero errors.
3. Spec `unmarked trades keep static governing` — no pick write, target
   fire records shadow only.

**Result:** PASS — both specs green.

### S6 — Regression smoke + build

1. `npm run test:paper-trading` (functions) — 348/348, incl. all
   pre-existing eval/ledger/ingest suites.
2. `npx tsc --noEmit -p tsconfig.json` — clean; `npm run build` — clean.
3. `npx jest strategy-builder-form.component.spec.ts` (repo root) —
   48/48 (the `PickerVariantFamily` narrowing keeps new families
   unselectable).

**Result:** PASS — all green.

## Manual UI/UX refinement pass

Not applicable — backend pass machinery only; no user-facing surface.

## Findings

None — the review's critical/major findings were fixed in-gate and are
re-verified here (S3–S5). Deferred polish is tracked on the QA issue,
not blocking.

## Traceability

| Criterion | Scenario |
|---|---|
| `ma-close-{N}` fires on close-cross, both directions; `variantLevel` = SMA-N; missing indicators skip | S1, S2 |
| `target-{pct}` fires at entry × (1±pct); independent closer closes without governing | S1, S2, S5 |
| `variantLevel` undefined for non-price rules | S1, S2 |
| `VariantEvalCtx.indicators.sma` | S1, S2 |
| `selectGoverningRun` — deepest below watermark, fallback, ACTIVE-only, dead fallback, family-scoped | S1, S2, S3 |
| Eval-pass daily recompute + mirror via repo seam; unmarked unchanged | S1, S4, S5 |
| Independent closer closes + attributes | S1, S4, S5 |
| Regression coverage both directions / levels / policy / marked-vs-unmarked / closer | S1 |
| Verify script + guide + registry entries | S2 |

## Regression / smoke

- [x] `test:paper-trading` batch — 348/348
- [x] functions tsc + build — clean
- [x] strategy-builder form spec — 48/48
- [x] `runExitEvalPass` pre-existing specs (ASSIGNED/CLOSED/backfill/
  shadow paths) — all still green inside the batch

## Verdict

**PASS** — all acceptance criteria verified with fresh evidence.

## Results log

- 2026-11-17 — PASS. 68/68 focused · 348/348 batch · 35/35 verify ·
  tsc+build clean · 48/48 FE spec. No UI surface (refinement N/A).
