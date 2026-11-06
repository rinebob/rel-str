**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1405  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Domain:** PORTFOLIO  
**Type:** IMPL (FE)  
**Status:** Approved  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# FE Implementation Plan — Load Architecture & Order Surfacing

## Architecture Decisions (resolved at blueprint grilling)

1. **Phased phases stay** — no merge of portfolio/positions and orders batches; each `/batch` carries ≤20 tool calls but a merged 5-call batch would delay first paint on the positions table.
2. **Waterfall load** — selected account + default tab gates UI → remaining sections of that account → next account → next. Sequential waves, not parallel fan-out: keeps the slow MCP surface un-contended and gives the user a usable page earliest.
3. **Account identity** — `get_accounts` fires at app bootstrap + session-level cache in `RobinhoodMcpClient`. No persistence layer, no invalidation — the call still happens once per session, just never on the dashboard's critical path.
4. **Peak Since Entry** — lifetime peak of the *current holding period*: walk fills backward until cumulative net qty = 0; the first fill after that point opens the current holding period. Adds within a holding period do not reset the peak. Both lifetime peak and peak-since-last-fill are computed (same bars scan) — table shows lifetime, dialog shows both. No derivable entry → `—`, never a wrong number.
5. **Forensics after load** — Phase 2; findings may refine Phase 3/4 tasks before they start (blocking edge, not hard dependency on fixes).

## Phase 1 — Load Architecture (US-1)

**Store reshaping** (`portfolio-dashboard.store.ts`):

- Per-account `loaded`/`loading` flags replace blanket `globalLoading` semantics for section data; `globalLoading` only covers "selected account's visible sections not yet landed."
- `loadAccount(accountIndex, sections)` — the atomic per-account fetch unit; one `/batch` (portfolio + equityPositions + optionPositions) or (equityOrders + optionOrders) per call, same `PromiseSettledResult` per-section error mapping as today.
- `initialLoad()` = accounts (from cache — see T3) → selected account, default-tab sections → `globalLoading` false → kick `prefetchWaterfall()`.
- `prefetchWaterfall()` — serial queue: selected account's remaining sections → account 2 all sections → account 3. Each step is a `loadAccount` call; runs under no global flag. Cancelled/superseded safely by user mutations.
- `selectAccount(i)` — if account's visible sections not loaded and no in-flight `loadAccount` covers them, start it; if in flight, the section indicators already show. Same pattern for non-default tab activation.
- `reconcile(accountIndex, sections)` — generalized from `reconcileOrders`: silent, no loading flags beyond the section-level, dedupe = in-flight + one trailing run per account (existing pattern). Stop dialogs → `orders` (and `equityPositions` only if the mutation affects it); full `refresh()` survives for close-position/bulk-cancel.

**Client** (`robinhood-mcp-client.service.ts`):

- `getAccounts()` gains a session cache (`accountsCache: Promise<AccountInfo[]> | null`) — first call wins, concurrent callers share the promise, no expiry within session.
- Bootstrap warm: app-level initializer or the shell's existing RH-client warmup calls `getAccounts()` so it's resolved before dashboard mount. (Verify where RH client initializes at implement — if bootstrap timing is unclear, a plain session cache still removes every repeat call.)

**Component** (`portfolio-dashboard.component.ts`):

- `ngOnInit` → `store.initialLoad()` (replaces `refresh()`).
- Account tab select → `store.selectAccount(i)` (store decides fetch vs join vs no-op).
- `openThenRefresh` scope param already exists (#1397) → migrate callers to `store.reconcile(accountIndex, sections)`; keep `'all'` → `refresh()` for close-position.

## Phase 2 — Order-Data Forensics (US-4, US-5)

Investigation tasks, docs-first; fixes spawned as follow-on tasks when the root cause is code.

- **Orders completeness audit:** trace `get_equity_orders`/`get_option_orders` response → `BrokerOrder` mapping → `LIVE_ORDER_STATES`/`TERMINAL_ORDER_STATES` filters → table. Specifics: does the tool return a bounded window or paginate? Which broker state strings exist vs. which we map (a state in neither set is invisible in both Open Orders AND Order History)? Reproduce the NVDA case against the live account if possible.
- **Stop-cancel forensics:** correlate the 2–3 days of cancel notifications vs. `updateEquityStopOrder` invocations (cancel leg always notifies — the question is whether a place-phase failure or abandoned operation left the cancel un-replaced). Verify actual GTC/TIF broker semantics + order ages from order history rather than assuming.

## Phase 3 — Position Stop Surfacing (US-2)

**Peak derivation** (new util, e.g. `utils/position-peak.util.ts`):

- `currentHoldingPeriod(fills: BrokerOrderExecution[]): { entryDate: ISO | null }` — walk fills newest→oldest accumulating signed qty; the window opens where the cumulative crosses zero.
- `peakSince(bars: OhlcBar[], since: ISO): { price, date }` — `max(high)` over `get_equity_historicals` 'day' bars from entry→now. `getEquityHistoricals` accepts ≤10 symbols + RFC3339 startTime/endTime — one batched call per ~10 positions.
- Fetch placement: in the prefetch waterfall after the selected account's positions land (peaks are surfacing data, not gating data); cached per symbol+holdingPeriod in the store, invalidated on new fills.

**Table** (`equity-positions-table`):

- Columns: Stop (price), Dist (%/$ to current), Peak Since Entry, Retraced %; TIF/qty/age on hover tooltip.
- UNPROTECTED marker in the Stop column when no live protective stop — driven by existing `stopLossProtectedSymbols`/`updatableStops` derivations; Add Stop action present.
- Stop-limit orders display but stay ineligible for Update Stop (existing rule).

## Phase 4 — Dialog Context (US-3)

- Story chain row: entry → peak (date) → current → current stop → proposed (live as user types).
- Metrics: % retraced from peak; proposed stop distance %/$ from price and from peak; locked-in gain/loss if proposed fills vs. cost basis.
- Position context: qty, basis, value, unrealized PnL. Order context: live order qty, TIF, age.
- Both peaks shown when they differ (lifetime vs. since-last-fill) — the add-on-ratchet case.
- Workflow unchanged: submit → submitting → success → Done; close → silent reconcile only.

## Risks

- **Historicals cost:** +1 batched call per ~10 positions per account — placed after first paint, cached; still adds tail latency to the prefetch wave.
- **Orders windowing:** if `get_equity_orders` truncates, both entry derivation and US-4's missing-order case share a root — Phase 2 may hand Phase 3 a data-source decision.
- **Prefetch × mutation interleaving:** a reconcile during a prefetch wave must not double-fetch the same sections — the in-flight registry keys by (account, section).

## Files

- `portfolio-dashboard.store.ts` / `.spec.ts` — load architecture, prefetch, reconcile, peak signals
- `robinhood-mcp-client.service.ts` — accounts session cache
- `portfolio-dashboard.component.ts` — init/select wiring
- `equity-positions-table.*` — columns, tooltip, UNPROTECTED
- `stop-loss-dialog.*` — story chain + context
- `utils/position-peak.util.ts` (new) — holding-period + peak derivation
