**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1708  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1712  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# CODE-REVIEW: BE unified position-grain mark pass (#1712)

## Scope reviewed

Rewritten: `paper-trading/engine/passes/mark-pass.ts` (instance-grain →
position-grain), `options-strategy-pass-orchestrators.ts`
(`runMarkPassForAllInstances` → `runUnifiedMarkPass`),
`options-strategy-passes.ts` (both callables rewired),
`position-repository.ts` (`listOpenOptionTrades` + `markPositionLegs`;
`markPosition` removed), `trade-adapter.ts` (signed `currentValue`),
`types.ts` (`PositionMarkUpdate`), `signal-mark-pass.ts` (header comment),
`repository.ts` (doc ref), tsconfigs + `jest.config.js`
(`@options/position-math` alias), `functions/package.json`
(`test:paper-trading` registration).
Tests: `mark-pass.test.ts` (rewritten, 15 specs),
`options-strategy-passes.test.ts`, `hybrid-quote-provider-integration.test.ts`,
`paper-trading/trade-adapter.test.ts`.
Verify: `scripts/verify/strat-manage-mark-pass-1712.{ts,md}` + run-all/README
registration. Drive-by: `options-engine-eod-selection-1501.ts` stale-fixture
fix (pre-existing on HEAD, blocked typecheck).

## Verdict

**PASS** — two majors found in-gate and remediated; no critical or major
findings outstanding.

## Findings and resolution

### Major — `marks[date].mark` written in the wrong space for LONG orders (FOUND, FIXED)

First-pass Spec and Thermo-nuclear axes independently flagged
`mark = -netMark / SHARES_PER_CONTRACT`: correct only for `order.side ==
SHORT`, `qty == 1`, `multiplier == 100`. `eval-pass` books `mark` verbatim
as the exit fill `price`; a LONG-order (debit) trade would get a
sign-inverted mark and a negative fill price. Fixed by the canonical
`orderPriceForLiquidationValue(netMark, trade.order, trade.legs)`
(`ledger.ts`) — identical output for the legacy SHORT corpus, correct for
LONG orders, `qty>1`, and non-100 multipliers. Spec/verify corrected
(debit spread now asserts `mark +0.40` with `order.side: LONG`), plus new
qty>1 pin and a CC-convention pin (`mark −100`).

### Major — three spec files orphaned from `test:paper-trading` (FOUND, FIXED)

`mark-pass.test.ts`, `options-strategy-passes.test.ts`, and
`hybrid-quote-provider-integration.test.ts` were in no npm script
(pre-existing for the two older files — `package.json` on HEAD already
omitted them). All three registered; the canonical gate now runs them
(479 specs green).

### Minor — fixed in-gate

- Error-record `contractID` misattribution (`?? firstContract` blamed a
  sibling leg on provider throws) → field made optional, populated only
  where honest; `''` workaround deleted.
- Dead try/catch around `runUnifiedMarkPass` in both callables
  (orchestrator returns `{error}`, never throws) → removed.
- Sequential per-side `getQuotes` → `Promise.all`.
- Inlined `premium + netMark` → shared `unrealizedPnl()` helper.
- `as unknown as` type-erased fakes in the orchestrator spec → real typed
  fixtures; inline `import(...)` type in hybrid spec → top-level import;
  superfluous `as BatchQuoteProvider` casts dropped.
- Misleading error message `'No leg with contractID found'` → names the
  leg id; stale doc refs to deleted `markPosition` /
  `runMarkPassForAllInstances` corrected (`repository.ts`,
  `signal-mark-pass.ts` header); `types.ts` import formatting.
- Mixed-corpus spec strengthened: legacy + manage + signal-source option
  trades all mark; stock-only and non-OPEN skipped.

### Deferred / accepted

- **Signal-option double-marking** — `runUnifiedMarkPass` selection is
  source-agnostic per the shipped #1710 SHARED contract
  (`hasOptionLegs`); signal-mark-pass still marks signal option trades
  order-level. After the mark-space fix both passes write the identical
  `orderPriceForLiquidationValue` convention — redundant but consistent.
  Cost: extra leg quotes per tick and `rawResponse` shape alternation on
  the shared raw-quote doc. Matches the contract's "stock leg stays on
  the signal passes" design for mixed trades; flagged for #1714's
  settlement scope to revisit if the raw-quote shape churn matters.
- `trade-adapter.ts` `netMarkValue(...) ?? 0` — unreachable defensive
  zero-fill (legs require `lastMark`); documented.
- Timer wiring — cron strings aren't spec-pinnable by convention;
  orchestrator routing is spec'd.

## Test results

- `test:paper-trading` (canonical gate): **479/479 green** — includes the
  three newly-registered spec files.
- `mark-pass.test.ts`: 15 specs — selection (mixed corpus), per-leg
  marks, signed P&L all postures, side-grouped quoting, atomic
  missing-quote error, per-position isolation, raw-quote shape,
  interpolated/asOf metadata, qty>1 mark pin.
- `npx tsx scripts/verify/strat-manage-mark-pass-1712.ts` — ALL CHECKS
  PASSED (production seams exercised end-to-end).
- `tsc --noEmit` functions + tests: clean on all touched files.
- jest shared specs (alias check): 90/90 green.
- Pre-existing unrelated failures noted (not this change):
  `analysis-dataset-writer.test.ts` ×4 (stale `writeChunks` fixture on
  HEAD).

## Pass sequence

```text
First pass complete — 2 majors (mark sign space for LONG orders; orphaned spec files) + ~12 minors across three axes
Second pass complete — all findings dispositioned; majors fixed via canonical helper + registration; minors fixed or justified-deferred; no new findings
Convergence: PASS — axes' union covered the whole change; remaining items are accepted design or deferred observations
```
