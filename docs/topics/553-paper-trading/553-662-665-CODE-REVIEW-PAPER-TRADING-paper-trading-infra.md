# Code Review — #665 SHARED Trade Exits contracts

**Status:** Complete — PASS (3 rounds; round 3 = no new findings)  
**Topic:** Paper Trading Infra (#553)  
**Blueprint:** #662 (SHARED)  
**Task:** #665  
**Domain:** PAPER-TRADING  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

## Changes reviewed

- `shared/paper-trading-contracts.ts` — `CANCELLED` status;
  `trailing-8` seeding defaults (empty shadows); `VariantFamily` +
  `TERMINAL_VARIANT_FAMILIES`; close/cancel callable contracts
- `shared/paper-trading-contracts.spec.ts` — 4 new contract tests
- `functions/src/paper-trading/engine/trade-adapter.ts` — `CANCELLED →
  PositionStatus.CLOSED` in the exhaustive switch
- `functions/src/paper-trading/passes/paper-stats-pass.ts` — CANCELLED
  excluded from every rollup scope
- `tests/functions/paper-trading/{paper-stats-pass,trade-adapter}.test.ts`
  — new coverage
- `functions/scripts/verify/paper-trading-signal-order-564.ts` —
  re-baselined variant assertions to #652 (single governing `trailing-8`)
- `scripts/verify/paper-trading-contracts-665.{ts,md}` — credential-free
  verify script + guide, registered in `run-all.ts` + `README.md`

## Axis summaries

**Standards** — conventions match (comments explain why, verify script +
guide + run-all registration follow #560 precedent, exhaustive switch
consumers all handled). One major found and fixed.

**Spec** — all five task ACs met; FE-side items (`CallableName`,
family select restriction, `'none'` parse fallback) correctly deferred
to task #672 with behavior-equivalent fallbacks already present.

**Thermo-nuclear** — one latent major identified (see below) requiring a
new thread-scoped task; two minors resolved or deferred with ACs.

## Findings

| Severity | Finding | Disposition |
|---|---|---|
| major | #564 verify script asserted `variantRuns.length === 4` + governing `'none'` — stale post-#652, would fail prod verify | **Fixed** — asserts single governing `trailing-8` run; guide updated |
| major (latent) | `SIGNAL_GOVERNING_VARIANT='trailing-8'` is inert on signal trades — mark pass covers only `source=STRATEGY` positions; signal trades get marks only at fill, so the governing stop can never fire and every OPEN signal trade becomes a permanent `skipsNoMark` eval candidate | **New task #676** created under BE blueprint #663 (mark coverage for signal-source trades) |
| minor | Cancelled trades would keep an `ACTIVE` seeded variant run forever | AC added to **#666** — cancel must finalize seeded runs |
| minor | `CANCELLED → CLOSED` adapter mapping could leak into engine stats path if cancels ever extend to `source=STRATEGY` | Unreachable today (only PENDING cancellable, all PENDING are `source=SIGNAL`, engine lists filter STRATEGY); fold exclusion sits at the right seam |
| nit | Verify script shape checks partly tautological | Accepted — compile-shape is the contract surface |
| nit | `VariantFamily` local alias duplicates shared export in strategy-builder | Deferred to #672 |

## Round 2 — verification + new findings

- **Major (fixed)** — `resolveAccountOwner` (eval-pass.ts) resolved the
  account owner *only* via `strategyInstanceId` → instance doc. Signal
  trades carry `userId` on the doc precisely for server-side fills but the
  resolver ignored it — a governing `trailing-8` on a signal trade would
  have logged "no userId resolved" and skipped the close forever (masked
  until #676 lands). Fix: prefer `trade.userId`, fall back to the instance
  lookup; exported + covered by 3 new unit tests.
- **Minor (deferred to #666)** — cancel-during-fill race: a cancelled
  PENDING trade correctly throws inside the fill-pass txn but lands in
  `summary.errors` — should classify as `skipped`.
- **Minor (deferred to #671)** — store has no cancelled selector; cancelled
  trades vanish from dashboard lists until the FE task adds the bucket.
- **Nit (fixed)** — verify guide's hardcoded "15 checks" (16 when fills
  land).
- All round-1 fixes verified in place.

## Round 3 — verification

**No new findings.** `resolveAccountOwner` fix verified: doc-level `userId`
is the correct winner (it's the account credited at entry); migrated
STRATEGY trades still exercise the instance fallback. Informational notes
recorded on the owning tasks:

- `markPositionSettled` resolves owner via instance only — unreachable
  today (STRATEGY-scoped); noted for consistency if signal-source
  settlement ever lands.
- FE bucket filters drop ASSIGNED/EXPIRED trades — display-only, flagged
  for #671.
- Stale `signal-order.test.ts` assertion (`variantKeys` including
  `initial-stop-10`) found by the full paper-trading suite run and
  re-baselined to `['trailing-8']`.

## Test results

- `npx jest` — 158 suites, **2139/2139** pass
- `npx tsx --test tests/functions/paper-trading/{paper-stats-pass,trade-adapter}.test.ts` — 20/20
- `npx tsx scripts/verify/paper-trading-contracts-665.ts` — 8/8 OK
- `functions` esbuild clean; `tsc --noEmit` — only pre-existing unrelated `rh-agent-mcp` errors

## Verdict: PASS
