**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Load Architecture & Order Surfacing  
**Thread Slug:** load-architecture-order-surfacing  
**Issue:** #1567  
**Thread Parent:** #1403  
**Topic Parent:** #219  
**Task:** #1481  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — Option positions render from data.positions with joined contract data (#1481)

## Scope

Bug: `get_option_positions` extraction hunted a container that does not
exist on the wire (`results`/`option_positions`) and mapped field names
the API never sends — **every option position landed as `[]`** and the
dashboard Options table could never render a row.

Fix: parse `data.positions` + the real field names; wire `type`
(`long`/`short`) is position side and feeds signed quantity + PnL;
call/put + strike join through `get_option_instruments({ids})`; wire
`average_price` is contract dollars and normalizes to per-share premium
before every dollar computation multiplies by `trade_value_multiplier`.

**Acceptance criteria (issue body):**

1. Extract `data.positions` — option positions actually render.
2. Field map: `option_id`→`instrumentId`, `chain_symbol`→`chainSymbol`,
   `average_price`→`averageCost`, `quantity`, `expiration_date`,
   `type`→`side` (never into `optionType`).
3. `optionType`/`strikePrice` populate via an instrument lookup — Type
   column shows `call`/`put`, Strike shows a number.
4. Specs replay the captured wire contract.

**Additional shipped behavior (review remediation):**

5. Money math is per-share-premium × 100-multiplier dollars — Avg Cost,
   Cost Basis, Current, Value, PnL, and the totals footer all agree with
   Robinhood's own figures (the review found the code would otherwise
   render ~100× wrong values).
6. A position whose instrument lookup misses/fails still renders with
   `—` for Type/Strike — never silently dropped.
7. Retrying the Option Positions section re-fetches quotes + the
   instrument join (stale metadata can't strand).

## Prerequisites

- Dev server already running: `http://localhost:4210` (the `Local:` line
  in the `npm start` terminal — the script picks a free port).
- The connected Robinhood account must hold **at least one open option
  position** — this UAT validates rendering, so zero positions only
  exercises the empty state.
  - If the account holds none: in the Robinhood app/web, **buy to open
    1 contract** of the cheapest contract on a liquid chain —
    e.g., SPY or QQQ, nearest Friday expiry, farthest OTM **put**
    (typically trades at $0.01–$0.10, i.e., $1–$10 of cost). Wait for
    the fill, then refresh the dashboard.
- The tester should also have the Robinhood app/web open on the same
  account — every numeric scenario cross-checks the UI against
  Robinhood's own figures.

## Getting to the feature

- **Route:** `/portfolio` — the Portfolio Dashboard.
- **Entry point:** Sidenav → **Portfolio Dashboard** nav item.
- **Surface:** the per-account sections; the feature under test is the
  **Option Positions** card (columns: Underlying, Type, Strike,
  Expiration, Qty, Avg Cost, Cost Basis, Current, Value, PnL, PnL%) —
  all columns sortable by clicking the header.
- **Second surface:** `/portfolio/allocation` — Sidenav → **Portfolio
  Allocation** — option rows appear in the positions list there with
  market-value exposure.
- **Third surface:** `/trading/live` — Sidenav → **Trading** →
  **Live** — the account snapshot (fed by
  `PortfolioService.getSnapshot`) also lists option positions.

## Automated acceptance (re-run for this gate)

| Check | Command | Result |
|---|---|---|
| Store: parse→wave→join→cascade + selectors (51+20 specs) | `npx jest src/app/features/portfolio-dashboard/portfolio-dashboard.store.spec.ts src/app/features/portfolio-dashboard/portfolio-dashboard.store.selectors.spec.ts --coverage=false` | **PASS** — 71/71 (2026-11-15) |
| Client: wire-shape + ids-arg + filter-skip + capture replay (123 specs) | `npx jest src/app/core/robinhood-mcp/robinhood-mcp-client.service.spec.ts --coverage=false` | **PASS** — 123/123 (2026-11-15) |
| All touched suites | `npx jest src/app/features/portfolio-dashboard src/app/core/robinhood-mcp --coverage=false` | **PASS** — 38/38 suites, 816 specs (2026-11-15) |
| Full suite (review gate) | `npx jest --coverage=false` | **PASS** — 313/313 suites, 5,676 specs (2026-11-15) |
| Typecheck | `npx tsc -p tsconfig.app.json` | **PASS** — clean (2026-11-15) |

## Reference row — capture-verified wire → render mapping

From `docs/topics/657-rh-mcp/captures/` — a real NFLX position captured
2026-10-08 (since closed; use it to verify the *mapping*, not today's
values):

| Wire field (get_option_positions) | Value | UI column | Expected render |
|---|---|---|---|
| `option_id` `14a8e49b-0f10-4d64-9cf9-bd1a68e9da44` | — | (join key) | joins to `strike_price 70.0000`, `type call` |
| `chain_symbol` | `NFLX` | Underlying | `NFLX` |
| `type` | `long` | Qty | `1` (positive — short positions render **negative**) |
| `quantity` | `1.0000` | Qty | `1` |
| `average_price` | `190.0000` (contract $) | Avg Cost | **`$1.90`** (per-share = 190 ÷ 100) |
| `expiration_date` | `2026-10-16` | Expiration | `2026-10-16` |
| `trade_value_multiplier` | `100.0000` | — | Cost Basis `$190.00`, Value = qty×100×mark |
| instrument `type` | `call` | Type | `call` — **never `long`/`short`** |
| quote `mark_price` | `1.910000` | Current | `$1.91` → Value `$191.00`, PnL `+$1.00`, PnL% `+0.53%` |

**The units invariant (this task's critical):** Avg Cost/Current are
**per-share premium**; Cost Basis/Value/PnL are **dollars
(qty × 100 × per-share)**. If Avg Cost shows `$190.00` instead of
`$1.90`-scale, or PnL shows `−$188.10` on a flat position, the fix has
regressed — **FAIL** and report.

## Test scenarios

### S1 — Option positions render at all (the defect)

1. Load `http://localhost:4210/portfolio`.
2. Scroll to the account's **Option Positions** card.
3. **Expect:** a data row per open option position in the connected
   account — count the open option positions in the Robinhood app/web
   (Options section of the account) and compare. Before this fix the
   card always showed **"No option positions"** regardless of holdings.
4. **Result:**

### S2 — Field mapping + instrument join

1. In the Option Positions table, read any row.
2. **Expect:** Underlying = the symbol (e.g., `NFLX`, `QQQ`);
   **Type = `call` or `put`** — never `long`, `short`, or `—` when the
   join resolves; Strike = a dollar figure (e.g., `$70.00`); Expiration
   = an ISO date. Qty = position size.
3. Cross-check one row against the same position in Robinhood: symbol,
   strike, call/put, and expiry must all agree.
4. **Result:**

### S3 — Units: per-share premium, dollar PnL (review critical)

1. Pick the first row in the table. In the Robinhood app open the same
   position — Robinhood displays average cost **per share**
   (e.g., `$1.90`-scale for a 1-lot priced near $190/contract).
2. **Expect:** UI Avg Cost equals Robinhood's per-share average cost
   within a cent. A figure ~100× larger (e.g., `$190.00`) is the
   FAIL signature.
3. Verify the row's arithmetic: `Cost Basis ≈ |Qty| × 100 × Avg Cost`,
   `Value ≈ |Qty| × 100 × Current`. For the captured NFLX row the math
   was `1 × 100 × $1.90 = $190.00` and `1 × 100 × $1.91 = $191.00`.
4. Verify PnL is small-dollar: `(Current − Avg Cost) × 100 × Qty` —
   the captured row rendered `+$1.00`, **not** `−$188.10`.
5. **Result:**

### S4 — Short positions (if held)

1. If the account holds a short option (any sold/negative position —
   check Robinhood for positions with negative contract count or a
   "short" label), find its row.
2. **Expect:** Qty renders **negative** (e.g., `−1`); PnL sign is
   inverse of a long at the same marks — a short that fell in price
   shows positive PnL.
3. **Result:** (or "no shorts held — spec-covered")

### S5 — Totals footer + scoreboard

1. At the bottom of the Option Positions table, read the **Totals**
   row: Cost Basis, Value, PnL, PnL%.
2. **Expect:** footer Cost Basis ≈ the sum of the Cost Basis column;
   Value ≈ the sum of Value; PnL = Value − Cost Basis. Numbers stay in
   the hundreds-to-thousands range typical of option dollar exposure —
   never tens of thousands of phantom dollars per contract.
3. Scroll to the account scoreboard — the total PnL figure stays sane
   (it sums the same per-share×multiplier math).
4. **Result:**

### S6 — Full list at scale (pagination)

1. If the account holds more than one page of option positions (the
   wire pages the endpoint; accounts holding dozens-to-hundreds of
   small positions exercise this), scroll the full table.
2. **Expect:** every position the Robinhood app lists is present — spot
   check the last few rows (highest/lowest strikes, latest expiry)
   against the app.
3. **Result:** (or "below one page — single-page walk")

### S7 — Sort interaction

1. Click the **PnL** column header → rows reorder worst→best (or
   vice-versa); click again → order inverts.
2. Click the **Type** header → `call` rows group away from `put` rows.
3. Click **Strike** → numeric order (not string order: `$100.00` sorts
   after `$70.00`, not before).
4. **Result:**

### S8 — Degraded join (`—` fallback)

1. Under a healthy instrument lookup, **no row** shows `—` in Type or
   Strike — every held contract should resolve. If any row shows `—`,
   the join missed a contract: the row must still render (not be
   dropped) — record it and flag FAIL on the join, PASS on
   degradation.
2. If all rows resolve, the `—` path is spec-covered
   (`option-positions-table` spec + join-miss selector spec).
3. **Result:**

### S9 — Section retry cascades the dependent wave (conditional)

1. This only exercises when the Option Positions section errors (e.g.,
   MCP session hiccup — the card shows an error line + **Retry**
   button). If that state occurs: click **Retry**.
2. **Expect:** the section reloads; Type/Strike repopulate (the retry
   re-fetches quotes AND the instrument join — the review found the
   pre-cascade retry would leave metadata permanently stale).
3. If no error occurs during the session, mark **spec-covered**
   (store spec asserts `getOptionInstruments` re-called with the new
   ids on `retrySection('optionPositions')`).
4. **Result:**

### S10 — Allocation page exposure magnitude

1. Navigate Sidenav → **Portfolio Allocation** (`/portfolio/allocation`).
2. Find the option positions in the positions list.
3. **Expect:** a 1-lot option shows market value in the hundreds-of-
   dollars range (qty × 100 × per-share mark — e.g., `$191.00`), not
   `$1.91` (multiplier dropped) and not `$19,100` (double-applied).
   Short option rows contribute **negative** exposure.
4. **Result:**

### S11 — `/trading/live` snapshot surface

1. Navigate Sidenav → **Trading** → **Live** (`/trading/live`).
2. **Expect:** option positions appear in the workspace account
   snapshot with the same signed-quantity semantics (short = negative)
   — the snapshot walks `get_option_positions` raw and shares the
   parse fix.
3. **Result:**

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| AC1 — `data.positions` extracted; rows render | S1 |
| AC2 — field map (`option_id`, `chain_symbol`, `average_price`, `quantity`, `expiration_date`, `type`→side) | S2, S4 |
| AC3 — `optionType`/`strikePrice` via instrument join | S2 |
| AC4 — specs replay captures | Automated table (client capture-replay spec) |
| AC5 — per-share × multiplier money math | S3, S5, S10 |
| AC6 — join miss/failure degrades to `—`, row preserved | S8 |
| AC7 — retry re-keys the dependent wave | S9 |
| Short position semantics | S4, S10 |
| Pagination to exhaustion (#1474 walk preserved) | S6 |

## Regression / smoke checklist

- [ ] Equity positions table unchanged (symbol, qty, avg cost correct)
- [ ] Equity orders + option orders sections still populate
- [ ] Positions with no live quote still render (price `—`/null PnL,
      not a missing row)
- [ ] Other columns sort unchanged; footer totals only under option rows
- [ ] Full jest suite green — 313/313 suites, 5,676 specs + new
      round-2 pins (2026-11-15)

## Findings

- None yet.

## Results log

- 2026-11-15 — UAT drafted for QA issue #1567.
- 2026-11-15 — **Deferred:** account holds zero option positions; S1–S11
  blocked on live test data. Automated acceptance green. Resume after
  opening ≥1 cheap option position — rerun `/proj qa 219 1481`.
