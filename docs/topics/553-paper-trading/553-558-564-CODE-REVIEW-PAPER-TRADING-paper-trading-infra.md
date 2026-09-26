**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Thread:** Core Infra
**Thread Slug:** core-infra
**Issue:** #558
**Task:** #564
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** CODE-REVIEW
**Status:** Final
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — #564 Signal→paper path: paperSignalOrder callable + expression-fill pass

**Verdict: PASS** (3 review rounds; final round: NO FINDINGS on all axes)

## Summary

Three-axis iterative review (Standards / Spec / Thermo-nuclear) of the
signal→paper path: `paperSignalOrder` callable (ticket provenance → equity
fill → cohort → PENDING expression trades) and the noon-PT
`expression-fill-pass` (chains → instruments → quotes → delta/DTE selection
→ `applyPendingFill` → OPEN). Every finding from rounds 1–3 was remediated
and re-verified on prod before this verdict; the final clean-check found
nothing.

## Spec compliance — all criteria met

- Equity trade filled at acceptance quote + cohort + PENDING expressions.
- No `place_*`/`review_*` reachable (asserted unit + live; observation
  allowlist also enforces).
- Noon pass fills pending expressions via chain selection matching template
  delta/DTE (verified live — 2/2 expressions OPEN).
- `sig` trade ids; cohort groups all members.
- Idempotent retry — same signal returns the existing cohort; missing cohort
  doc rebuilt from stored trade dims.
- Integration tests with mocked RH MCP caller + real-run verification script.

## Round history

### Round 1 — remediated

Idempotency hole (duplicate cohort on retry); ticket `side`/`quantity`
unvalidated; `as never` in verify script; third MCP response dialect →
`engine/rh-mcp-shapes.ts` extracted (resolver + provider + pass + callables
all migrated); sequential → parallel fills; `applyPendingFill` overwrote
fills; callables.ts mixed extraction helpers.

### Round 2 — remediated

- `existing[0].cohortId` → `eqTrade.cohortId` (arbitrary list position bug).
- `pendingExpressionTradeIds` renamed `expressionTradeIds` (post-fill retries
  no longer mislabel OPEN trades; contract is pre-FE so rename is free).
- Half-migrated shared constants fixed: resolver/provider now use
  `MCP_PREFIX`/`QUOTE_BATCH`/`quoteMark`; dead `const MCP` aliases and dead
  casts removed.
- `buildCohortDoc` + `hasTemplate` type guard; rebuild stamps `acceptedAt`
  from the original trade, not retry time.
- Ticket `side` compare is case-insensitive; `quantity` optional in request
  (ticket wins), integer-only, missing-both → invalid-argument.
- `numAt` → `parseNum` (comma parity); `?? 0` strike → throw; `manager!` →
  `const m`; `as never`/`as PaperTrade` fixtures → typed builders.
- `tradeOverrides` → `PaperTradeOverrides` whitelist Pick (lifecycle +
  variant-derived fields can't be overridden).
- `FILL_CONCURRENCY=4` chunk on the per-trade fill loop.
- callables.ts: helpers moved out; file back under threshold.

### Round 3 — remediated

- `expressionFillPassTimer` moved into `passes/expression-fill-pass.ts`
  (deployment surface lives with its domain; callables.ts = 392 lines).
- `fetchAllOptionInstruments` shared paginator collapses the pass's
  `fetchInstruments` and the resolver's `findMatchingInstrument` loops.
- `PaperTradeOverrides` trimmed further — `governingVariant`/`assignment`
  out (variantKeys + shares invariants).
- Cohort rebuild uses stored dims (`eqTrade.symbol`, `eqTrade.order.side`),
  warns on dropped template keys.
- `QUOTE_CONCURRENCY=3` bound on intra-trade quote-batch parallelism.

### Round 4 — NO FINDINGS (clean)

## Documented deferrals (accepted, not blocking)

- Raw-quote `rq-` doc linkage per fill — PRD story 18 scope; lands with the
  mark path.
- Same-signal concurrent-accept race — seq-scan + short-circuit mitigate;
  documented in code.
- `applyEntryFill`/`applyPendingFill` duplication — extraction queued for
  the settlement sibling (per ledger's own note).
- `PaperTrade.userId?` optional (legacy engine docs).
- Verify script WARNs (not FAILs) when no contract is selectable — market
  may be closed.

## Test results

- `test:paper-trading`: 85/85 · engine suites: 143/143 · full Jest: 1865/1865
- tsc clean; esbuild bundles
- Prod verification `paper-trading-signal-order-564.ts`: 16/16 — real quote
  equity fill, cohort, PENDING trades, live chain selection → both OPEN,
  idempotent retry, zero mutation tools
