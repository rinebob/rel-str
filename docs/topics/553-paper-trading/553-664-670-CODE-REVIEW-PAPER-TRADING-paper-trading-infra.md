**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #664  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Task:** #670  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# Code Review — #670 FE: PaperTradingService + store close/cancel actions

**Verdict: PASS** — three parallel axes (Standards / Spec / Thermo-nuclear),
no critical or major findings. Four minors + spec gaps remediated in-pass;
remaining items are accepted nits documented below.

Files under review (uncommitted worktree, scoped diff):

- `src/app/core/common/constants.ts` — `CallableName.CLOSE_PAPER_TRADE` /
  `CANCEL_PAPER_TRADE` only (the file's other dirty hunks belong to the
  concurrent #1017 session — out of scope)
- `src/app/features/savant-trader/services/paper-trading.service.ts` (+spec)
- `src/app/features/savant-trader/stores/paper-trading.store.ts` (+spec)

Scope note: dashboard buttons + confirm UI are task #671 — this review
covers the service/store seam only.

## Standards

**Contract baseline — verified, no drift.** Callable names match the BE
exports (`functions/src/index.ts:152-153`); `{tradeId}` matches
`ClosePaperTradeRequest`/`CancelPaperTradeRequest`
(`shared/paper-trading-contracts.ts:542-556`); response types match
(contracts :545-559; callables.ts:724,951-956). The IMPL plan's
`cancelPaperTrade$ → void` was stale vs the shipped `{tradeId}` contract —
the as-built doc records the correction. Callable-name + payload contract
is pinned in the service spec (guideline §10 satisfied).

Findings — all MINOR, disposition:

| Finding | Disposition |
|---|---|
| **M1 — untyped request side.** New wrappers passed an ad-hoc `{tradeId}` literal; every sibling method uses its shared request type. A grown/renamed field wouldn't fail compile. | **Fixed** — `ClosePaperTradeRequest`/`CancelPaperTradeRequest` typed at both call sites. |
| **M2 — store file now 333 lines > 300 target.** The +52-line addition is cohesive; the bulk is the pre-existing group-by `withComputed` block. | **Accepted** — not a #670 blocker; natural future split is extracting the group-by computeds into a `withComputed` feature file. |
| **M3 — `toMessage → patchState(error) → snackBar` block duplicated 4×.** | **Fixed** — consolidated into a `reportError(err, fallback)` helper; all four sites delegate. |
| M4 — `catchError → of(null)` + `res !== null` sentinel as the success signal. | **Accepted nit** — subscribe{next,error} or materialize would be cleaner; works correctly. |
| M5 — `onSuccess` param initially speculative (both callers passed `loadAll`). | **Resolved** — now genuinely varied: close → `loadAll` (realized P&L books cash), cancel → `loadTrades` (no cash moves, PRD US2). |

## Spec

**All criteria met.** Every scoped item verified against the working tree:
enum names, `{tradeId}` payloads, unwrapped responses, `actingTradeIds` +
`actingIds`, mark→invoke→reload/error→finalize lifecycle, in-flight dedup,
`toMessage` auth mapping, and untouched loadTrades/includeAutoPaper/
grouping semantics. The plan→as-built divergence (`void` → `{tradeId}`)
is documented and correct vs the shipped contract.

Non-blocking notes, both remediated:

- `loadAll()` on cancel refetched the account unnecessarily — **fixed**,
  cancel now calls `loadTrades()` only (pinned by spec).
- "Trade row unchanged" test-plan clause was only implied — **fixed**,
  failure spec now asserts `store.trades()` identity unchanged.
- Cancel's snackbar wasn't asserted — **fixed**.

## Thermo-nuclear

Contract matrix clean across all five layers (enum ↔ service ↔ shared
contracts ↔ BE exports ↔ guard ladders). RxJS lifecycle verified: lazy
`invoke()` is load-bearing (`call()` fires eagerly), `finalize` clears on
every path including `takeUntilDestroyed` teardown, untracked mutation
subscription is the correct asymmetry vs cancellable loads, per-tradeId
serialization works.

Findings — all MINOR/nit:

| Finding | Disposition |
|---|---|
| **F2 — synchronous `invoke()` throw leaks the acting flag.** A throw before returning the Observable (destroyed injector, service throw) pins the id forever. | **Fixed** — `defer(() => invoke())` routes sync throws into `catchError`/`finalize`; spec pinned. |
| **F3 — test gaps.** Concurrent actions on different tradeIds and failure-then-retry untested. | **Fixed** — both specs added; the multi-id spec also pins flag independence. |
| F4 — `onSuccess` param speculative. | Resolved (see Standards M5). |
| F5 — `res !== null` sentinel. | Accepted nit (same as M4). |
| F6 — auth message reads "…to **view** paper trading data" on a failed mutation. | **Accepted** — pre-existing shared `toMessage`; rewording it would touch every load path — out of scope. |

#671 readiness: everything the UI needs exists — `actingIds:
ReadonlySet` for row spinners, `openTrades`/`pendingTrades` for verb
eligibility, `error` + snackbar surface. No dead API surface.

## Test results

```text
Focused (service+store specs)   32/32 PASS (9 original + 3 new
                                 remediation specs)
All paper-trading* suites       115/115 PASS (re-verified pre-remediation;
                                 focused re-run post-remediation green)
tsc --noEmit -p tsconfig.app    clean
git diff --check                clean
Full suite                      4,374/4,381 — 7 failures in 6 suites, all
                                OUTSIDE this diff's surface: manual-order
                                + option-order-ticket (concurrent #1177/
                                #1188/#1017 WIP), allocation-bucket/
                                assign-dialog, flex-chart-sandbox,
                                chain-grid (5s timeouts). The diff is
                                additive enum members + leaf modules;
                                none of the failing suites import it.
```

## Verdict

**PASS.** All minors remediated in-pass (typed requests, `defer` wrap,
`reportError` consolidation, narrower cancel reload, 3 new specs +
3 tightened assertions); accepted nits documented. Ready for `/proj qa`.
