**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1708  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1713  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# CODE-REVIEW: BE per-tick shadow-eval + first-fire accumulation (#1713)

## Scope reviewed

New: `paper-trading/engine/passes/shadow-eval-pass.ts` (~480 lines —
`runShadowEvalTick` + `evalPositionRule`), `options-strategy-engine/passes/
shadow-eval-pass.ts` (shim), `shadow-eval-pass.test.ts` (17 specs),
`scripts/verify/strat-manage-shadow-eval-1713.{ts,md}` (34 checks).
Modified: `options-strategy-pass-orchestrators.ts` (`runUnifiedMarkPass`
wires eval after marking, `evalError` isolation), `mark-pass.ts`
(`MarkPassPositionResult.trade`), `manage-exit-scan-pass.ts`
(`readResultDoc` dep + `firstFired*` carry-forward),
`shared/options-analysis-contracts.ts` (`firstFiredAt`/`firstFiredMark`),
`options-strategy-passes.test.ts`, `manage-exit-scan-pass.test.ts`,
`mark-pass.test.ts`, `functions/package.json` (spec registrations),
`scripts/verify/{run-all.ts,README.md,strat-manage-mark-pass-1712.ts}`
(regression repair).

## Pass log

```text
First pass complete — 1 major (regression: #1712 verify script fakes
  lacked `trade`, broke under the new default eval wiring) + 12 minors
  across Standards/Spec/Thermo-nuclear axes; all 3 ACs confirmed met
Second pass complete — all actionable findings remediated + spec'd
  (17/17 pass specs, 520/520 gate, both verify scripts green);
  documented acceptances: debit sign-space caveat, theoretical write race
  (mark cron ends 12:30 PT vs 2 PM PT scan — windows disjoint), write
  amplification, field-provenance nits
Convergence: PASS — no critical or major findings outstanding
```

## Standards axis

- **MAJOR (fixed)** — `scripts/verify/strat-manage-mark-pass-1712.ts`: fake
  `MarkPassResult.positions` lacked `trade` → real `runShadowEvalTick`
  threw → `evalError` broke the summary pin + `run-all`. Fixed: fakes now
  carry `strategyInstanceId: undefined` trades (no-credentials path —
  skipped), expected summary extended with `evaluated/fires/evalErrors`.
- **Minor (fixed)** — `manage-exit-scan-pass.test.ts` was orphaned from
  `test:paper-trading`; registered (gate went 494 → 520).
- **Minor (fixed)** — merge-write + `...(priorDoc)` spread could never
  clear a stale `error` field → `error: FieldValue.delete()` on the merge
  write (keeps forward-compat merge semantics).
- **Minor (fixed)** — `defaultReadResultDoc`/`carryFirstFire` duplication:
  the first-fire conditional-spread appeared 3×; extracted `carryFirstFire`
  helper. Shared doc reader/writer dedup deferred (nit).
- **Nits fixed** — `trade: {} as` fixture given real fields; dead
  `expression?.`/`?? ''` on a required string; `firstFiredAt as string`
  cast restructured; `evaluated++` no longer counts sticky-terminal
  early-returns; loose `fires >= 2` pinned to `=== 3`.
- **Clean** — file size (under 400-line pass threshold), shim convention
  matches siblings, `evaluateExit`/`stOptionsAnalysisResultDocId`/
  `aggregateExitType` signatures verified against real contracts, deps-seam
  pattern mirrors `ManageExitScanDeps` exactly.

## Spec axis

- **AC1** (all 6 rules × each tick's mark × open position) — MET with one
  documented scope carve-out: positions without `strategyInstanceId` can't
  key a doc (counted as `skippedNoInstance`); share-leg positions skipped
  for scan parity (`skippedNonOption`).
- **AC2** (`firstFiredAt` + fired mark, idempotent across ticks/restarts) —
  MET: sticky fields, terminal freeze, doc-persisted state, same-tick
  re-run byte-identical (spec), scan carry-forward (spec).
- **AC3** (analytics-only) — MET: no trade/position writes anywhere.
- TEST-doc US-6 + unit + integration-merge requirements all covered by
  specs or verify checks; trace coverage exercises real
  `evaluateExit`/registry/aggregate at every joint except the declared
  mark-pass seam.
- **Findings (fixed)** — `aggregate.contractCount` now counts positions
  (bucket ids + carried non-terminal records), matching the scan's
  `positions.length − skipped` semantics.

## Thermo-nuclear axis (Dr. Reed)

- **Root observation**: two writers co-own `trades` records with different
  construction logic. Several findings were symptoms; the deeper reframe
  (scan owns `trades`, tick owns a `firstFires` side-map) is recorded as a
  candidate future refactor — current design is correct, tested, and
  bounded to analytics.
- **Fixed**: re-cross `terminalMark`/`mae`/`mfe` now resolve at the
  original fire's mark + pre-rewrite excursion (contract: "the mark the
  outcome's economics resolved at"); post-expiry ticks carry the prior
  record instead of stamping `open` past expiry; `Promise.all` over the 6
  per-rule docs; `firstFiredMark: undefined` write-hazard guarded in both
  writers (Firestore rejects undefined).
- **Accepted (documented)**: debit-posture sign-space divergence between
  writers (header caveat; credit-native v1, afternoon rebuild corrects);
  read→write race is theoretical — mark cron `*/30 13-20 UTC` ends 12:30
  PT, scan runs 2 PM PT, no overlap; per-tick rewrite of unchanged docs
  (evaluatedAt refreshes make cheap no-op detection non-trivial);
  `templateId`/`pickDate` provenance nits self-correct at the EOD rebuild.

## Test results

- `test:paper-trading` gate: **520/520** green (includes newly-registered
  `manage-exit-scan-pass.test.ts` + 17 shadow-eval specs).
- `tsc --noEmit -p functions/tsconfig.json`: clean.
- `scripts/verify/strat-manage-shadow-eval-1713.ts`: ALL CHECKS PASSED (34).
- `scripts/verify/strat-manage-mark-pass-1712.ts`: ALL CHECKS PASSED
  (post-repair).

## Verdict

**PASS** — 1 major found in-gate and remediated; minors dispositioned;
no critical or major findings outstanding.
