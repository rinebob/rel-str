**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Core Infra  
**Issue:** #558 (BE Blueprint)  
**Task:** #563 — Exit engine: variant registry, rules, nightly eval pass  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Reviewed:** 2026-09-25  
**Last Updated:** 2026-09-25  
**Verdict:** PASS (5th pass — all three axes clean on final state)

## Pass 5 — re-review remediation

Fifth pass found one real cross-module defect plus hardening:

1. **UTC vs PT mark-key basis** (TN MEDIUM): `mark-pass` keyed
   `marks[rawQuote.date]` by UTC slice while eval/settlement key PT market
   dates — a post-midnight-UTC mark would land under tomorrow's key and
   eval could fire on a day-old mark, defeating the no-stale-mark guard.
   Fix: marks now key on `normalizeMarketDate(markedAt)` (PT basis).
   mark-pass test assertion updated to `getMarketDatePT()`.
2. **NaN mark poison** (Standards + TN): a NaN mark would write
   `lowWaterMark: NaN` nightly forever. Fix: non-finite marks are counted
   as skips + error entries.
3. **`none`-run perpetual candidacy** (TN LOW): engine trades' inert
   `none` runs kept every trade a nightly eval candidate. Fix:
   `listCandidateTrades` requires an ACTIVE run whose key parses.
4. **Docs**: `ExitEvalDeps.listTrades` documents the status scope
   (PENDING/EXPIRED excluded); `VariantExitEvent.price` documents the
   three exit bases (mark / 0 / intrinsic); `quoteSource: RH_MCP` fill
   provenance comment added (`PaperMark` lacks a source field — #564
   follow-up if AV_EOD marks ever land).

Pass-5 results: 511/511 node, 1865/1865 jest, 15/15 + 26/26 prod verify,
tsc clean.

## Pass 4 — re-review remediation

The fourth pass found one race-condition bug plus supporting hardening:

1. **Settle↔eval race could resurrect a finalized run** (TN MEDIUM): eval
   snapshots a trade, settlement finalizes the governing run in its txn,
   then eval's `updateVariantRun` first-match replace could write the
   stale ACTIVE run back over EXITED. Fix: `updateVariantRun` now treats
   `EXITED` as terminal — the txn re-read guards against overwrite. This
   closes the whole class (not just the governing-resurrection scenario).
2. **ASSIGNED exitEvent was dishonest** (Spec MEDIUM): `price: 0,
   pnl: premium` hid the assignment loss. Fix: `price` = intrinsic value
   at assignment (`strike − underlyingClose` for puts, inverse for calls),
   `pnl` = `computeExitPnl(entry, intrinsic)` — e.g. premium 210, ITM
   2.5 → −40, not +210.
3. **Trailing-run write amplification** (TN LOW): `evaluateVariant` always
   returns workingState → txn per run per night even when the water mark
   didn't move. Fix: shallow-compare before write.
4. **`daysBetween` name collision**: `common/` already had a nullable
   `daysBetween` in option-contract-selection.ts — ours renamed to
   `calendarDaysBetween` with a cross-reference comment.
5. **Coverage gaps**: verify-562 now seeds governing + shadow runs and
   asserts settlement finalizes the governing run (`EXITED`, honest
   exitEvent) while leaving shadows ACTIVE. Closed-position round-trip
   test added (symmetric `unrealizedPnl`↔`realizedPnl` convention).

Pass-4 results: 511/511 node, 1865/1865 jest, 15/15 + 26/26 prod verify,
tsc clean.

## Pass 3 — re-review remediation

The third pass surfaced a real stats hole plus supporting fixes:

1. **Governing closes lost realized P&L in stats/equity** (TN HIGH, Spec):
   `tradeToPosition` dropped `trade.realizedPnl` and mapped
   `unrealizedPnl` — but `computeStatsFromPositions` reads a CLOSED
   position's realized number *from* `unrealizedPnl`. Every governing-
   close trade would have contributed 0. Fix: adapter emits
   `unrealizedPnl = trade.status === CLOSED ? trade.realizedPnl :
   trade.unrealizedPnl` — mirroring `positionToTrade`'s convention. New
   adapter test.
2. **Settlement never finalized variant runs** (TN MEDIUM): expired/
   assigned trades left ACTIVE governing runs invisible to eval. Fix:
   `markPositionSettled` now finalizes ACTIVE governing runs in the same
   txn — exitEvent `{date: settleDate, price: 0, pnl: premium}` is the
   honest "option terminated at expiry" event. Shadows stay ACTIVE
   (inert, not dropped).
3. **`entryPrice()==0` degenerate trigger** (both axes): an OPEN trade
   with marks but no entry fill would fire every stop instantly
   (`mark >= 0` for SHORT). Fix: eval skips entry-less openish trades
   with an error entry.
4. **fillId per-trade uniqueness** (Spec): `exit-{variantKey}-{date}` →
   `exit-{tradeId}-{variantKey}-{date}` for debuggability.
5. **PENDING trades** (TN LOW): documented exclusion in
   `listCandidateTrades` — no entry fill → can't honestly fire; they're
   outside the query anyway.
6. **Contract doc drift**: `VariantRun` comment claimed `time-stop`
   writes `daysHeld` workingState — it never did; `daysHeld` is derived
   at eval time. Comment corrected.
7. **`daysBetween` moved** to `common/pt-date-utils` (shared date home;
   now consumed by both eval-pass and settlement).

Pass-3 results: 510/510 node, 15/15 + 24/24 prod verify, tsc clean.

**Residual deferrals (documented, non-blocking):** ASSIGNED governing
triggers log an error nightly until the assigned-share exit seam lands
(#568 config); ASSIGNED/CLOSED shadow eval requires marks to land on
non-open trades (mark-pass plumbing, deferred); nightly eval ordering
assumes marks landed before the SDS-driven settlement trigger (same-day
manual mark passes after 00:00 UTC write next-day keys — pre-existing
mark-pass date-basis caveat); `rawQuoteRef` not stamped on eval exit
fills; unbounded CLOSED scan + per-run write amplification (scale).

## Pass 2 — re-review remediation

A second full review pass (all three axes re-run on the remediated code)
surfaced four more items, all fixed:

1. **Fabricated backfill exitEvent** (Standards + Spec): a CLOSED trade
   with an ACTIVE governing run but no exit fill got a synthetic event at
   `price: mark ?? 0`. Now an error entry; the run stays ACTIVE — no
   invented counterfactual.
2. **`skipsNoMark` under-counted**: moved into `evalOne` — counted per
   run, so closed-trade shadows skipped on a mark gap are counted too.
3. **`applyEntryFill` governing invariant** (Spec unguarded + TN latent):
   `variantKeys` is now deduplicated and must include `governingVariant`
   — a misconfigured caller throws instead of seeding zero governing runs
   or an unreachable duplicate (which `updateVariantRun`'s first-match
   `findIndex` would mask). Two new ledger tests cover both.
4. **Verify script equity hole** (TN): added
   `account: equity = −220` assertion — the only unverified ledger write.
   Also cleaned a stale self-questioning comment. Now 15 checks.
5. **Test artifact masking** (Spec): the shadow-on-closed test used a
   duplicate variantKey for both runs — switched to distinct keys
   (`time-30d` governing EXITED + `initial-stop-10` shadow ACTIVE) so it
   exercises the real `findIndex` path faithfully.

Pass-2 results: 509/509 node, 1865/1865 jest, 15/15 prod verify.

## Pass 1 summary

## Summary

**Scope:** exit-variant engine for paper trading — `exits/registry.ts`
(key-parsed typed params + pure `evaluateVariant`), `exits/eval-pass.ts`
(nightly per-variant evaluation with crash-safe sequencing),
`computeExitPnl` extracted in `ledger.ts` (shadow events use the ledger's
own P&L math), eval wired into `runSettlementForAllInstances` before the
per-instance settlement loop (marks → eval → settlement → stats). Prod
verification script seeds namespaced trades and drives the real
`defaultEvalDeps` against prod Firestore.

## Findings by severity

### Critical — none on final state.

### Major — none on final state.

Two findings from the first pass were remediated before verdict:

1. **Shadow eval after governing close was dead** (Spec criterion 4 + TN
   MEDIUM). The CLOSED branch `continue`d before shadow runs were
   evaluated, and the header/`listCandidateTrades` docs overstated
   "shadows keep evaluating after close." **Fix:** all ACTIVE runs now
   evaluate whenever `marks[date]` exists — CLOSED-trade shadows keep
   measuring while marks land (mark-pass coverage for closed trades is
   explicitly deferred plumbing), and a closed governing run is backfilled
   from the exit fill. New test covers shadow-eval-on-closed.
2. **ASSIGNED governing close would miscompute** (Spec Q4). `applyExitFill`
   accepts ASSIGNED but prices the exit at option-mark math against the
   option premium — wrong for delivered shares. **Fix:** governing closes
   are gated to `status === OPEN`; a governing trigger on an ASSIGNED
   trade records an error and skips (assigned-share exits need a dedicated
   seam — flagged for the exit-policy-config task). New test covers the
   error path.

### Minor — noted, accepted

- **Unbounded CLOSED scan** (`eval-pass.ts` `listCandidateTrades`): three
  status queries nightly. Needed for crash backfill + shadow eval; volume
  is small today. Scale item — bound by `updatedAt` or a denormalized
  `hasActiveRun` flag if trade history grows.
- **Write amplification**: one `updateVariantRun` transaction per run per
  night. A batched `updateVariantRuns` would be 1 txn/trade — deferred to
  scale.
- **Two-commit governing close** (ledger txn then run txn): honest
  sequencing — ledger first so a failed run update can never lose the
  close; backfill reconstructs the event from the exit fill. Verify check
  #6 proves no re-close.
- **`daysBetween` is calendar days** — documented; `time-{N}d` counts
  wall-clock days by design.
- **`limit-stddev` is registered-but-inert** — deliberate stub until the
  StdDevLines algo lands; `underlyingClose` in the ctx is reserved for it.
- **Orchestrators file at 303 lines** — eval wiring is thin orchestration;
  borderline, no action.

### Remediated minor violations

- `as never` account stub in eval-pass test → real typed `PaperAccount`.
- `quoteSource: 'RH_MCP'` string literals in tests → `OptionQuoteSource.RH_MCP`.
- `{ ...ctxBase, run } as VariantEvalCtx` cast → `ctx` typed
  `Omit<VariantEvalCtx, 'run'>` construction inline; no cast.
- `86_400_000` magic number → `MS_PER_DAY` const.
- Verify script `multiplier: 100` → `SHARES_PER_CONTRACT`.

## Spec axis — acceptance criteria

| Criterion | Verdict |
|---|---|
| Typed param shape + pure evaluate | MET — `VariantDef` discriminated union parsed from key; pure direction-aware evaluators |
| variantRuns seeded for all configured variants, one governing | MET at the ledger seam (`applyEntryFill` seeds `dims.variantKeys`, governing guaranteed). Config source (`exit-variant config` UI) is #568's scope — engine trades seed the inert `none` sentinel until then |
| Governing breach → closing fill; shadow → exitEvent {date,price,pnl,daysHeld} | MET — `applyExitFill` at the mark; `computeExitPnl` shared for events |
| Shadow runs evaluate independently, incl. after governing close | MET (post-remediation) — same-pass eval on the in-memory open trade; post-close eval whenever marks land |
| Unit tests per rule + eval-pass integration | MET — 13 registry tests (all families, both directions, water-mark seeding, malformed keys) + 8 eval-pass tests |

## Standards axis

Ledger-first sequencing is the correct order for the two-commit close;
`updateVariantRun` read-modify-write is txn-safe; `resolveAccountOwner`
fails closed (skip + logged error). No public callables added. Tests are
typed, deterministic, no timers. Remaining items are documented above.

## Thermo-nuclear axis

Atomicity verified correct on final state (ledger first → backfill
reconstruction; `applyExitFill`'s OPEN-status guard makes re-closure
impossible). Registry key-parsing depth judged right for single-param
variants; multi-param variants will need a stored-params shape — noted for
#568. Order-level `marks[date].mark` matches the documented multi-leg
caveat elsewhere in the system.

## Test results

- Node suite: **507/507** (includes 21 new exit-engine tests)
- Jest: **1865/1865** (137 suites)
- tsc (functions): clean on all touched files
- Prod verification: **14/14** — real governing close + account ledger,
  shadow event, working-state update, mark-gap skip, `none` inert,
  re-run no-double-close

## Verification

`functions/scripts/verify/paper-trading-exit-eval-563.ts` — seeds
`verify-563-` docs, runs `runExitEvalPass(date, defaultEvalDeps())`
against prod, asserts 14 invariants, cleans up. Guide:
`scripts/verify/paper-trading-exit-eval-563.md`; registered in
`scripts/verify/run-all.ts` + README index.
