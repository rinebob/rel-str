**Topic:** Paper Trading Infra
**Topic Slug:** paper-trading-infra
**Thread:** Core Infra
**Thread Slug:** core-infra
**Issue:** #558
**Task:** #565
**Topic Parent:** #553
**Domain:** PAPER-TRADING
**Type:** CODE-REVIEW
**Status:** Final
**Created:** 2026-09-26
**Last Updated:** 2026-09-26

# Code Review — #565 Read APIs + generalized statistics scopes

**Verdict: PASS** (3 axes, findings remediated + re-verified on prod)

## Summary

Read-side callables (`listPaperTrades`, `getPaperStats`, `getPaperAccount`,
`listExitVariants`) plus a generalized nightly stats pass that rolls every
`PaperTrade` dimension into `stats-{all|inst-*|var-*|cohort-*|sig-*|sym-*}`
docs — the dashboard's data layer for #566/#569.

## Spec compliance — all criteria met

- `listPaperTrades` filters AND-combine (equality chain + `variantKeys`
  array-contains); symbol normalized to uppercase.
- Stats docs per scope carry equity curve + maxDrawdown + realized/
  unrealized — verified live (`stats-sym-VRFY` etc. written by the real
  pass against prod).
- `getPaperAccount` returns the caller's `acct-{uid}` doc (cash, equity,
  realized, open count) or null.
- Tests: handler-level fixtures + repository-level multi-filter fixture +
  20-check prod verification script.

## Findings → resolution

### Standards

- **[HIGH] Divergent scope doc ids** — legacy engine pass writes
  `stats-ALL`/`stats-{instanceId}` (existing UI contract) while the new
  pass writes `stats-all`/`stats-inst-{id}`. *Resolved:* deliberate
  coexistence, documented in `paper-stats-pass.ts` header — both derive
  from the same trades post-#562; the new namespace is what `listStats`/
  `getPaperStats` consumers enumerate; legacy docs keep the deployed
  strategy UI working unchanged.
- **[MED] `limit-sd1` in the picker never fires** — kept in
  `listExitVariantConfigs` with an explicit "stub" label: the variant
  selector needs the full registry surface (#568 consumes it); the rule
  is registered and gated in `evaluateVariant`.
- **[MED] `EXIT_VARIANT_CONFIGS` ↔ `PATTERNS` drift** — added a
  cross-check test asserting every config key parses and its params equal
  the key-embedded values.
- **[MED] Filename collision** — `passes/stats-pass.ts` renamed to
  `paper-stats-pass.ts` (engine's `passes/stats-pass.ts` untouched).
- **[LOW]** `_deps` param dropped from `handleListExitVariants`;
  `internalGuard` wraps all four onCall paths (raw errors never leak);
  verify-script doc-id embedding noted as harness-only.

### Spec

- Criterion 4 strengthened — multi-field AND filter now covered by a
  repository-level seeded fixture (`cohortId + expression + variantKey`),
  not only the live verify script.
- `variantKey` semantic confirmed: matches `variantKeys` including shadow
  runs — the intended shadow-comparison behavior.

### Thermo-nuclear

- **[MOD] `tradeToPosition` quantity-blind premium** — fixed:
  `entryFill.price × leg.multiplier × quantity`.
- **[MOD] Verify cleanup orphan `var-*` docs** — pass records which var
  scopes pre-existed; post-delete re-run heals shared scopes and
  explicitly deletes scopes created only by the run.
- **[LOW]** Orchestrator positional-dep count noted (consistent with
  existing style; builder-object refactor deferred).

## Test results

- `test:paper-trading` **102/102** · engine suites **143/143** · Jest
  **1865/1865** · tsc clean on changed files
- Prod verification `paper-trading-read-apis-565.ts`: **20/20** — real
  seeded trades → real stats pass → real handlers; self-healing cleanup.

## Notes

- Incidental: `partner.ts` dead import removed (pre-existing tsc error);
  pre-existing `broker-order-adapter` `.since` errors at HEAD are
  unrelated to this task (noted, not addressed).
- Deferred: unbounded `listTrades`/`listStats` scans (add `limit` when
  trade volume grows); `getPaperStats` omitted-scope enumeration is a
  documented contract choice.
