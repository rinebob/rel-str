**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Issue:** #557 (SHARED Blueprint)  
**Task:** #560 — Contracts: paper-trading types, collection paths, ID builders  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Reviewed:** 2026-09-24  
**Verdict:** PASS (2nd pass — all three axes approve)

## Summary

Three-axis review of the SHARED contracts task: record types for the
`paper-trading` collection, kind-anchor/`items` path helpers, human-readable
ID builders, type guards, callable request/response shapes, and a permanent
verification script.

## Standards

- ~~Major~~ → resolved-in-review: the `paper-trading/{anchor}/items/{id}`
  layout deviates from the AGENTS.md flat-collection + prefix convention —
  explicitly user-approved at Blueprint #557; the exception is now documented
  in AGENTS.md.
- Minor (fixed): `formatYYMMDD`/`formatDelta`/`formatDte` duplicated
  `strategy-instance-id.ts` helpers — extracted to `shared/id-format.ts`, both
  modules now share it.
- Minor (fixed): missing `isPaperStrategyInstance` guard (union member lacked
  its guard).
- Minor (fixed): `buildEquityTradeDesc()` constant-as-function → `EQUITY_TRADE_DESC`.
- Minor (fixed): `run-all.ts` hard-required an account number even for
  arg-less scripts — now runs no-credential scripts and skips the rest.

## Spec

- Missing → added: `statsScopeSignal` (IMPL lists `sig-{signalId}` scope),
  `statsScopeSymbol`, `statsScopeCohort` coverage in specs.
- Missing → added: callable request/response contract types
  (`paperSignalOrder`, `listPaperTrades`, `getPaperStats`, `getPaperAccount`,
  `listExitVariants`).
- Doc corrections: IMPL's stale `terminal` field on `ExitVariantConfig`
  superseded by the governing/shadow model; `PaperStrategyInstance.governingVariant`
  and extended stats scopes now documented in the IMPL.
- Scope creep flagged and accepted: cohort/symbol stats scopes serve the PRD's
  per-symbol and per-cohort rollups.

## Thermo-nuclear (Dr. Reed)

- ~~Major~~ → fixed: `PaperTradeLeg` was an over-optional bag — now a
  discriminated union on `kind` (option legs require contractID/type/strike/
  expiration; share legs carry none).
- ~~Major~~ → fixed: ID-segment formatters forked — extracted to
  `shared/id-format.ts`.
- Minor → fixed: untyped spec fixtures now annotated (`PaperTradeLeg`,
  `VariantRun`); `'xx' as never` → `as TradeOrigin`.
- Accepted judgement calls: `VariantRun.workingState` stays
  `Record<string, number>` (documented per-variant key conventions);
  `marks` map keyed `YYYY-MM-DD` vs `YYMMDD` id segments — intentional
  (mark keys are market dates, id segments are compact);
  `parseTradeId` symbol charset `[A-Z0-9]+` matches RH-style tickers.

## Test results

- Full jest suite: **1855 passed / 135 suites** — green.
- Verification script `scripts/verify/paper-trading-contracts-560-ids.ts`:
  16/16 checks pass (run for real via `npx tsx`).

## Verdict

**PASS** — both blocking majors fixed in-gate; all minors applied or
documented as accepted judgement calls.

## Second pass — 2026-09-24

All three axes re-ran on the post-fix state:

- **Standards: PASS** — every first-pass fix verified; AGENTS.md exception
  note accurate; alias additions consistent across all three configs.
  Fixed in-pass: README usage line (`[accountNumber]` now optional),
  `statsScopeCohort` double-prefix (`stats-cohort-cohort-…` →
  `stats-cohort-260924-QQQ-01`).
- **Spec: PASS** — all four acceptance criteria verified; added the missing
  build→parse round-trip test and `ExitVariantParams` serialization
  round-trip per the TEST plan; IMPL doc's `paperSignalOrder` signature
  corrected to match the flattened request type.
- **Thermo-nuclear: APPROVE** — leg union sound (no escape hatches),
  `id-format.ts` refactor output-identical (existing instance-id specs
  prove parity), callable types justified by the design doc.

Post-pass polish applied: `PaperFill.quoteSource` narrowed to
`RH_MCP | AV_EOD` (comment/type mismatch); the stats-cohort scope fix
noted above. The verification runner now uses synchronous child execution
and skips account-dependent scripts when no account is supplied. Remaining acknowledged nits: `parseTradeId` rejects dotted
tickers (RH symbols don't use them) and accepts `\d{6}` dates without
calendar validation; `dte ≥ 100` would break the 2-digit desc parse —
documented edge case, no current producer emits it.

**Final test state at review:** 47 shared tests green; full suite **1857 passed /
135 suites**; verify script 16/16 checks pass. QA subsequently reran the full suite:
**1859 passed / 135 suites**.
