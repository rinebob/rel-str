**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1407  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1411  
**Domain:** PORTFOLIO  
**Type:** AUDIT  
**Status:** Complete  
**Created:** 2026-11-10  
**Last Updated:** 2026-11-10  

# Audit — Open Orders completeness / order-data forensics (#1411)

## Verdict

**Three silent-drop defect classes found and fixed; one
intended-but-undocumented exclusion made visible; the NVDA row itself is on
the wire today.** Review caught two that the first implementation pass
missed: the dashboard's actual fetch path ran single-page batch specs (the
walking client methods were never invoked), and — worse — `normalizeOrder`
required a top-level `side` that **no wire option order carries**, silently
emptying the entire option-orders feed. Every mechanism in the
fetch→table path that could produce "an order never appeared" is now
either eliminated, logged, or declared in the UI.

## Wire contract — verified live 2026-11-10

Fresh captures (`ro-eq-orders-01`, `ro-opt-orders-01`, re-probed this date):

| Fact | Evidence |
|---|---|
| `get_equity_orders` is page-bounded, newest-first | `cursor` param + `data.next` documented; pass `next` back verbatim |
| `data.next` is **absent** (not null) when the list is complete | `ro-eq-orders-01`: 148 orders, no `next` key |
| `get_option_orders` paginates identically | `cursor` param documented; `ro-opt-orders-01`: 9 orders, no `next` |
| Resting equity orders report state `confirmed` | capture note + live data: 3 `confirmed` rows |
| Resting option orders report `unconfirmed` (not `confirmed`) | `opt-orders-final` capture note — a `confirmed`-only filter would be blind |
| Documented equity states (10) | `new queued confirmed unconfirmed partially_filled filled cancelled rejected failed voided` |
| Documented option states (9) | `queued confirmed partially_filled filled rejected cancelled failed voided pending_cancelled` |
| States observed on this account today | equity: `filled 88, cancelled 56, confirmed 3, rejected 1`; options: `cancelled 7, filled 2` |

All documented + observed states are in `VALID_STATES` (12 — the extra
`partially_filled_rest_cancelled` was observed on the wire previously).

## Hiding-spot audit (AC4.3)

| # | Point | Verdict |
|---|---|---|
| 1 | **Dashboard orders path fetched page 1 only** — `initialLoad`/`refresh`/`reconcileOrders` all funnel through `fetchOrders` → `runOrdersBatch` → `executeBatch` over single-page specs. (First pass fixed only `getEquityOrders`/`getOptionOrders`; review caught that the dashboard never calls them.) | **DEFECT — fixed.** `runOrdersBatch` now round-batches the page walk: each `executeBatch` round carries the page specs for whichever tool still holds a `next` cursor, until both exhaust or `MAX_ORDERS_PAGE_ROUNDS` (25) trips — a deep history costs one `/batch` per depth, not a serial crawl. A mid-walk slot failure rejects only that section; a transport failure rejects pending slots; a capped walk keeps accumulated pages + warns. Store spec proves page-2 orders land in the sections |
| 2 | **`isOpeningOrder` table filter** — sell-side orders classified "closing" and dropped from Open Orders | **INTENDED SCOPE — was undocumented, now visible.** Product intent (confirmed 2026-11-10): Orders tab = position-opening orders only; stops/closing orders are managed on the Equities / Options positions tabs. The *unannounced* exclusion is what read as a bug during #1414 QA — a `.pd-scope-note` caption ("Opening orders only — …") now makes the boundary explicit in the UI, satisfying AC4.2's "make the limit visible rather than silently dropping." Today's 3 resting stops (SCHB $27.66, RS $412.22, MSFT $514.42) correctly live in the Equities tab's stop columns |
| 3 | **`normalizeOrder` required top-level `side`** — option orders carry `direction` + `legs[].side` instead: **all 9 wire orders lack `side`, so every option order threw and was skipped** — `optionOrders.data` permanently `[]`, Order History empty of options, option stop-protection blind | **DEFECT — fixed (found on re-review; the audit itself missed it).** Side now derived: `side` → `direction` (`debit`→buy, `credit`→sell — correlated 1:1 with leg sides in the capture) → `legs[0].side` fallback; leg-level `executions` also flattened into the order (top-level `executions` doesn't exist for options). Client specs now mock the real wire shape (`data.orders`, `direction`, `ratio_quantity`), not the fictitious top-level-`side` shape that hid this |
| 4 | **`normalizeOrders` silent skip** — a malformed record was dropped with no trace | **FIXED.** Skip now `console.warn`s with order id + reason |
| 5 | **`parseOrderState` silent `unknown`** — an unrecognized broker state normalized to terminal invisibly | **FIXED.** Warns with the raw state string; `unknown` → TERMINAL → still renders in Order History. `parseOrderType` gained the same warn — an unrecognized type string no longer flips to `unknown` silently |
| 6 | **LIVE/TERMINAL coverage** — a state in neither set hides in both tabs | **SAFE.** LIVE (6) ∪ TERMINAL (7) = the full `OrderState` union (13). No value can fall between; `unknown` lands in TERMINAL so it is at least visible in History + logged |
| 7 | **Fetch-time state filter** — could a `state` param exclude resting orders? | **SAFE.** Store calls both tools unfiltered; resting states (`confirmed`/`unconfirmed`) are in LIVE anyway |
| 8 | **Account scoping** — order in account B while viewing account A | **SAFE by construction.** Fetches are per-account (`account_number` required); each account tab fetches its own orders |
| 9 | **Stale cache** | **SAFE.** Orders re-fetch on load/reconcile; only `get_accounts` is session-cached (#1409) |

## NVDA root cause (AC4.1, AC4.4)

**The order:** `buy/limit` NVDA, created 2026-10-27, `filled`
**2026-11-04T20:55:36Z** — present in today's `ro-eq-orders-01` response.
(The PRD said 11-05; the wire execution timestamp is 11-04 ~3:55pm ET. The
off-by-a-day is noted here, not corrected upstream.)

**Was it "open but never shown" or "not open at fetch time"?** While resting
(10-27 → 11-04) it would have reported `confirmed` → LIVE → and being a
buy, the old `isOpeningOrder` filter passed it too. **No code path in the
pipeline demonstrably hides that row** — except page-1 truncation, which is
the one mechanism that fit the window: a buy resting ~8 days while newer
activity pushed it past the page bound would vanish from every tab. Whether
the account ever crossed the bound during the resting window is unknowable
(today's full 148-order history fits one page); a viewed-account mismatch
or a fetch that only ran post-fill are equally possible.

**What is settled:** both page-1 truncation call sites now walk to
completion, and unmapped/malformed drops are logged. Closing orders remain
intentionally absent from the Orders tab, but they surface on the positions
tabs (stop columns, `UNPROTECTED` marker) and the scope note declares the
boundary. If a resting order now fails to appear anywhere it belongs, the
remaining explanations are broker-side (not returned at all) or fetch error
(visible error state, not silent).

## Entry-history coverage flag (AC's Peak-derivation clause)

`computeEntryDates` (`portfolio-pnl.util.ts`) consumes
`acct.equityOrders.data` — it inherited the same page-1 truncation, so
entry dates for positions whose fills sat past the bound were silently
wrong/absent. The batch-path fix heals it; no separate change needed.
`position-peak.service.ts` was never affected — it runs its own
symbol-scoped batched cursor walk (`equityOrdersPageSpec`, stops at
entryDate or `next` exhaustion, warns on cap).

## Changes shipped

- `RobinhoodMcpClient.orderSide` — option orders have no top-level `side`
  on the wire; `side` derived from `direction` (`debit`→buy, `credit`→sell)
  with `legs[0].side` fallback (the fix for hiding spot #3 — previously
  every option order threw and was skipped)
- `orderExecutions` — option fills live under `legs[].executions`, not
  top-level `executions`; now flattened into the order
- `RobinhoodMcpClient.walkPages<T>(spec, maxPages, context)` — shared
  page-walk (execute → success-guard → parse → read `data.next` → splice
  `cursor` → repeat; bound + warn). Now the single owner of the loop
  previously copied three times; `getOptionInstruments`, `getEquityOrders`,
  `getOptionOrders` all delegate to it
- `optionOrdersPageSpec` + `OptionOrderQuery` — the option twin of
  `equityOrdersPageSpec` ({orders, next} envelope, `cursor` arg), so the
  batch path can walk both tools; `equityOrdersSpec`/`optionOrdersSpec`
  now delegate their parse to the page specs
- `PortfolioDashboardStore.runOrdersBatch` — round-batched page walk over
  both page specs (the fix for hiding spot #1)
- `normalizeOrders` — warn on skipped malformed order (id + reason)
- `parseOrderState` / `parseOrderType` — warn on unrecognized raw strings
- `getEquityOrdersPage` (async wrapper) — removed; no production callers
  (peaks + the store consume `equityOrdersPageSpec` via `executeBatch`)
- `OpenOrdersTableComponent` — `isOpeningOrder` filter **kept**
  (opening-only is the product intent); `.pd-scope-note` declares the scope
- Specs: client (+6: equity/option walk, cap-warn, mid-walk reject,
  malformed-log, state-log; option fixtures rebuilt to the real wire
  shape — `direction`, no top-level `side`, leg executions, `results`→
  `data.orders`) · store (+2: batched multi-page walk with verbatim cursor
  pass-back, mid-walk slot rejection) · component (+1 scope-note);
  `batchAnswers` wraps legacy array answers into page envelopes so the
  fixture seam is unchanged
- Captures `ro-eq-orders-01` / `ro-opt-orders-01` refreshed live 2026-11-10

## Residuals

- **Page cap is undocumented** — bounded walks (25 rounds) + warn make the
  limit loud instead of silent. If the cap-warn ever fires in practice,
  switch to `created_at_gte` windowing.
- **`retrySection('equityOrders'|'optionOrders')`** still routes through
  the async walking methods — currently unemitted by the template (the
  combined `'orders'` retry covers it), kept for switch exhaustiveness.
- **Order History completeness** — benefits automatically; it filters
  TERMINAL over the same now-complete list — and with the option-side fix
  it shows option orders for the first time.
- **Option orders render with no Mark/Dist** — `collectOptionInstrumentIds`
  only pulls instrument IDs from option *positions*, so `orderMark` can't
  resolve a quote for an option order's leg instrument. Mark/Dist columns
  show '—' for every option row until option-order legs feed the quote
  fetch. Follow-up candidate.
- **Option closing orders have no list surface** — the scope note is
  accurate for equities (stops on the Equities tab) but a resting option
  sell-to-close is visible only in Order History while open, and in no
  positions tab. A "closing orders" surface (or an Options-tab orders
  section) is a follow-up, not part of this audit's fix scope.
- **Filled market option orders are skipped in allocation fills** —
  `toFillInputs` requires `price`; market fills carry `price:""` +
  `processed_premium` — deriveable but currently skipped silently. Newly
  reachable now that option orders normalize at all.
- **Signal-order workspace has the same page-1 truncation class** —
  `order.component.ts` `refreshRhOrders` fires a raw single-page
  `get_equity_orders` (no cursor walk) feeding `rhStopRows`,
  `restingLimitBuyNotional`, `reconcileTerminalStatuses`, and
  `findActiveStopLoss` (a stop pushed past page 1 could allow a duplicate
  stop). Out of this task's dashboard scope — file as a follow-up task.
- **Crypto + advanced (OCO) orders are never fetched** — the wire doc
  instructs calling all four order tools in parallel "so OCO groups are
  not omitted." The dashboard is scoped to equity+option today; if the
  account ever holds crypto or OCO resting orders they are invisible by
  scope, not by defect. Surface as a new task if those classes come into
  use.
