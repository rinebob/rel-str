**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1536  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1539  
**QA Issue:** #1586  
**Domain:** STRAT-MANAGE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# UAT — #1539 BE: Manage instance reader + open-pass rework

## Getting to the feature

Not applicable — backend engine pass with no UI surface. The noon-PT
`manageOpenPassTimer` fires inside Cloud Functions; the manage page's
instance table and Create New Instance dialog (#1540–#1549) consume the
data this pass produces. QA acceptance is at the contract/verification
level: reader adapter correctness, pass behavior under injected fakes,
ledger integration, timer wiring.

## Scenarios

### S1 — Verify script passes standalone

1. Run `npx tsx scripts/verify/strat-manage-open-pass-1539.ts`
2. **Expect:** every check prints `OK   name: value`, ends
   `All checks passed`, exit 0. Covers: reader validate/normalize
   (valid doc, legacy skip, deleted skip, invariant rejects, malformed
   `maxOpenPositions`, `variant:null`, NaN delta, stopType normalize),
   daily open via two-leg CDS chain resolution (OCC ids
   `QQQ260306C00450000`/`QQQ260306C00455000`, LONG/SHORT sides,
   strikes 450/455, $200 net debit), dedup (cadence + deterministic-id
   pre-check), `maxOpenPositions` cap, signal gate, `no_contracts`,
   stock-leg throw, errored-result write, same-Δ exclusion, `lastFiredAt`
   dep.

### S2 — Specs pass

1. Run `npx tsx --test tests/functions/options-strategy-engine/manage-open-pass.test.ts`
   (from `functions/`)
2. **Expect:** all tests green — daily open/dedup/cap/no_contracts/
   stock-leg/exclusion/error/stamp, signal gate, reader normalize.

### S3 — Ledger seam: observational `none` seeds empty runs

1. `npx tsx --test tests/functions/paper-trading/ledger.test.ts`
2. **Expect:** all green including `'none' seeds an empty variant set —
   observational trades (#1539)` — proves `applyEntryFill` accepts
   `governingVariant:'none'`, writes `variantKeys:[]`/`variantRuns:[]`,
   and still books the account transaction.

### S4 — Compiles + builds

1. `cd functions && npx tsc --noEmit` and `npm run build`.
2. **Expect:** zero diagnostics on manage/engine files; esbuild bundle
   emits.

### S5 — Regression: engine + paper-trading suites

1. `npx tsx --test tests/functions/options-strategy-engine/*.test.ts`
   and `tests/functions/paper-trading/*.test.ts`
2. **Expect:** all green except known-foreign failures
   (`stats-repository` mid-refactor, `writeDataset` suite — other
   sessions' in-flight edits, confirmed untouched).

### S6 — Timer wiring

1. `grep manageOpenPassTimer functions/src/index.ts` — exported.
2. `open-pass-timer.ts` — `manageOpenPassTimer` onSchedule
   `0 12 * * 1-5` `America/Los_Angeles`, `RH_CREDENTIAL_BUNDLE` secret,
   session manager closed in `finally`, per-instance try/catch.

## Results log

Executed 2026-11-16 — all scenarios PASS, zero QA-found defects (every
defect was caught during implementation/review and is pinned by the
suites re-run here):

- **S1 — PASS:** 28/28 verify checks `OK`, `All checks passed`, exit 0.
- **S2 — PASS:** `manage-open-pass.test.ts` 21/21 green.
- **S3 — PASS:** `ledger.test.ts` 31/31 green including the new
  `'none' seeds an empty variant set — observational trades (#1539)`
  spec (`governingVariant:'none'` → `variantKeys:[]`/`variantRuns:[]`,
  account still booked).
- **S4 — PASS:** `npx tsc --noEmit` zero diagnostics repo-wide;
  `npm run build` emits `lib\index.js` 2.0mb clean.
- **S5 — PASS:** engine + paper-trading dirs — 523/529 green; the 6
  failures are foreign in-flight edits (`stats-repository` refactor,
  `writeDataset` CSV suite), files untouched by this change.
- **S6 — PASS:** `manageOpenPassTimer` exported from
  `functions/src/index.ts:157`; `0 12 * * 1-5` `America/Los_Angeles`
  cron with `RH_CREDENTIAL_BUNDLE` secret, `manager?.close()` in
  `finally`, per-instance try/catch.
