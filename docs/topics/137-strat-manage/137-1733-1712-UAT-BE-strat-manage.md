**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1733  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1712  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# UAT: #1712 — unified position-grain mark pass (per-leg → signed net)

## Scope

The 30-minute `optionsMarkPass` now selects every OPEN trade carrying
option legs (`isOpenOptionPosition`, #1710 contract) instead of
enumerating strategy instances — legacy, manage-era, and signal-source
option positions all mark on one cadence. Every option leg is quoted by
its own OCC contractID (side-grouped `getQuotes`) and carries its own
`lastMark`; `findPrimaryLeg` single-leg marking is gone. Valuation is
signed: `netMarkValue` → `currentValue`, `signedEntryPremium + netMark` →
`unrealizedPnl` (`tradeToPosition` adopts the same signed value). The
`marks[date].mark` field stays in the order-level exit-price space
eval/settlement readers consume, via the canonical
`orderPriceForLiquidationValue` — unchanged for the legacy single-leg
SHORT corpus, correct for LONG/debit orders and `qty>1`. Writes are
atomic per position (`markPositionLegs` txn); a missing leg quote
errors the whole position without partial writes; one bad position
can't stall the rest. Signal stock trades stay on `signal-mark-pass`.

Task acceptance criteria:
1. selection = OPEN trades with option legs (no runState/instance enumeration)
2. per-leg RH quotes via BatchQuoteProvider → each leg own lastMark — findPrimaryLeg marking dead
3. signed netMark → currentValue/unrealizedPnl via shared helpers; raw-quote write convention kept
4. 30-min cadence covers legacy + manage; signal stock trades excluded
5. per-position error isolation — one bad quote can't stall the pass

Review-round fixes this UAT also confirms:
- `marks[date].mark` = `orderPriceForLiquidationValue` (LONG-order +
  qty>1 correctness — the review's major finding)
- `mark-pass.test.ts`, `options-strategy-passes.test.ts`,
  `hybrid-quote-provider-integration.test.ts` registered in
  `test:paper-trading`

## Prerequisites

- Repo checkout on `prod` with the uncommitted #1712 files present
  (`functions/src/paper-trading/engine/{passes/mark-pass.ts,
  position-repository.ts, trade-adapter.ts, types.ts,
  options-strategy-pass-orchestrators.ts, options-strategy-passes.ts}`,
  `functions/package.json`, tsconfig/jest aliases, the four spec files,
  `scripts/verify/strat-manage-mark-pass-1712.{ts,md}`).
- `npx tsx` on PATH; `npm --prefix functions` for the canonical gate.
- No RH MCP session, Firestore credentials, or dev server needed — all
  verification injects fakes through the deps seams.

## Getting to the feature

No UI surface — a backend scheduled pass. QA acceptance is at the
contract/verification level: selection semantics, per-leg marks, signed
valuation, mark-space convention, error isolation, and callable wiring.
All verification is command-line from the repo root.

## Scenarios

### S1 — Verify script passes standalone

- **Confirms:** end-to-end pass over production code with faked deps —
  selection, per-leg marks, signed P&L, mark space, error isolation,
  orchestrator summary.
- **Steps:** `npx tsx scripts/verify/strat-manage-mark-pass-1712.ts`
- **Expected:** every check prints `OK   name: value`, ends
  `ALL CHECKS PASSED`, exit 0. Covers: mixed-corpus selection (legacy +
  manage + signal option marked; signal stock + CLOSED skipped), single
  CSP `mark +0.40 / netMark −40 / pnl +10`, credit spread `mark +0.20 /
  netMark −20 / pnl +5`, debit spread `mark +0.40 / netMark +40 /
  pnl +15` (order.side LONG), side-grouped quote calls, covered-call
  share leg riding stored mark, missing-quote/missing-contractID error
  isolation with no partial write, `tradeToPosition` signed
  currentValue, orchestrator `{positions, errors}` + `{error}` envelope.
- **Result:** ☒ PASS — `ALL CHECKS PASSED`, exit 0 (2026-11-24)

### S2 — Task spec files green

- **Confirms:** the rewritten pass spec (15 specs) + updated consumer
  specs under `node:test`.
- **Steps:**
  `npx tsx --test tests/functions/options-strategy-engine/mark-pass.test.ts tests/functions/options-strategy-engine/options-strategy-passes.test.ts tests/functions/options-strategy-engine/hybrid-quote-provider-integration.test.ts tests/functions/paper-trading/trade-adapter.test.ts`
- **Expected:** `pass 54`, `fail 0`.
- **Result:** ☒ PASS — `tests 54 / pass 54 / fail 0` (2026-11-24)

### S3 — Canonical gate runs the specs

- **Confirms:** the previously orphaned spec files execute inside
  `test:paper-trading` (review-round registration fix).
- **Steps:** `cd functions && npm run test:paper-trading`
- **Expected:** `pass 479`, `fail 0` — mark-pass, orchestrator, and
  hybrid-integration specs appear in the suite output.
- **Result:** ☒ PASS — `tests 479 / pass 479 / fail 0` (2026-11-24)

### S4 — Typecheck + shared-module alias

- **Confirms:** `functions` typechecks with the new
  `@options/position-math` alias; jest resolves the alias too.
- **Steps:** `cd functions && npx tsc --noEmit -p tsconfig.json`;
  `npx jest shared/options-position-math.spec.ts --coverage=false`
- **Expected:** tsc exits clean; jest 28 specs green.
- **Result:** ☒ PASS — tsc exit 0; jest `Tests: 28 passed` (2026-11-24)

### S5 — Cadence + callable wiring unchanged

- **Confirms:** AC4 — the 30-min timer routes to the unified pass; the
  manual callable returns the new result shape; signal stage preserved.
- **Steps:** inspect
  `functions/src/paper-trading/engine/options-strategy-passes.ts` —
  `optionsMarkPass` keeps `*/30 13-20 * * 1-5` and calls
  `runUnifiedMarkPass(provider)` then `runSignalMarkPass(...)`;
  `optionsMarkPassManual` returns `{ markPass, signals }`. Orchestrator
  routing spec-pinned in `options-strategy-passes.test.ts`
  (`runUnifiedMarkPass` describe).
- **Expected:** schedule string unchanged; no instance enumeration
  anywhere in the mark path.
- **Result:** ☒ PASS — `schedule: '*/30 13-20 * * 1-5'` unchanged at
  `options-strategy-passes.ts:77`; `runUnifiedMarkPass(provider)` at :102
  ahead of `runSignalMarkPass` at :107; manual returns `{ markPass,
  signals }`; orchestrator describe spec-pinned (2026-11-24)

### S6 — Mark-space regression: LONG order + qty>1

- **Confirms:** the review-major fix — `orderPriceForLiquidationValue`
  signs `marks[date].mark` by order side and normalizes by order qty.
- **Steps:** covered by S1 (debit spread `+0.40`, LONG order) and S2
  (`writes the per-unit mark when order quantity > 1` — qty 2 →
  `netMark −80`, `mark +0.40`).
- **Expected:** values as stated; no `−0.40` debit mark anywhere.
- **Result:** ☒ PASS — verify `debit-spread marks[] mark: 0.4` +
  `unrealizedPnl: 15`; spec pins qty-2 `mark +0.40` and CC `mark −100`
  (2026-11-24)

## Manual UI/UX refinement pass

- Not applicable — no user-facing surface. Dashboard consumption of the
  signed `currentValue`/`unrealizedPnl` fields is task #1716.
- **Result:** ☒ PASS — N/A, BE scheduled pass

## Findings

None — every scenario green on first execution. The two review-round
majors (LONG-order mark space, orphaned spec registration) are covered
by S6/S3 and hold.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — OPEN + option legs, no enumeration | S1, S2, S5 |
| AC2 — per-leg quotes → own lastMark | S1, S2 |
| AC3 — signed netMark → currentValue/unrealizedPnl; raw-quote convention | S1, S2 |
| AC4 — 30-min cadence covers legacy + manage; signal stock excluded | S1, S5 |
| AC5 — per-position error isolation | S1, S2 |
| Review fix — order-level exit-price mark space | S1, S2, S6 |
| Review fix — spec registration | S3 |

## Regression / smoke

- `signal-mark-pass` behavior unchanged for stock trades (its own specs
  run inside S3's suite; header comment updated only).
- `settlement-pass` untouched (foreign #728 WIP in the same file is out
  of scope — `findPrimaryLeg` survives for settlement).
- Pre-existing `analysis-dataset-writer.test.ts` ×4 failures on HEAD —
  unrelated fixture rot, not this change.

## Verdict

**PASS** — S1–S6 green; no findings; no user-facing surface.

## Results log

| Date | Task | Executor | Result | Notes |
|---|---|---|---|---|
| 2026-11-24 | #1712 | devin | PASS | S1–S6 all green first run |
