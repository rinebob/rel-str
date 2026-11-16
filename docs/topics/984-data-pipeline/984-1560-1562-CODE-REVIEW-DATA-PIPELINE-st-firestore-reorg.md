**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1560  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1562  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# Code Review — #1562 BE-IMPL: src-{source} stats scope family

## Scope

One commit-sized change: a per-source stats rollup scope so the nightly
`runPaperStatsPass` writes `stats-src-STRATEGY` / `stats-src-SIGNAL` /
`stats-src-MANUAL` docs — the data substrate for the strategy
dashboard's population selector (US-1 of the thread PRD).

Changed files:

- `shared/paper-trading-ids.ts` — new `statsScopeSource(source:
  PaperTradeSource)` → `src-${source.toUpperCase()}`; `import type`
  (contracts value-imports `PaperTradingKind` from this module — a
  runtime import would cycle).
- `shared/paper-trading-ids.spec.ts` — builder pins.
- `functions/src/paper-trading/passes/paper-stats-pass.ts` —
  `tradeScopes` pushes the source scope unconditionally; header scope
  lists updated (two places).
- `tests/functions/paper-trading/paper-stats-pass.test.ts` — fan-out +
  partition expectations.
- `tests/functions/paper-trading/read-callables.test.ts` — `src-*`
  SCOPE_RE pin (added in review remediation).
- `functions/scripts/verify/paper-trading-stats-src-scopes-1562.ts` —
  NEW prod verification script (registered in `run-all.ts` + README).
- `docs/DATA-MAP.md` — two stale scope enumerations updated.

## Standards axis

No documented-standard violations. Verified: builder placed with stats
scope siblings, uppercases like `statsScopeSymbol`; type-only import
avoids a real cycle (contracts value-imports `PaperTradingKind`);
spec conventions match per-harness (jest spec, `node:test` pass test);
verify script matches sibling conventions (`check()` helper, `@topic`
header, run/prereq block). Judgement calls: corrupt-`source` blast
radius equals the pre-existing `trade.symbol` posture (accepted);
two header enumeration spots were stale (remediated).

## Spec axis

All 5 acceptance criteria met; no sibling-task bleed (no `ledger.ts`,
stats-increments, `stats-repository`, or `getStrategyEquityCurve`
touches — those belong to #1563/#1565). Two deviations noted and
remediated: (1) IMPL plan wrongly claimed enum values were uppercase —
the shipped `.toUpperCase()` is what satisfies the `src-STRATEGY` AC;
IMPL doc corrected. (2) `SCOPE_RE src-*` coverage was prod-only — a
unit pin added to `read-callables.test.ts`.

## Thermo-nuclear axis

Genuinely clean at this scale. Uppercase `src-*` follows the `sym-*`
precedent (required-field scope pushed unconditionally), is spec-pinned
by PRD + IMPL, and `src-MANUAL` is required for the partition invariant
to hold. No consumer special-cases scope prefixes; no cycle; no
invented abstraction. Minors: verify-script `src-MANUAL` absence
tolerance printed a misleading check name (remediated); `run-all.ts`/
README carry unrelated parallel-session `#873` entries that must be
excluded from this task's commit.

## Test results

- `shared/paper-trading-ids.spec.ts` (jest): 46/46 green.
- `tests/functions/paper-trading/` suite: 22/22 green incl. new
  `src-*` pins; full `test:paper-trading` 283/283.
- functions `tsc --noEmit` + `npm run build`: clean.
- Prod verification: `paper-trading-stats-src-scopes-1562.ts` —
  15/15 checks, real pass wrote all three `stats-src-*` docs,
  `handleGetPaperStats(scope='src-STRATEGY')` exercised end-to-end,
  src-* ⇄ `stats-all` partition invariant holds.
- Full jest suite: 5352/5353 tests pass; **14 suites + 1 test fail in
  unrelated in-flight areas** — `contract-list.service.ts`/
  `options-replay-runs.service.ts` import a renamed
  `convertOptionsContractListDocV1` export (parallel-session rename in
  progress), duplicate-property TS errors in
  `shared/options-replay-contracts.spec.ts`, and one
  `option-chain.integration.spec.ts` timeout. All failures are TS
  compile errors or timeouts in files this task never touched —
  pre-existing breakage in the shared working tree, not caused by this
  change. Task-scoped suites are fully green.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| minor | `paper-stats-pass.ts` second scope enumeration stale | remediated |
| minor | IMPL doc "enum values are uppercase" was wrong | remediated (doc corrected to as-built) |
| minor | `SCOPE_RE src-*` had no unit pin | remediated (`read-callables.test.ts`) |
| minor | verify-script `src-MANUAL` absence check printed misleading name | remediated |
| nit | corrupt `source` would kill the pass (same as `trade.symbol`) | accepted — consistent posture, scope discipline |
| nit | `run-all.ts`/README carry unrelated `#873` entries | commit-time exclusion — do not stage those hunks |
| nit | latent: future non-`[a-zA-Z0-9-]` enum value would emit an unreadable scope | accepted — closed enum |

## Round 2 — remediation re-review (2026-11-16)

Delta reviewed on the final diff (`review-1562-r2.diff`): header
enumeration fix, `read-callables.test.ts` `src-*` pin, IMPL doc
correction, verify-script check naming. One wart introduced and fixed
in-round (misleading FAIL detail on a genuine src-doc miss →
`expected doc missing for a populated source`). No new findings;
touched suites re-run green (22/22 tsx incl. the new pin); `tsc` clean.

## Verdict

**PASS** — all acceptance criteria met, all axes clean,
task-scoped tests and prod verification green; full-suite failures are
unrelated parallel-session breakage documented above.
