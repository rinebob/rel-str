**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** strat-manage-page-overhaul  
**Issue:** #1660  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** USER-GUIDE  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# Strategy Manage — User Guide

**Topic #137 · Thread #1510 (tasks #1538–#1549) · shipped 2026-11-22**

## What this is

The control surface for running options strategies on real market data,
in paper. You pick a spread shape, give it concrete parameters, attach it
to a symbol, and hit **Start**. Every trading day at noon PT the engine
opens a fresh position for every running instance — sized from live
Robinhood quotes — then tracks it through expiration against **six
different exit rules simultaneously**, so you can see not just "did the
spread make money" but "which exit discipline would have been best".

Paper only in v1. A **Real** tab exists and the data model already
supports real-mode instances, but creating or starting real instances is
disabled until real execution lands (v2).

## The mental model

Four nouns, in order. Each one pins the one below it:

| Thing | What it is | Example |
|---|---|---|
| **Template** | A spread *shape* — leg roles, call/put, long/short, ordering rules. No concrete numbers. | Put Credit Spread (PCS) |
| **Named variant** | A template + concrete per-leg **Δ** and **DTE** values, with a name. | `pcs-45-10-20` — PCS at 45 DTE, long Δ10, short Δ20 |
| **Strategy instance** | One named variant × one symbol (+ trigger, mode, stop type). This is the thing you start and stop. | `QQQ-PCS-45-10-20-ALL` |
| **Position** | A real spread the engine opened for an instance, priced off live RH quotes. | `{instanceId}-{marketDate}` |

Two invariants worth remembering:

- **One instance per (variant, symbol, stop) — ever.** The instance ID is
  generated from exactly those parts, so a duplicate can't exist.
  "Re-running" a strategy means starting the same instance again; the
  create dialog skips IDs that already exist rather than making a copy.
- **Stop type `ALL` on paper.** Paper positions are evaluated against
  *every* registered exit strategy at once — one governing exit would
  throw away the comparison data, which is the whole point.

### Reading an instance ID

`{SYMBOL}-{SHAPE}-{DTE}-{ΔLEGS}-{STOP}` — all caps, self-describing:

```
QQQ - PCS - 45 - 10-20 - ALL
 │     │     │     │      └─ stop type (ALL = track all exits)
 │     │     │     └─ leg deltas, template order: long 10, short 20
 │     │     └─ days to expiration target
 │     └─ put credit spread
 └─ symbol
```

More: `QQQ-IC-30-10-20-20-10-ALL` = iron condor, 30 DTE, put wing 10 /
put body 20 / call body 20 / call wing 10 (outer→inner). A real-mode
instance would end in a concrete stop code (e.g. `…-T8`) instead of
`ALL`.

## Where it lives

Nav sidebar → **Options → Manage** → `options/strategy/manage`.

The old `options/strategy/build` route is gone — no redirect.

## The variant catalog

Six templates ship seeded (code-curated in
`shared/manage-variant-catalog.ts`), each expanded into a Δ×DTE grid of
named variants — 40 total:

| Template | Code | Shape | Variants |
|---|---|---|---|
| Call Debit Spread | CDS | long call + short call, \|Δ\|long > \|Δ\|short | 8 (30/45 DTE × Δ pairs 40-30 → 70-60) |
| Put Debit Spread | PDS | long put + short put, \|Δ\|long > \|Δ\|short | 8 |
| Call Credit Spread | CCS | short call + long call (credit) | 6 (10-20 / 15-25 / 20-30 × 30/45 DTE) |
| Put Credit Spread | PCS | short put + long put (credit) | 6 |
| Naked Strangle | NS | short put + short call (no wings) | 6 (15-15 / 20-20 / 25-25) |
| Iron Condor | IC | long put + short put + short call + long call | 6 |

Debit templates carry **no delta bands** — any long-closer-to-the-money
pair is a valid instance of the shape (the `direction` field
machine-enforces the ordering). Credit templates keep their authoring
bands. All seeded templates share one expiry across legs
(`uniformDte: true`) — the DTE in the ID is *the* DTE.

## Using it — the five flows

### 1. Create a named variant ("Create New Strategy")

Header → **Create New Strategy**. You get a template picker plus a
per-leg form:

- Pick a template → per-leg **Δ** and **DTE** inputs appear,
  direction-aware prefilled (puts get signed deltas handled for you).
- A **suggested name** fills in from the convention
  (`put credit spread 45 10-20`) but yields to anything you type.
- `uniformDte` templates keep one DTE field synced across legs.
- Inline validation: range, sign, precision, leg ordering, collisions
  against the catalog and your own session names.
- **Save** adds it as an ephemeral **session variant** — usable in
  Create New Instance for this page session; it doesn't write to the
  shared catalog.
- **Export JSON** copies the variant in registry schema to your
  clipboard — paste it into the catalog file or hand it to the
  bulk-authoring workstream.

### 2. Create strategy instances ("Create New Instance")

Header → **Create New Instance**. Configure:

- **Variant** — dropdown merges the catalog + your session variants;
  `custom` sentinel for a variant composed ad hoc (the instance embeds a
  full snapshot either way — registry edits can't silently rewrite a
  running instance).
- **Symbols** — free text, comma/space separated, ALL-CAPS, deduped and
  charset-validated (50 max). One instance is created **per symbol**.
- **Mode** — Paper (real is present but disabled in v1).
- **Trigger** — `daily` (open every trading day) or `signal` (open only
  on days an ST signal fires for the symbol). There are **no schedule
  pickers** — the noon-PT routine is engine-owned; the trigger just
  decides what makes *your* instance eligible each day.
- **Stop type** — `ALL` (required for paper).
- **Preview** — every row shows the exact ID it would mint before you
  commit.

**Partial create:** hitting Create with ≥1 clean row writes exactly the
clean subset. Rows that would collide (instance already exists —
including soft-deleted ones) or fail validation stay in the field with a
`Created N — M left` notice. The write is a single Firestore
transaction — existing IDs are *skipped, never overwritten*.

New instances land as **UNSTARTED** — nothing trades until you start
them.

### 3. Work the table

The page is Paper | Real tabs over one sortable, filterable table:

| Column | Content |
|---|---|
| Instance ID | the full `SYM-SHAPE-DTE-ΔLEGS-STOP` id |
| Symbol | |
| Variant | friendly name (`put credit spread 45 10-20`) |
| Stop Type | `ALL` |
| Trigger | `daily` / `signal` |
| Run State | `UNSTARTED` / `ACTIVE` / `STOPPED` |
| Open Position | `Yes · Open` (+ status), `Waiting` (ACTIVE but flat — hasn't hit its noon gate yet), `No` |
| Created | date |
| Actions | **Results** · **Start**/**Stop** |

- **Sort:** click a header cycles asc → desc → unsorted; **shift+click**
  adds a secondary key (priority badges show the order).
- **Filters:** free text (id/symbol/variant), run-state dropdown,
  position dropdown (All / Open / Waiting / Flat).
- Only the table area scrolls — the header, tabs, and filter bar stay
  pinned.

### 4. Start / stop

Per-row action:

- UNSTARTED → **Start** → ACTIVE (UNSTARTED never comes back —
  restarting a stopped instance lands on ACTIVE).
- ACTIVE → **Stop** → STOPPED.
- STOPPED → **Start** → ACTIVE.

**Stopping gates new opens only.** Any position already open keeps being
marked and evaluated to expiry — stop means "no new trades", not
"flatten". Starting again resumes the noon-pass eligibility; it never
creates a second instance.

### 5. Read results ("Results" button + Analysis)

**Results** opens a dialog for that instance:

- **Stats block** — Realized P&L, Unrealized P&L, Premium collected,
  Open trades, Closed trades, Max drawdown. Fresh instances show `0.00`
  or `—` for fields the nightly stats recompute hasn't populated yet —
  that's honest emptiness, not a bug.
- **Open positions** — symbol, status, leg count, premium, unrealized
  P&L per row.
- **Sparkline** — the instance's equity curve, shown only once the
  stats doc carries ≥2 curve points (i.e. after the nightly recompute
  has run at least once over a real position).
- **Analysis** — opens `/options/strategy/backtest/analysis/{instanceId}`
  in a **new tab**. That page is the **exit matrix**: one result doc per
  (position, exit strategy) — where every registered exit rule *would
  have* gotten out, at what P&L. This is the answer to "should I have
  taken profit at 90% or held to expiry?"

Empty/error states are honest: "No results yet" only after data
resolves, "Failed to load results/positions" on callable errors, Escape
or Close to dismiss.

## What runs when (the machinery behind the page)

All times **PT**, weekdays only:

| Pass | When | What it does |
|---|---|---|
| Credential canary | 7:00 AM | Probes the RH credential path the noon pass uses; failure surfaces an in-app banner (reauth before opens fail) |
| **Manage open pass** | **12:00 noon** | For every ACTIVE instance: `daily` → opens a position; `signal` → opens only if an ST signal exists for the symbol today. Prices off live RH option chains |
| Mark pass | ~hourly afternoons | Refreshes marks on open positions |
| **Exit scan** | **2:00 PM** | Evaluates every open manage position through all 6 registered exits; writes the analysis docs the exit matrix reads |
| Stats recompute | nightly | Aggregates instance stats + equity curve into the stats doc Results reads |

The six exit strategies every paper position is tracked against:

| Exit | Rule |
|---|---|
| `target-90` | Take profit at 90% of max premium |
| `price-100` | Exit when the spread reaches $1.00 |
| `price-50` | Exit when the spread reaches $0.50 |
| `stop-200` | Stop out at 200% of premium (loss) |
| `dte-21` | Exit at 21 days to expiration |
| `expiry` | Hold to expiration (baseline) |

Open-pass dedupe: an instance opens **at most one position per market
day** — a same-day retry skips with `already_opened_today`, and a
position still open from a prior day gates repeats per the period rule.

## What to expect, day by day

After you create and start an instance:

1. **Same day, before noon** — nothing happens. Row shows
   `ACTIVE` + `Waiting`. That's the intended look.
2. **First noon pass** — a position opens (assuming the trigger gates
   pass): `Yes · Open` appears in the table, Results populates with
   premium collected and the open-position row.
3. **That afternoon** — the 2 PM exit scan writes the first
   (position × exit) analysis rows; the Analysis link starts showing
   the matrix.
4. **Following days** — marks refresh, the exit matrix fills out, and
   after the nightly stats recompute the Results dialog gets its
   equity sparkline. Each subsequent noon pass opens another position
   (daily triggers) — the table's Open Position cell shows the
   distinct statuses of however many are open.
5. **At expiry** — positions close out (`Expired Worthless`,
   `Assigned`, or `Closed`), P&L rolls into the stats block.

## Known limitations (honest list)

- **Paper only.** Real-mode create/start is disabled; real rows show
  honest empty results. Real execution is v2.
- **One open per day** per instance, noon-only entry — there's no
  intraday entry or per-instance scheduling by design.
- **Sparkline lag.** Equity curves come from the nightly recompute —
  brand-new instances legitimately have none.
- **Dotted symbols** (`BRK.B`-style) can't have stats — the backend
  scope regex rejects `inst-{dotted-id}` (pre-existing constraint,
  flagged).
- **Session variants are ephemeral.** A created variant lives only in
  your page session until it lands in the shared catalog — instances
  built on it are fine (they embed a snapshot), but you can't re-pick it
  in a later session.
- **Signal trigger ≠ intraday signal.** `signal` means "an ST signal
  exists for this symbol today at noon" — the signal can be from a
  prior session's bar.
- **Stock legs unsupported** — the open pass fails loudly on them; no
  seeded template uses them.
