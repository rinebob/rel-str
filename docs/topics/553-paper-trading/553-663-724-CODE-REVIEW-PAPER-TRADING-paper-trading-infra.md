**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Blueprint:** #663 (BE)  
**Task:** #724  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Draft  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# Code Review — #724 BE engine settlement missed-night + weekend-expiry parity

## Scope

| File | Change |
|---|---|
| `functions/src/paper-trading/engine/passes/settlement-pass.ts` | `expiration !== date` → `expiration > date` skip; close read for the LEG's expiration via walk-back; dates carry the observed close's trading day |
| `functions/src/paper-trading/engine/options-strategy-market-data.ts` | NEW `getUnderlyingCloseOnOrBefore(symbol, settleDate, {reader, lookbackDays=7, minDate})` |
| `functions/src/paper-trading/passes/signal-settlement-pass.ts` | private `settleClose` replaced by the shared helper |
| `functions/package.json` | `settlement-pass.test.ts` registered (was orphaned — in no test script) |
| `tests/functions/options-strategy-engine/settlement-pass.test.ts` | 3 new tests: missed-night, Saturday→Friday walk-back, pre-entry-close bound |
| `functions/scripts/verify/paper-trading-engine-settlement-724.ts` + `scripts/verify/paper-trading-engine-settlement-724.md` | prod verify + guide |
| both `run-all.ts` + both verify `README.md` | registration |

## Design decisions to probe

- `expiration <= date` turns a missed/mismatched night into a retry (was: permanent zombie).
- Underlying close reads at the LEG's expiration (under `===` the run date coincided), walking back to the last trading day; `minDate = leg.openDate ?? pos.openDate` so a pre-entry close is never a basis.
- `closeDate` (observed bar date) flows to leg outcomes, `dailyUpdate.date`, `assignedAt` — same convention as #720's signal pass.
- `checkBrokerageOutcome` stays optional — absent → warn + not-assigned.
- The 7-day default lookback is shared between the two passes.

## Test results (post-review)

- `settlement-pass.test.ts` 13/13 (missed-night, Saturday→Friday walk-back, pre-entry bound, `openDate ''` floor, no-checker OTM settle, no-checker ITM refuse), `signal-settlement-pass.test.ts` 12/12, full `test:paper-trading` **154/154**; `tsc --noEmit` + build clean.
- Prod verify **19/19** re-run after fixes: missed-night trade at expiration-day close; Saturday-expiry at Friday close; account 2→0, +400; cleanup verified.

## Round 1 — findings and fixes

Three axes (standards / spec / adversarial) — **SPEC verdict PASS**, all actionable findings fixed:

| # | Severity | Finding | Fix |
|---|---|---|---|
| A1 | MED | `minDate: leg.openDate ?? pos.openDate` — adapter emits `openDate: ''` for migrated docs; `''` is falsy not nullish, so the floor silently disabled and a pre-open bar could settle the trade | `||` fallback to `pos.openDate`; new regression test; same class patched in the signal pass (`entryFill?.date || createdAt.slice(0,10)`) |
| A2 | MED | `checkBrokerageOutcome` has **zero implementations** — prod never injects it, so every settlement assumed `EXPIRED_WORTHLESS`; `<=` widened the blast radius from one night to any stale trade | ITM-guard: with no checker, OTM settles worthless (correct anyway) but an **ITM leg now errors loudly** instead of fabricating a worthless outcome; position stays eligible. Follow-up **#728** filed to wire/compute a real outcome |
| A3 | LOW | `markPositionSettled` accepted `ASSIGNED` — a latent double-settle (re-books premium + strike cash); unreachable from either pass | Tightened the txn guard to `OPEN`-only (both callers enumerate OPEN populations) |
| S1 | LOW | `UnderlyingCloseReader` defined 3× (settlement-pass export, signal-pass inline, shared module) | Single canonical type in `options-strategy-market-data.ts`; settlement-pass re-exports for the shim |
| S2 | LOW | Lookback default `7` duplicated as a literal in error messages | Exported `SETTLE_CLOSE_LOOKBACK_DAYS`; messages interpolate it |
| S3 | LOW | `as any` on `OptionType.CALL` in test; stale test-file header (`"on the run date"`); stale `getUnderlyingCloseForDate` docstring | Removed cast; both comments updated |

## Accepted gaps / follow-ups

- **#728** — no `BrokerageOutcomeChecker` implementation; until one ships (or ITM→assignment is computed locally), ITM engine trades error nightly instead of settling. Orphan-sweep and dead-code `symbol-data-sync.ts:215` noted in the issue body.
- Verify script is date-gated (needs bars ≥ 2026-09-29) — precondition asserts fail loudly rather than skip; ran green on 2026-10-01.
- Legacy `symbolDataSyncAdminHttp` completion path is dead code today; the canonical PDR path delivers the correct `marketDate`, so `<=` repairs the whole missed-date class regardless.

## Round 2 — convergence pass

One agent re-verified all round-1 fixes (re-export pattern correct under `isolatedModules`, guard ordering right, no stale callers, no circular imports, tests genuinely red→green) and surfaced:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | LOW | Same falsy-`''` hole one level deeper: `trade-adapter.ts` `entryFill?.date ?? createdAt` | `??` → `||`; and the pass now **errors loudly** when leg+position both lack a usable open date rather than settle with an unbounded lookback |
| F2 | LOW | `tradeToPosition` throwing inside `listOpenPositions`'s map runs outside the per-position try — a corrupt doc aborts the whole instance's pass | **Accepted** — pre-existing blast radius (unchanged by #724), requires out-of-contract docs, and a silent per-doc catch would be worse; noted for the orphan/sweep follow-up in #728 |
| NIT | — | `held-shares-pass` inlined the reader signature | Now uses shared `UnderlyingCloseReader` |
| NIT | — | Walk-back scans `lookback+1` dates ("7d" → 8 candidates) | Accepted — harmless widening |
| INFO | — | `PaperFill.date` contract allows ISO timestamps; `minDate` assumes `YYYY-MM-DD` | Latent — all current writers emit dates only |

**Convergence: PASS** — no new MEDIUM+ findings; every prior fix verified correct.

## Verdict

**REVIEW PASS — converged in 2 rounds.** #724 → `7_QA`; QA issue opened.
