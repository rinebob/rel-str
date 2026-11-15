**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1518  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1496  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# UAT — BE Task: SA pick-semantics spike (#1496)

## Scope

Research spike: confirm SA's exact pick-doc selection semantics so the shared `selectContractAtCoordinate` (#1497) replicates them exactly. Deliverable = written spec (issue #1496 findings comment + `IMPL-BE` module 0). This UAT verifies the spec is *correct and executable-verified*, not assumed.

## Prerequisites

- Local checkout of `av-proxy-api` at `C:\aa\projects\av-proxy-api` (sibling repo).
- `cd C:\aa\projects\av-proxy-api\functions && npx jest` available for executing SA's picker suite.

## Getting to the feature

No app route — the deliverable is documentation. The "surface" is:

- Spec record: GitHub issue **#1496** findings comment + `docs/topics/1238-backtest/1238-1270-1485-IMPL-MULTI-LEG-SPREAD-BE-options-backtest-multi-leg-templates.md` **module 0**.
- Source under test: `C:\aa\projects\av-proxy-api\functions\src\v2\historical-options-corpus\services\options-delta-picker.service.ts`.

## Test scenarios

### Scenario 1 — Spec matches SA source, line by line

- **Start:** open `options-delta-picker.service.ts` and the spec (IMPL-BE module 0).
- **Steps:** verify each recorded rule against code:
  1. Type filter (line ~152: `row.type !== 'put' && row.type !== 'call'`).
  2. Nearest-listed-expiration to target DTE; tie → longer actual DTE (lines ~171–183).
  3. Signed target: put `-deltaPct/100`, call `+deltaPct/100` (lines ~162–163).
  4. argmin `|observedDelta − target|` within that expiry only; tie → larger |delta| → lowest contractId (lines ~186–202).
  5. Eligibility = identity fields only (contractID, expiration dte ≥ 0, strike, delta); no mark/liquidity requirement (lines ~138–158).
  6. `no_match` vs `no_chain` vocabulary; `no_chain` is caller-emitted (lines ~96–112, ~29–31).
- **Expected:** every spec line maps to code; no rule missing, none invented.
- **Result:** PASS — verified during spike + re-read during QA.

### Scenario 2 — Picker semantics are executed-verified

- **Steps:** `cd C:\aa\projects\av-proxy-api\functions && npx jest tests/v2/historical-options-corpus/options-delta-picker.service.test.ts`
- **Expected:** suite green; its cases assert each recorded semantic (tie-breaks, signed deltas, identity eligibility, omitted quote fields, miss vocabulary).
- **Result:** PASS — 21/21 tests pass (executed during review pass, 2026-11-14).

### Scenario 3 — Single writer path

- **Steps:** `grep -rln "pickCellsForDate\|noChainPickEntries" functions/src` in av-proxy-api → expect only `pick-materialize.service.ts` (+ its task handler + the picker itself). `grep -rln "days\[" functions/src | grep pick` → `options-delta-pick-cell.writer.ts`.
- **Expected:** one producer, one writer — no second algorithm.
- **Result:** PASS — verified 2026-11-14.

### Scenario 4 — Parity harness premise

- **Steps:** in rel-str, confirm `functions/src/paper-trading/engine/quote-providers/av-eod-option-quote-provider.ts` `getEodChain` wraps `partnerHistoricalOptionsV2` — the same SA-served corpus the picker consumes.
- **Expected:** same input source ⇒ `selectContractAtCoordinate` over the EOD chain must reproduce `pickDoc.days[T].contractId` — a falsifiable check.
- **Result:** PASS — wraps the partner endpoint (line ~5, ~166).

### Scenario 5 — Chain passed verbatim

- **Steps:** `pick-materialize.service.ts` line ~148 — `pickCellsForDate(chain.slice(), ...)`.
- **Expected:** no filtering/preprocessing between stored chain and picker.
- **Result:** PASS.

## Traceability

| Acceptance criterion (task #1496) | Scenario |
|---|---|
| Written pick-semantics spec (expiry, delta metric, tie-breaks, filters) | 1, 2 |
| IMPL-BE updated with confirmed spec | 1 (module 0 read) |
| Golden expectations defined for parity harness | 4, 5 |

## Regression / smoke

- IMPL-BE module 0 no longer says "spike pending" — confirmed rewritten.
- Downstream consumers (#1497 shared fn, #1501/#1502 re-targets) reference this spec — advisory notes carried in review doc + issue comment.

## Results log

- 2026-11-14 — All scenarios PASS (executed during implement/review passes; evidence commands above are re-runnable verbatim).
