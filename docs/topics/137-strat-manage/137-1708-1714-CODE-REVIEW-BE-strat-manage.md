**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1708  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Task:** #1714  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-26  
**Last Updated:** 2026-11-26  

# CODE-REVIEW: BE position-grain settlement + held-shares (#1714)

BE Blueprint: position-grain mark + settle + shadow-eval passes
Thread: Live Position Lifecycle

## Scope reviewed

`functions/src/paper-trading/engine/passes/settlement-pass.ts` (rewrite) ·
`functions/src/paper-trading/engine/passes/held-shares-pass.ts` (rewrite) ·
`functions/src/paper-trading/engine/position-repository.ts`
(`listAssignedTrades`, `markPositionSettled` delivery-cash fix,
`markHeldSharesPosition` dep narrowing) ·
`functions/src/paper-trading/engine/options-strategy-pass-orchestrators.ts`
(instance loop → sweep, `Promise.allSettled`) ·
`functions/src/paper-trading/engine/options-strategy-passes.ts` +
`functions/src/symbol-data-sync/{sds-completion-deps,sds-consumer-dispatch}.ts`
(rename call sites) · `functions/src/paper-trading/engine/types.ts`
(`SettlementData.deliveryCash/orderExitPrice`, `PositionShares` unit doc) ·
`functions/src/paper-trading/engine/position-ids.ts` (dead `findPrimaryLeg`) ·
4 spec files · 2 verify scripts + `run-all.ts`/README registrations ·
`functions/package.json` (test registrations)

Foreign work built upon (not authored by this session): the `#728`
computed-ITM local outcome + `BrokerageOutcomeChecker` seam inside
`settlement-pass.ts` and its pre-existing specs — kept and carried into the
rewrite; provenance must be noted at ship. `test:signal-detection` +
`chart-data-assembler.spec.ts` WT hunks are foreign `#1728` work — excluded.

## Pass sequence

```text
First pass complete — Standards: 1 CRITICAL (signal-eod-close spec calling the
retired 8-arg orchestrator signature — injected fakes shifted off their slots,
production defaults would hit real Firestore inside a "hermetic" spec; the file
was also unregistered in the gate) + 4 minor + 7 nit. Spec axis: all 5 ACs MET,
1 MEDIUM (tradeToPosition outside per-position try — one malformed zombie doc
aborts the whole sweep) + 3 low. Thermo: 1 CRITICAL (net-flat offsetting
delivery books zero cash — a fully-ITM spread records a fabricated win: cash
never moves, equity gains the spread width, variant run exits at 0) + 5 MAJOR
+ 10 minor + test-quality gaps.
Second pass complete — serial coverage check over the full diff: every hunk
accounted to an axis finding or an AC; error paths spec'd (adapter-throw,
missing expiration, missing close, net-short, per-position isolation,
orchestrator sibling failure) or covered by the real-Firestore verify script.
No new findings; no unexamined error paths.
Convergence: PASS — all CRITICAL/MAJOR findings fixed in-gate and re-verified;
remaining items are documented minors/pre-existing conventions.
```

## Verdict

**PASS** — after in-gate fixes. Every CRITICAL and MAJOR finding was fixed and
re-verified (550/550 `test:paper-trading`, 81/81 `test:sds`, tsc clean,
25/25 real-Firestore verify including the flat-spread accounting proof).

## Findings — fixed in gate

### Critical

- **[Standards] `signal-eod-close-pass.test.ts` used the retired 8-arg
  orchestrator signature** — args shifted, `heldSharesPass`/`evalPass` fakes
  fell through to production defaults (real Firestore writes inside a
  "hermetic" spec); file was also orphaned from `test:paper-trading`.
  Fixed: new 7-arg signature + trivial fakes + pass-order assertion;
  registered in the gate.
- **[Thermo C1] Net-flat offsetting delivery booked zero cash** — a fully-ITM
  spread (net 0) hit `markPositionSettled`'s `expired` branch: `cashDelta=0`
  (real −width×100 dropped), equity inflated by the spread width, realized
  booked premium-only, governing variant run exited at 0 (fabricated
  max-profit on a max-loss trade). Fixed end-to-end:
  - `SettlementData` += optional `deliveryCash` (Σ sign×strike×qty, contract
    units) + `orderExitPrice` (per-unit net order intrinsic) — backward
    compatible for the signal pass.
  - `markPositionSettled`: `cashDelta = −deliveryCash×100` unconditionally
    (falls back to `strike×qty` when absent); realized books
    `premium + cashDelta` when no shares stay on the book; `exitPrice =
    orderExitPrice ?? existing-formula`; stats `totalRealizedPnl` gets the
    same realized delta.
  - The pass computes both for every leg set (worthless legs contribute 0).
  - Proven on real Firestore: flat spread → EXPIRED, both legs ASSIGNED,
    `realizedPnl = 200 − 3000 = −2800`, governing run exits at 30 (net
    intrinsic), account cash debited by true delivery totals.

### Major

- **[M1] `tradeToPosition` outside per-position try** (both passes) — one
  malformed zombie doc aborted the whole sweep. Moved inside; error keyed by
  `trade.id`. Spec added.
- **[M2] Orchestrator `Promise.all` + fabricated catch** — a rejecting pass
  discarded its sibling's real result and double-counted one error into two
  fabricated `(sweep)` rows. Now `Promise.allSettled` with per-pass
  attribution (`(settlement-sweep)`/`(held-shares-sweep)`). Spec added.
- **[M3] Variant `exitPrice` keyed off `legOutcomes[0]`** — arbitrary leg
  order could flip intrinsic direction. The pass now always supplies
  `orderExitPrice` (order-level net intrinsic over all legs); the fallback
  remains only for callers that don't supply it (signal pass — single-leg
  context).
- **[M4] `shares.quantity` is contracts under a shares name** — documented on
  both type surfaces (`PositionShares`, `PaperTrade.shares`). FE rendering of
  the raw contract count ("1 @ $100") is a pre-existing display convention —
  flagged, not fixed in this BE task.
- **[M5] Id-less legs collided on `legId: ''`** — the outcome map deduped to
  one outcome adopted by all. `markPositionSettled` now looks up only
  non-empty `leg.id`; id-less legs stay unstamped instead of mis-stamped.

### Minor / nit

- Dead `listHeldSharesPositions` + `findPrimaryLeg` removed; dead `deferred`
  field removed; close sanity guard; in-pass SIGNAL filter on held-shares;
  checker warn once per position (was per leg); malformed-leg explicit
  expiration guard (was a cryptic RangeError); `getUnderlyingClose` now
  defaults to `getUnderlyingCloseForDate` in both passes (one convention);
  `markHeldSharesPosition` update narrowed to the fields it actually writes;
  orchestrator/spec `as unknown as` casts removed (fakes typed to param
  signatures); stale "per-instance" comments corrected.
- Test gaps filled: leg `quantity>1`, multi-strike weighted basis,
  adapter-throw isolation, malformed-expiration, orchestrator failure,
  flat-spread `deliveryCash`/`orderExitPrice` assertions.

## Accepted / deferred

- **`markPositionSettled` repo-level hermetic specs absent** — the real write
  path is proven by `strat-manage-settlement-1714.ts` against real Firestore
  (25 checks); a hermetic txn spec needs an emulator the suite doesn't wire.
- **`SettlementPassPositionResult.unrealizedPnl` reports `premiumCollected`**
  for EXPIRED — terminal-P&L-rides-unrealized convention; misreports for
  hypothetical LONG orders (cosmetic result field; the doc write uses 0).
- **`premiumCollectedFor` uses `legs[0].multiplier`** — pre-existing (#1563),
  only matters for share-first leg orderings.
- **Mixed share+option trades** — settle their option legs while share legs
  carry no outcome; producers can't mint these today (commented in pass).
- **`position-repository.ts` ~600 lines** — pre-existing size, no new debt.

## Test results

- `test:paper-trading`: **550/550** (includes 27 settlement + 6 held-shares +
  orchestrator sweep/failure + fixed signal-eod-close specs)
- `test:sds`: **81/81**
- `npx tsc -p functions/tsconfig.json`: clean
- Real-Firestore verify `strat-manage-settlement-1714.ts`: **25/25** — zombie
  settles, signal untouched, spread → shares at short strike, flat spread →
  real width cash debit + honest realized + intrinsic exit, held mark vs
  run-date close. Corpus: 123 OPEN trades, 0 without `strategyInstanceId`.
- `paper-trading-engine-settlement-724.ts` (repaired): 19/19
