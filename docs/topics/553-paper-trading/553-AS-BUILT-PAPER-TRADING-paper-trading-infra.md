# Paper Trading — As-Built & User Guide

**Topic:** #553 — Paper Trading Infra  
**Domain:** PAPER-TRADING  
**Type:** AS-BUILT  
**Status:** Living document — iterate to confirm feature coverage  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

**Threads covered:** Core Infra (#554–#569), Trade Exits (#652, #663–#676, #720, #724)  
**Purpose:** A full feature/capability inventory of paper trading as it exists
today — what it does, how to use it, and what outcome to expect. We iterate
on this doc to confirm the build matches intent; when confirmed, it stays as
the user guide.

---

## 1. What it is

A simulation layer running alongside live trading. Signals and strategy
instances produce **paper trades** — full lifecycle simulations priced off
real Robinhood market data but touching no real orders. Paper activity lives
in its own ledger (`paper-trading/{kind}/items/{id}` anchor docs) so it never
mixes with real positions.

Purpose per the vision: **execution practice** — did you make the move, react
correctly, stay patient. (Historical exit-policy comparison belongs to
backtesting, not here.)

## 2. The mental model

| Thing | What it is |
|---|---|
| **Paper account** | One per user. `cash`, `equity`, `realizedPnl`, `openTradeCount`. Starts at $0 — cash is tracked but never enforced; negative balances are permitted and visible. |
| **Paper trade** | A simulated position with legs, fills, marks, a governing exit run, and realized/unrealized P&L. Statuses: `PENDING` → `OPEN` → `CLOSED` / `EXPIRED` / `ASSIGNED` / `CANCELLED`. |
| **Trade source** | `STRATEGY` (engine instance), `SIGNAL` (accepted signal), `MANUAL` (enum exists; no producer yet). |
| **Cohort** | All trades spawned from one accepted signal — the equity trade plus option-expression trades. |
| **Exit variant / governing run** | One configured exit rule per trade (`trailing-{pct}`). Only trailing-stop is governing-eligible; `none` is a legacy inert key that can never fire. |
| **Strategy instance** | A saved strategy config (`symbol`, option type/side, delta + DTE bands, frequency, openTimePT, governingVariant) that opens paper positions on a schedule. |

## 3. Firestore layout

All paper docs live under one anchored root: `paper-trading/{kind-anchor}/items/{id}`.

| Anchor | Contents |
|---|---|
| `accounts` | One account doc per user (`cash`, `equity`, `realizedPnl`, `openTradeCount`) |
| `trades` | Every paper trade (legs, fills, marks, variantRuns, status) |
| `cohorts` | Signal cohort groupings (`signalId`, `tradeIds`, `expressionTemplates`) |
| `instances` | Strategy instance configs (also readable at `paper-trading/instances/items`) |
| `stats` | Nightly rollup docs — `all`, `inst-*`, `var-*`, `cohort-*`, `sig-*`, `sym-*` scopes, each with an equity curve |

## 4. How trades get created

### 4a. Signal → paper (single, per ticket)

**Where:** Signal Order page (`/trading/live`), per staged ticket.

**How:** A staged ticket with signal context shows **Accept as Paper**. Edit
the ticket first (quantity — the order ticket's sizing wins); the confirm
dialog previews exactly what will be submitted. On confirm, `paperSignalOrder`
fires with the ticket's `refId` as idempotency lineage.

**What happens:**

1. A **cohort** doc is created (`sig-{signalId}` scope lineage).
2. An **equity trade** fills immediately at the live RH equity quote → `OPEN`.
3. One **PENDING expression trade** per direction-mapped template (below) is
   queued — these resolve at the noon-PT expression fill pass.
4. The ticket gets a teal **PAPER** badge and stays in the ticket list as
   provenance. Bulk "remove selected" skips paper tickets.

**Expression templates** (fixed today, configurable later):

| Signal direction | Template | Expression | Option | Side | Delta | DTE |
|---|---|---|---|---|---|---|
| LONG | `csp-030-45` | CSP | Put | Short | 0.30 | 30–60 (target 45) |
| LONG | `lc-050-30` | LC | Call | Long | 0.50 | 20–45 (target 30) |
| SHORT | `sc-030-45` | SC | Call | Short | 0.30 | 30–60 (target 45) |
| SHORT | `lp-050-30` | LP | Put | Long | 0.50 | 20–45 (target 30) |

Every cohort trade gets one **governing variant run: `trailing-8`**
(8% reversal off the favorable water mark). Signal cohorts seed no shadow runs.

### 4b. Signal → paper (batch)

**Where:** Order Queue panel on `/trading/live`.

**How:** Check staged tickets → **Send N to paper** appears when checked
tickets are paper-eligible (STAGED status + signal context). Converts each
checked ticket through the same `paperSignalOrder` path; the button disables
while sending and shows a count of eligible tickets only.

### 4c. Strategy instances → engine trades

**Where:** Strategy Builder (`/options/strategy/build`), linked from the
dashboard header.

**How:** Create/edit an instance — symbol, option type/side, target delta,
DTE band, frequency, `openTimePT`, and the **Governing Variant** section
(family + param → a `trailing-{pct}` key; only trailing-stop is offered,
param must be a sane 0 < pct < 100). Saving writes the instance doc; the
engine picks it up on its lifecycle (`ACTIVE` opens new positions; `PAUSED`/
`STOPPED` manage existing only).

**What happens:** the nightly **selection pass** (after SDS close sync) picks
a contract from the overnight delta grid; the **open pass** (every 5 min,
6 AM–1 PM PT weekdays) opens the position at the instance's `openTimePT`,
respecting overnight-move limits. Positions open as `OPEN` engine trades
carrying the instance's governing variant (ineligible/missing keys warn and
default to `trailing-8`).

## 5. The lifecycle machinery (scheduled passes)

| Pass | Schedule | What it does |
|---|---|---|
| **Open pass timer** | Every 5 min, 6 AM–1 PM PT, Mon–Fri | Opens positions for instances whose `openTimePT` matches the slot. No-ops before 6:30 AM. |
| **Expression fill pass** | Noon PT, Mon–Fri | Resolves PENDING expression trades: RH chains → instruments → quotes → delta/DTE contract selection → entry fill → `OPEN`. |
| **Mark pass** | Every 30 min, 6:50 AM–1 PM PT, Mon–Fri (also `optionsMarkPassManual` callable) | Refreshes option marks on open engine positions AND open signal trades (same cadence so governing trailing stops have fresh marks). |
| **Nightly chain** (SDS consumer) | After nightly symbol-data sync | Per market date: **exit-eval pass** (global) → **signal settlement** (global) → per-instance **settlement + held-shares marking** → **stats rollup**. |
| **Stats pass** | End of nightly chain | Recomputes all stats scopes + equity curves. Batch, not realtime. |

### Settlement semantics (both sources, symmetric since #720/#724)

- A leg settles when `leg.expiration <= runDate` — a skipped night or
  midnight-boundary date mismatch retries automatically, never zombies.
- The settlement close is looked up **at the leg's expiration date**, walking
  back up to 7 calendar days for weekend/holiday expirations (a Saturday
  expiry settles at Friday's close). Never before the position's open date —
  a stale-close attempt errors loudly.
- **All legs OTM** → `EXPIRED_WORTHLESS`: premium fully realized, governing
  run exits at 0, marks dated to the *observed* trading day (honest dating:
  `closeDate`, `dailyUpdate.date`, `assignedAt`, exit events all carry the
  observed bar's date, not the run date).
- **Signal trades, any ITM leg** → cash settlement at net intrinsic
  (intrinsic buyback model — no held-shares seam for signal trades).
- **Engine trades, any ITM leg** → **loud error, stays eligible** (no
  brokerage outcome checker is wired — see #728). Deliberate: it refuses to
  fabricate `EXPIRED_WORTHLESS` for an ITM position.
- Engine `ASSIGNED` positions convert to held shares, marked by the
  held-shares pass each night.

### Exit evaluation

- One governing `trailing-{pct}` run per trade evaluates at each mark/nightly
  pass; a trigger closes the trade at the mark price, finalizes the run, and
  books realized P&L to the account.
- Other variant families (`initial-stop`, `time-stop`) have real evaluators
  but are not governing-eligible (product gate: one trailing stop per trade,
  mirroring a real broker). `limit-stddev` is a stub. Shadow/counterfactual
  runs exist in the eval machinery but nothing seeds them today —
  `SIGNAL_SHADOW_VARIANT_KEYS` is empty.

## 6. The dashboard (`/trading/paper`)

- **Header stats** — Cash, Equity, Realized P&L, Unrealized P&L, Capital
  Required, Open count. Negatives render red, never hidden.
- **Group by** — repivot the trades table: All / Strategy instance / Signal
  cohort / Exit variant / Expression / Symbol. Clicking a group's chart icon
  points the equity curve at that group's stats scope.
- **Trades table** — per trade: symbol, expression, legs, side, entry/exit,
  last mark, realized + unrealized P&L, status.
- **Cohort drill-down** — in cohort grouping, expand a group: trades grouped
  by expression, each with legs, last mark, and variant outcome.
- **Equity curve** — cumulative P&L for the selected stats scope. Populates
  only after the nightly stats pass has run at least once.
- **Strategy Builder link** — straight to instance management.

## 7. Callable surface

| Callable | Direction | Purpose |
|---|---|---|
| `paperSignalOrder` | FE → BE | Accept a signal ticket as a paper cohort (equity fill now + PENDING expressions). Idempotent on `refId`. |
| `listPaperTrades` | FE → BE | All trades, optional filters: status, source, instance, cohort, signal, symbol, expression, variantKey. |
| `getPaperStats` | FE → BE | Stats docs — one scope or all. |
| `getPaperAccount` | FE → BE | Caller's account doc. |
| `listExitVariants` | FE → BE | Registry of variant configs (drives the builder's governing-variant picker). |
| `cancelPaperTrade` | BE only | Cancel a `PENDING` trade before its fill. **Deployed but no FE wiring yet.** |
| `closePaperTrade` | BE only | Close an `OPEN` trade at the live quote, whole unit. **Deployed but no FE wiring yet.** |

## 8. Usage walkthrough — what to do and what to expect

**Signal → paper:**
1. Signal Order page → stage tickets as usual.
2. Single: edit a ticket, click **Accept as Paper**, confirm the preview →
   teal PAPER badge; equity leg is `OPEN` at the live quote immediately.
   Batch: check staged tickets → **Send N to paper**.
3. `/trading/paper` → trade row appears, cash moved, cohort groupable.
4. After the noon-PT fill pass → expression trades flip `PENDING` → `OPEN`
   with a real selected contract.
5. Marks refresh every 30 min during market hours; the governing `trailing-8`
   evaluates against each new mark. A reversal past the stop closes the
   trade and books realized P&L.
6. Options that expire: settle nightly — OTM worthless (premium banked),
   signal-ITM at intrinsic, engine-ITM errors loudly (pending #728).

**Strategy instance:**
1. Strategy Builder → configure the strategy + governing variant → save.
2. Nightly selection picks a contract; the open pass opens it at `openTimePT`
   on the instance's frequency.
3. Same mark/eval/settle lifecycle as signal trades; group by "Strategy
   instance" on the dashboard to isolate it.

**Expected healthy outcomes:**
- No `OPEN` trade sits past its expiration date overnight.
- Weekend-expiry trades settle at the Friday close, dated to Friday.
- `openTradeCount` and realized P&L in the account header match the table.
- Equity curves render per scope after the first nightly stats pass.

## 9. Known limitations / not built yet

- **#728** — engine ITM settlement has no outcome checker: ITM engine trades
  refuse to settle (error, stay OPEN) rather than guess. Fix = wire a real
  brokerage checker or compute the outcome locally.
- **No manual option order entry** — `MANUAL` source exists in the enum but
  has no producer. Deferred follow-on thread.
- **No close/cancel buttons in the UI** — `closePaperTrade`/`cancelPaperTrade`
  callables are deployed but unwired; today exits happen via governing stops
  or settlement only.
- **No independent strategy launcher UI** — instances are managed in the
  existing Strategy Builder; a dedicated paper-strategy builder/launcher is
  a follow-on.
- **No shadow/counterfactual variant runs** — single governing trailing stop
  per trade by design (variant-exit comparison belongs to backtesting).
- **Signal-trade assignment not modeled** — ITM signal legs cash-settle at
  intrinsic; no held-shares path for `SIGNAL` source.
- **Cash not enforced** — the account can go negative; that's information
  about over-trading, not a bug.
- **Equity curve lag** — stats are a nightly batch, not realtime.
- **Dashboard grouping is client-side** over the loaded trade list.
- **Exit policies on instances** — `ROLL` and `EXIT_AND_REPLACE` are
  config-only (stored, not enforced; Topic #139).

## 10. Ops notes

- Paper trading depends on Robinhood for **market data only** — fills/marks
  price off live RH MCP quotes and chains. The same `RH_CREDENTIAL_BUNDLE`
  secret powers it; when it expires (REAUTHORIZATION_REQUIRED) the mark pass
  and entry fills degrade until re-authorized.
- Engine nightly passes run as **SDS consumers** (`sds-consumer-dispatch`)
  after closing bars land — ordering is guaranteed, not schedule-raced.
- Production verify scripts live under `functions/scripts/verify/` and
  `scripts/verify/` (chain runners + README); each exercises the real pass
  against real data with scratch-doc cleanup.
