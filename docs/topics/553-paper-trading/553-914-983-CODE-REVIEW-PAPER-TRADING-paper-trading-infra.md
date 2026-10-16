**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Signals Auto Paper Trade  
**Thread Slug:** signals-auto-paper-trade  
**Issue:** #914  
**Thread Parent:** #904  
**Topic Parent:** #553  
**Task:** #983  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# CODE-REVIEW — #983 signal-trade EOD close stamp

## Scope

`functions/src/paper-trading/passes/signal-eod-close-pass.ts` — new
nightly pass stamping the SDS daily close into `marks[date]` on OPEN
share-leg signal trades. `functions/src/paper-trading/repository.ts` —
`markSignalTrade` accepts + persists `underlyingClose`.
`functions/src/paper-trading/engine/options-strategy-pass-orchestrators.ts`
— pass wired first in the nightly chain, before exit eval.
`functions/scripts/verify/paper-trading-eod-close-983.ts` + README —
read-only drift report. `tests/functions/paper-trading/
signal-eod-close-pass.test.ts` (8 specs) + `repository.test.ts` (3 new
`markSignalTrade` specs).

## Verdict: PASS

## Standards

- Pass mirrors `signal-settlement-pass` conventions exactly: injectable
  deps seam, `defaultXDeps` factory, per-trade error capture, summary
  interface, module docblock with `@topic` + rationale. 164 lines.
- `markSignalTrade` extension is minimal — optional `underlyingClose`
  merged into the existing `marks[date]` entry; intraday callers
  unchanged (field omitted when undefined).
- Orchestrator param added last, lazy default `(date) => …(paperDb)` —
  no prod-dep construction at module load; own try/catch matching the
  eval/settlement pattern (a stamp failure must not skip eval).
- Verify script is read-only, usage-documented, indexed in
  `functions/scripts/verify/README.md`.

## Spec (#983 issue)

| Requirement | Status |
|---|---|
| `marks[date]` = official SDS daily close | MET — `getUnderlyingCloseForDate`, same source settlement uses |
| Stamped before `evalPass` | MET — chain order spec asserts `eod-close → eval → signal-settlement → paper-stats` |
| Equity (share) legs only | MET — `legs.some(l => l.kind !== 'share')` → skip; option legs keep intraday marks (settled via #720 pass) |
| Refresh `unrealizedPnl` + `lastMark` | MET — `computeExitPnl` (canonical, direction-aware via `order.side`); `markSignalTrade` updates `legs[0].lastMark` for single-leg trades |
| Raw-quote audit `pass: 'eod-close'` | MET — `{mark, source: 'sds-daily-close', pass: 'eod-close'}` |
| Fail-soft on missing bar | MET — `skippedNoClose`; intraday mark stands |
| Non-OPEN race | MET — txn re-read returns `false` → `skipped` |
| Idempotent retry | MET — same `marks[date]` key overwritten |
| No doc bloat | MET — one mark/day, no new map keys |

## Thermo-nuclear

- Proportional: one focused pass module, no abstraction creep, no
  conditionals bolted onto eval/settlement paths.
- NIT — no SHORT-direction spec for the `unrealizedPnl` recompute; the
  sign logic is canonical `computeExitPnl` (ledger-tested), so the gap
  is cosmetic. Accepted.
- NIT — `!Number.isFinite(close)` is belt-and-suspenders on a typed
  `number | null`. Harmless.

## Tests

- `signal-eod-close-pass.test.ts`: 8/8 (stamp-over-intraday, no-bar
  stands, option-leg skip, closed-mid-pass skip, leg-less skip, write
  error captured, empty universe, chain ordering).
- `repository.test.ts`: 3 new `markSignalTrade` specs (eod stamp shape,
  intraday path unchanged, non-OPEN no-op) — repo-level coverage was a
  second-pass fix after review found it only transitively covered.
- Paper-trading suite: 222/222. `tsc -p functions/tsconfig.json` clean.
- `git diff --check` clean.

## Notes

- Pre-fix drift is live-verified: `paper-trading-eod-close-983.ts`
  reported 147/147 share-leg trades drifted on 2026-10-15 (AVGO mark
  344.21 vs close 338.95; STX 690.61 vs 675.10).
- Known incident recorded on #983: an earlier ordering-spec stub
  misalignment ran the real `evalPass` against prod once
  (`evaluated=155, closes=1`). Same pass/data as tonight's nightly —
  idempotent — but disclosed for the record. Stub alignment fixed.
- Deploy-pending: the pass is a nightly-chain step — first live stamp
  lands with the next `runSettlementForAllInstances` invocation after
  deploy. QA verifies via the drift report flipping to `ok=N drifted=0`.
