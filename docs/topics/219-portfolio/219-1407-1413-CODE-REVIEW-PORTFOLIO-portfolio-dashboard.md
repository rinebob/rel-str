**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1413  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Blueprint:** #1407  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete — 2026-11-07 — PASS (2 rounds, 2 in-gate fixes in round 1)  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# Code Review — #1413: Peak Since Entry derivation + historicals wiring

**Verdict: PASS** — all four acceptance criteria met and spec-pinned;
two real findings found in-gate and fixed with specs before sign-off.

## Scope

Diff under review (this session's #1413 files only — concurrent foreign
work excluded):

- `src/app/features/portfolio-dashboard/utils/position-peak.util.ts` (new)
- `src/app/features/portfolio-dashboard/utils/position-peak.util.spec.ts` (new)
- `src/app/features/portfolio-dashboard/services/position-peak.service.ts` (new)
- `src/app/features/portfolio-dashboard/services/position-peak.service.spec.ts` (new)
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` —
  `getEquityOrdersPage` + `equityOrdersPageSpec` + `equityOrdersArgs`
- `src/app/core/robinhood-mcp/types/robinhood-mcp.types.ts` —
  `EquityOrderQuery`, `EquityOrdersPage`
- `src/app/features/portfolio-dashboard/portfolio-dashboard.store.ts` —
  `positionPeaks` kick in `fetchCore`, `ensurePeaks` registry
- `src/app/features/portfolio-dashboard/portfolio-dashboard.types.ts`,
  `portfolio-dashboard.helpers.ts` (one line),
  `portfolio-dashboard.spec-fixtures.ts`,
  `portfolio-dashboard.store.spec.ts`,
  `portfolio-dashboard.component.spec.ts` (one line)

## Step-0 probe (the #1411 precondition, discharged narrowly)

The task declared `Blocked by: #1411` for one question — does order
history reach far enough to derive entries? A live probe against the
observation API answered it without the full audit:

- `get_equity_orders` paginates ~200 orders/page, newest-first, cursor;
  page 1 ≠ history (margin account: 2+ pages, still paging past
  2025-03).
- Long-held positions (QQQ, margin account) have entries below page 1 —
  page-1-only derivation would silently render `—` for real entries.
- Transferred/DRIP positions (GPRO) have zero fills anywhere — the
  `entryDate: null` → `—` path is a real-world case, not an edge.
- `get_pnl_trade_history` is realizing-trades only — not an entry
  source.

Consequence implemented: per-symbol paginated fills walk, symbol-filtered
server-side, early-exit at the zero-crossing.

## Standards

- `position-peak.util.ts` — pure functions matching the utils/
  convention (`portfolio-pnl.util.ts` shape: exported types + functions,
  header doc, no classes).
- `position-peak.service.ts` — orchestration in a service (not the
  store), mirroring `position-attribution.service` / `allocation-data`
  placement; `MAX_PEAK_PAGE_ROUNDS` + console.warn cap mirrors
  `MAX_OPTION_INSTRUMENT_PAGES` precedent.
- Store `ensurePeaks` mirrors the `requestOrders`/`ordersAgain`
  in-flight-registry + trailing-rerun pattern verbatim; epoch guard
  consistent with `fetchCore`/`ensureCore`.
- Client: `equityOrdersArgs` extraction keeps one arg-builder; page spec
  reuses `extractList`/`extractNested`/`normalizeOrders` — no parsing
  duplication. `getEquityOrders` signature and behavior unchanged.

## Spec

| AC | Met |
|---|---|
| Holding-period detection: single buy, multi-add, partial sell, exit+rebuy | ✅ 4 spec cases + short position + underivable |
| Peak batched ≤10 symbols/call, date-ranged to first entry | ✅ `HISTORICALS_SYMBOL_CHUNK=10`, start = min needed date; 11-position chunk spec |
| Both peaks exposed; missing entry → null, never fabricated | ✅ `lifetime` + `sinceLastFill`; GPRO/exhausted-history specs pin null |

Task-body extras: fetch placement after positions land (fetchCore kick,
never awaited) ✓; fills early-exit at zero-crossing ✓; `—`-for-null
contract carried in `PositionPeak`/`AccountState` docs for #1414.

## Findings — fixed in-gate

1. **`executeBatch` 20-call limit exceeded on accounts with >20
   positions.** `walkFills` sent one spec per unresolved symbol —
   `executeBatch` throws at `BATCH_CALLS_LIMIT`. Fix: rounds chunk
   targets at `FILLS_BATCH_CHUNK=20`; spec: 21 positions → 20+1.
2. **Refresh during an in-flight derive permanently lost peaks.**
   `loadAccounts` bumps `loadEpoch`, dropping the stale derive's patch —
   but post-refresh `ensurePeaks` *joined* the stale in-flight promise,
   so nothing re-derived and `positionPeaks` stayed empty forever. Fix:
   `peaksAgain` trailing-rerun set (ordersAgain parity); spec: refresh
   mid-derive → second `derivePeaks` call, peaks populate.

## Thermo-Nuclear pass

- Shared in-flight promise + trailing rerun — no double-derive, no stale
  join swallowing a rerun.
- Rejected batch slot → symbol underivable only; batch transport failure
  → `errorSection`, section-scoped.
- `peakSince` day-granularity comparison documented (intraday fills
  can't resolve finer at 'day' interval); ties take the earliest bar.
- Nits (noted, not gating): fills re-sort per page is O(fills) —
  trivial at real fill counts; `computeEntryDates` (coarser, page-1
  window only) now overlaps conceptually with `currentHoldingPeriod` —
  a later convergence task could retire it; both peaks emit even when
  equal — consumers compare, as designed.

## Test evidence

- `position-peak.util.spec.ts`: 13 tests
- `position-peak.service.spec.ts`: 8 tests (incl. >20 chunking)
- `robinhood-mcp-client.service.spec.ts`: +2 (page spec)
- `portfolio-dashboard.store.spec.ts`: +4 (kick, failure isolation,
  skip-on-positions-failure, refresh-during-derive rerun)
- Sweep: portfolio-dashboard + robinhood-mcp — **37 suites / 734 tests
  green** (48 in the two directly-touched suites)
- `tsc --noEmit`: clean on all touched files (pre-existing implicit-any
  errors in `portfolio-dashboard.store.spec.ts` predate this work —
  same code in HEAD)
- Live: `/batch` payload confirmed `get_equity_orders` symbol-filtered
  calls + `get_equity_historicals` after positions paint; first paint
  ungated.

## Round 2 — convergence pass

Zero new gating findings. Re-examined:

- **Truncation correctness** — the zero-crossing test at fill *i* depends
  only on fills ≥ *i*; contiguous newest-first pages mean a crossing
  found on partial history is provably a true crossing (deeper pages can
  only supply a missing entry, never fabricate a wrong one).
- **Rerun-loop interleaving** — no `await` between the `peaksAgain`
  check and `finally`, so a flag can't be set-and-cleared unprocessed;
  joiners flag during the derive `await`, caught by the next check.
- **Within-round double-fetch** — targets captured per round; each
  unresolved symbol fetched exactly once per round across the >20 split.
- **"Invalidated on new fills"** — mid-session fills don't re-derive
  until a positions refetch; same staleness class as the position row
  itself (documented nit — a fills walk per orders reconcile would pay a
  batched call for cancels that change nothing).

### Nits (documented)

- Historicals failure isolation is chunk-level (≤10 symbols share a
  call's fate) — inherent to batching.
- `FILLS_BATCH_CHUNK` duplicates the client's private
  `BATCH_CALLS_LIMIT` — comment flags the coupling.
- `computeEntryDates` (page-1 window, earliest-fill semantics) overlaps
  `currentHoldingPeriod` conceptually — future convergence candidate.

**Convergence: no third pass needed** — round 1 produced the two real
findings; round 2 produced only documented nits.

## Verdict

**PASS** — cleared to `/proj qa 219 1413`.
