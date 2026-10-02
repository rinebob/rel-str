# Paper Trading — User Guide

**Topic #553 · Core Infra thread (tasks #564–#569) · shipped 2026-09-27**

## What this is

A simulation layer that runs alongside live trading. Every signal and every
strategy launch can produce a *paper* trade — a full lifecycle simulation with
real prices but no real orders. The point: find out whether a signal or
strategy actually works *before* risking money, and compare exit strategies
against each other on the same underlying events.

It is deliberately its own account — a separate ledger, separate trades,
separate stats — so paper activity never touches or confuses your real
Robinhood positions.

**Design note (2026-09-27):** paper trading depends on Robinhood for  
*market data only* — fills and marks price off live RH quotes/chains so
the simulation is honest. The independence boundary is the ledger, not
the data source. The same `RH_CREDENTIAL_BUNDLE` secret that powers live
trading covers it; when it expires (REAUTHORIZATION_REQUIRED), re-run the
local OAuth bootstrap + `export-credential-bundle` + update the secret.

## The mental model

Three nouns, one verb pipeline:

| Thing | What it is |
|---|---|
| **Paper account** | One per user. Cash, equity, realized P&L. Starts at a fixed balance; every fill debits/credits it like a real account. Can go negative — that's information, not a bug. |
| **Paper trade** | A simulated position: legs (equity or options), fills, marks, variant runs, realized + unrealized P&L. Statuses: `PENDING` → `OPEN` → `CLOSED` / `EXPIRED` / `ASSIGNED`. |
| **Exit variant** | A named exit rule (`initial-stop-10`, `trailing-20`, `time-30d`, `limit-sd1`). Every trade can run multiple variants *side by side* — one **governing** variant decides the real (paper) exit; the others run as shadows so you can see "what would trailing-15 have done instead". |
| **Cohort** | All trades spawned from the same signal — one signal might produce an equity-leg trade plus option-expression trades. The cohort groups them so you can compare expressions of the same idea. |

**Passes** (the server-side machinery, all scheduled):

- **Noon PT fill pass** — fills pending option-expression legs from the live chain (delta/DTE targeting).
- **Mark pass** — refreshes mark prices on open trades.
- **Exit-eval pass** — runs each trade's variants, fires governing + shadow exits.
- **Stats pass** (nightly) — writes rollup stats + equity curves per scope (`all`, per-instance, per-cohort, per-variant, per-symbol, per-signal).

## Where things live in the UI

| Page | What's there |
|---|---|
| **Signal Order** (`/signal-order`) | "Accept as Paper" on staged equity tickets → creates a paper trade + cohort. Paper tickets get a teal **PAPER** badge and a Paper queue group — visually distinct from real orders. **Paper Trading** link in the header. |
| **Paper Trading** (`/paper-trading`) | The dashboard — the observability surface for everything above. |
| **Strategy Builder** (`/strategy-builder`) | Strategy instances save to the paper ledger; the Governing Variant section picks the exit rule (family + param) that each launched trade carries. |

## Using it — the three flows

### 1. Signal → paper (today's simplest path)

On the signal-order page, staged tickets with signal context show **Accept as
Paper**. Edit the ticket first (quantity etc.) — the confirmation dialog shows
what will be submitted, and the callable uses those values. Accepting creates
a cohort: the equity leg fills immediately at the real quote; pending
option-expression trades fill at the noon-PT pass.

Paper tickets *stay* in the ticket list (teal PAPER badge) — they're
provenance, not real orders. Bulk "remove selected" skips them so the ledger
keeps its lineage.

### 2. Watch it on the dashboard

- **Header** — cash / equity / realized / unrealized / capital required /
  open count. Negatives render red, never hidden.
- **Group by** — repivot the trades table by strategy instance, cohort,
  exit variant, expression, or symbol. Click the chart icon on a group to
  point the equity curve at that group's stats scope.
- **Cohort drill-down** — in cohort view, expand a group: trades grouped by
  expression, each showing legs, last mark, and every variant's outcome
  (governing flagged; shadows show their would-be exit date/price/P&L).
- **Equity curve** — cumulative P&L per stats scope. *Note:* curves populate
  only after the nightly stats pass has run at least once.

### 3. Strategy instances

Create/edit an instance in the strategy builder as usual — the new
**Governing Variant** section picks the exit family (initial stop / trailing
stop / time stop / stddev level) and its parameter. It saves as a
param-encoded key the backend's exit engine parses (`trailing-15` = trailing
stop at 15%).

## What to actually check (first live pass)

1. Signal-order → stage an equity ticket → Accept as Paper → teal badge.
2. `/paper-trading` → trade row, cash decreased, group-by works.
3. After the noon fill pass → option-expression trades fill.
4. After the nightly stats pass → equity curves render; the governing
  trailing stop shows on each trade row.

## Known limitations (honest list)

- **`governingVariant` is consumed at launch** — launched strategy trades
  carry the instance's configured `trailing-{pct}` as their single
  governing run (missing/ineligible stored keys warn and default to
  `trailing-8`). No shadow/counterfactual runs are seeded.
- **No manual option entry or strategy launcher UI yet** — queued as
  follow-on threads (per the plan: one-off spread → backtest → promote,
  add-on/pyramiding).
- **Dashboard regrouping is client-side** over the loaded trade list — fine
  now; if the ledger grows large, grouping queries may move server-side.
- **Equity curve lag** — stats are nightly-batch, not realtime.
