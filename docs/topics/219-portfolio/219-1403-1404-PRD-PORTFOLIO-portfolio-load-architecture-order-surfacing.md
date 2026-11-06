**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1404  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# PRD — Load Architecture & Order Surfacing

## Problem

The Portfolio Dashboard can't be trusted at the two moments it matters most: when it loads, and when a trader needs to decide whether a protective stop is still right.

**Load:** `refresh()` eagerly fans out per account in two serial phases — 3 accounts × (portfolio+positions batch + orders batch) plus quotes ≈ 7+ sequential Robinhood round-trips under `globalLoading`, ~10-15s observed. The trader waits on data for accounts and tabs they cannot see. The same all-accounts reload fires after every mutation reconciliation, so the cost is paid repeatedly during a working session.

**Surfacing:** the equity row shows that a stock moved, but nothing about the protective stop covering it or the run it should have captured. The trader's actual decision — "has this stock peaked and retraced enough that my stale stop is giving back gains?" — is unanswerable from the screen. Update Stop is always available but always blind. Positions that lost their stop entirely (cancelled without replacement) are invisible too — the trader finds out from a phone notification, if at all.

**Trust:** a limit buy placed weeks ago (NVDA, filled 2026-11-05) never appeared in Open Orders, and several stop cancellations arrived as notifications the trader didn't initiate. Open Orders may be silently incomplete; stop cancels may be self-inflicted by the app's own update flow. Until these are explained, every order-surfacing feature inherits the doubt.

## Goals

- Page-load wait is bounded by the selected account's visible sections only — never by sibling accounts or hidden tabs; the rest prefetches silently behind it so later navigation is instant.
- Post-mutation reconciliation is silent, account-scoped, and deduplicated so rapid successive updates don't stack round-trips.
- The equity positions row answers "is my stop stale?" at a glance — live stop price, distance, Peak Since Entry, Retracement — and flags Unprotected positions explicitly.
- The Update Stop dialog presents the full decision context before the trader commits: the entry→peak→current→stop→proposed chain plus position and live-order details.
- Open Orders is complete and explainable — every resting order appears, and the NVDA gap is root-caused.
- Unexplained stop cancellations are root-caused; if a position can silently become Unprotected, the UI surfaces it.

## Non-Goals

- Trailing Stop automation (#830) and Update All Stops batch ratchet (#890) — this thread surfaces the data those features will consume; it does not automate the ratchet.
- Open Orders inline Update action (#889) — same surface, separate task.
- Option positions — surfacing work is equities only this thread (lazy loading covers all account tabs regardless).

## User Stories & Acceptance Criteria

### US-1 — Fast, account-scoped load

> As a trader opening the dashboard, I wait only for the account and tab I'm looking at.

- AC1.1: Initial page load issues data requests for the selected account's visible sections first; those requests complete before any background prefetch begins.
- AC1.2: `globalLoading` clears when the selected account's visible sections land; nothing else blocks the UI.
- AC1.3: Once the visible data lands, remaining accounts and sections prefetch silently in the background (no `globalLoading`, no visible indicators beyond existing section-level state) so a later tab select finds data already present or in flight — the RH surface is too slow for pure load-on-click.
- AC1.4: Selecting an account tab whose prefetch is still in flight shows the existing per-section loading indicators — no new skeleton UI, page chrome stays interactive. A tab whose fetch hasn't started still loads on demand.
- AC1.5: `get_accounts` never sits on the dashboard's critical path — account identity is resolved before or beside page load (bootstrap warm-up, session cache, or persisted identity with background validation; mechanism chosen at blueprint). `AccountInfo` is stable identity data (number/name/type/agenticAllowed — no financials), so caching it is safe; accounts change only on open/close.
- AC1.6: Post-mutation reconciliation (stop add/update, order cancel) refetches only the affected account's affected sections, sets no `globalLoading`, and shows no page-level indicators.
- AC1.7: Overlapping reconciles for the same account collapse to the in-flight request plus at most one trailing rerun — ten rapid stop updates cannot queue ten round-trips.
- AC1.8: Full `refresh()` remains available for mutations that genuinely cross sections (close position, bulk cancel) but is never triggered by a stop-dialog dismissal.

### US-2 — Stop state visible in the positions table

> As a trader scanning positions, I can see each position's live stop and whether it still reflects the run.

- AC2.1: Each equity row shows the live protective stop's price and its distance-to-stop (% and $) from current price, as inline columns — visible without clicks or hovers.
- AC2.2: Each row shows Peak Since Entry and Retracement (%) — the basis for judging staleness.
- AC2.3: Stop order details beyond the columns (qty, TIF, age) are available on hover.
- AC2.4: A position with no live protective stop renders an explicit UNPROTECTED marker in the stop column (styled, never blank) with the Add Stop action.
- AC2.5: Stop details reconcile with Open Orders — the row's stop is the same live order the orders table shows.
- AC2.6: Stop-limit orders remain excluded from Update Stop eligibility; their presence in the row is displayed but the update affordance matches existing eligibility rules.

### US-3 — Decision-complete Update Stop dialog

> As a trader updating a stop, I see the full picture before I commit.

- AC3.1: The dialog presents the story chain: entry price → Peak Since Entry (with date) → current price → current stop → proposed stop.
- AC3.2: The dialog shows % Retracement from peak and the proposed stop's distance (% and $) from both current price and peak.
- AC3.3: The dialog shows locked-in outcome: gain/loss if the proposed stop fills, relative to cost basis.
- AC3.4: The dialog shows position context: qty, cost basis, market value, unrealized PnL.
- AC3.5: The dialog shows the live order's details: qty, TIF, age — so a stop sized for a stale position quantity is visible.
- AC3.6: The existing submit → submitting → success → Done workflow is preserved exactly; the dialog still awaits broker confirmation before success.
- AC3.7: Dismissing after success triggers only the silent account-scoped orders reconcile (AC1.5) — no full reload.

### US-4 — Open Orders completeness investigation

> As a trader, every order resting at the broker appears in Open Orders — or I know exactly why it doesn't.

- AC4.1: Reproduce or rule out the NVDA case: a limit buy placed weeks earlier that filled 2026-11-05 without ever appearing in Open Orders. Determine whether the gap was fetch-window/pagination, client-side filtering, state mapping, or staleness.
- AC4.2: Root cause documented; if the cause is a code defect, fixed and tested; if it's broker behavior (e.g., API window), the PRD/CONTEXT records the semantics and the UI makes the limit visible rather than silently dropping.
- AC4.3: Audit the full path broker response → store → table for filters or mappings that can hide a resting order; each potential hiding spot is either proven safe or fixed. Known suspects: (a) whether `get_equity_orders` returns a bounded window/page that drops old resting orders; (b) `LIVE_ORDER_STATES` membership — Open Orders and Order History are both computed filters over the same response (`LIVE` vs `TERMINAL` sets), so a state string in neither set is silently invisible in both.
- AC4.4: Distinguish and handle "not open at fetch time" from "was open but never shown" — the latter is a data-fidelity defect, not a UX gap.

### US-5 — Unexplained cancellation investigation

> As a trader, a cancelled stop is never a mystery — and a position that lost its stop is never invisible.

- AC5.1: Correlate the notification timestamps (last 2–3 days) against app actions: Update Stop attempts, placement failures, app focus loss. Hypothesis under test: the cancel leg of `updateEquityStopOrder` generates the notification; a failed/orphaned place-phase leaves a real broker cancel with no replacement.
- AC5.2: Rule in or out GTC window expiry — verify actual broker TIF semantics and order ages rather than assuming.
- AC5.3: Root cause documented with order IDs and timestamps.
- AC5.4: If any app path can leave a position Unprotected without a visible signal, the fix lands (at minimum, AC2.4's marker makes the state self-evident on next load).
- AC5.5: Findings feed the design tasks — if the update flow itself produces unexplained cancels, its failure visibility is part of the fix, not just the explanation.

## Technical Context

- **RH latency is architectural.** Requests are per-account and slow; the cost multiplier is serial round-trips, not individual call time. Design assumption: every fetch strategy must minimize serialized RH calls, not just "be async."
- **Peak Since Entry requires historicals.** `get_equity_historicals` is already wired (`rh-chart.service.ts`, `RobinhoodMcpClient.getEquityHistoricals`) and takes an explicit RFC3339 `startTime`/`endTime` range with **up to 10 symbols per call** — so peaks need only bars since first entry, and one account's positions batch into one or two calls, not one-per-position. Where/when that fetch runs (prefetch wave vs. on tab activation, and caching) is a blueprint decision against the latency budget.

### Full-load request inventory (current, 3 accounts)

| # | Wire call | Tool(s) in payload | Phase | Scope |
|---|---|---|---|---|
| 1 | `executeTool` | `get_accounts` | 0 — blocks everything | once |
| 2–4 | `POST /batch` ×3 | `get_portfolio` + `get_equity_positions` + `get_option_positions` | 1 | per account |
| 5 | `executeTool` | `get_equity_quotes` (all symbols across accounts; chunked >20/call) | 2 | once |
| 6 | `executeTool` | `get_option_quotes` (instrument IDs across accounts) | 2 | once |
| 7–9 | `POST /batch` ×3 | `get_equity_orders` + `get_option_orders` | 2 | per account |

≈ **9 wire calls minimum** (more if equity symbols exceed the 20/call quote chunk), all serialized behind `globalLoading` — phases run sequentially, only same-phase per-account batches parallelize. Open Orders and Order History add zero calls: both are computed filters (`LIVE_ORDER_STATES` / `TERMINAL_ORDER_STATES`) over the same orders response — which is also why a state mapping gap would hide an order from both views at once.
- **Silent reconcile pattern exists.** `reconcileOrders(accountIndex)` (from #1397, in worktree) is the seed: orders-only refetch, zero loading flags, in-flight + trailing dedupe. This thread generalizes it.
- **`executeBatch` wire shape:** one `POST /batch` per call, tool names in the payload — per-account fan-out means N batch requests, which is what the network tab showed.
- **Equities only** for surfacing; lazy loading is account/tab-agnostic.

## System Context

```mermaid
flowchart LR
    Trader --> Dashboard
    Dashboard --> Store[PortfolioDashboardStore]
    Store -->|visible data first, then silent<br/>prefetch of remaining accounts| MCP[RobinhoodMcpClient]
    MCP -->|POST /batch per call| RH[(Robinhood)]
    Store -->|get_equity_historicals<br/>(since first entry, ≤10 symbols/call)| MCP
    Store --> EquityTable[Equity Positions Table<br/>stop price · distance · peak · retracement · UNPROTECTED]
    Store --> OrdersTable[Open Orders]
    EquityTable --> StopDialog[Update Stop Dialog<br/>entry→peak→current→stop→proposed]
    StopDialog -->|cancel→confirm→place| OrderExec[OrderExecutionService]
    OrderExec --> RH
    StopDialog -.->|close: silent reconcile,<br/>affected account only| Store
```

## Open Questions (for blueprint)

1. **Entry definition for multi-fill positions** — first fill vs. most recent fill as the peak basis (deferred from grilling).
2. **Where Peak Since Entry is computed and cached** — per-position historicals call cost vs. the latency budget; candidates: lazy per visible account, cached in store, or derived server-side later.
3. **Batch consolidation** — whether the two per-account phases collapse into fewer `/batch` calls for the selected account.
4. **Default tab** — which tab gates initial load if the user has no explicit selection (likely Positions; confirm at blueprint).
5. **Account identity mechanism** — bootstrap warm-up + session cache (recommended: no invalidation, works across refreshes) vs. persisted identity (localStorage/Firestore + background validation) vs. status quo. `AccountInfo` carries no financials, so staleness risk is low regardless.

## Related Issues

- #1400 — lazy per-account loading: **absorbed** by US-1.
- #1397 — silent reconcile on dialog close: shipped pattern US-1/US-3 generalize.
- #889 — Open Orders Update action: same surface, future.
- #890 — Update All Stops ratchet: consumes the peak/retracement surfacing.
- #830 — Trailing Stops thread: Peak Since Entry is its foundational datum.
