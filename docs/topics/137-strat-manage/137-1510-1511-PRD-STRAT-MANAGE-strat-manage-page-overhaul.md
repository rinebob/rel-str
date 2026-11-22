**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1511  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# PRD — OpsStrat Manage Page Overhaul

## Background

The page at `options/strategy/build` was built as a CRUD list for
`StrategyInstanceConfig` — a scheduled auto-trader (symbol, single spread type,
target delta, DTE band, frequency, open time, exit policies). The UI never
conformed to the underlying data structures: the contract supports `phases[]`
but the form hardcodes one; "run" is only a lifecycle badge toggle while all
position/P&L data lives on a separate dashboard page.

The options platform has since grown a richer model — spread **templates**,
**named variants** (template + concrete per-leg delta/DTE), and a shared
**exit-registry evaluation engine** that scans exit rules over a position's
mark series. The page is being rebuilt around that model and renamed
**Manage** (`options/strategy/manage`): the surface where users create,
configure, and initiate strategy runs. The Options Strategy Dashboard remains
the separate aggregator for results across all strategies.

## Terminology

- **Template** — a spread *shape* with no delta or DTE (e.g., "iron condor",
  "call debit spread"). Authored outside the app by a companion workstream;
  consumed here as a pick list.
- **Named Variant** — a template plus a concrete delta and DTE assignment for
  each leg, given a descriptive name, e.g., "call debit spread 30 50-40"
  (30 DTE, long 50Δ, short 40Δ — same segment order as the ids). A variant is a *pure structure recipe* —
  it deliberately does NOT carry a stop type, so the same variant stays
  reusable across modes and across different stops. Most variants are
  authored in bulk outside the app and simply appear in the pickers;
  one-off custom variants can also be created ad hoc in-app via **Create
  New Strategy** (ephemeral — exported to the registry JSON, never saved
  to Firestore). Instantiating a variant binds it to a symbol, a mode, and
  a stop type.
- **Strategy Instance** — a named variant + symbol + stop type + mode. The
  unique key and the unit the Manage table lists, starts, and stops. The
  instance embeds the resolved variant definition so it is self-describing
  even when the variant isn't in the registry.
- **Run** — the instance's active operation. **Paper run**: opens paper
  positions per the variant on its trigger and tracks them to expiration,
  evaluating every registered exit type observationally (each firing is
  recorded; nothing actually exits early). **Real run** (v2): opens real
  positions on its trigger and *enforces* the one configured stop type —
  it fires a real exit when triggered.
- **Trigger** — what causes an ACTIVE instance to open a new position at
  the daily noon-PT routine. **Time-based** (`daily`): always opens a new
  position each trading day (the CSP-ladder behavior — concurrent
  positions accumulate). **Signal-based** (`signal`): opens a position
  only when an ST signal fires for the instance's symbol. There is no
  per-instance timer configuration — trigger is a property of the
  instance chosen at creation, and start/stop from the table is the only
  user control.
- **Mode** — `paper` or `real`. Segregates instances onto their own tabs;
  v1 executes paper only.
- **Stop type** — the exit/stop rule attached to an instance. **Paper**
  instances always use `ALL` (every registered exit type is evaluated — the
  exit matrix). **Real** instances must specify exactly one concrete stop
  type; real can NEVER be `ALL`. This is a hard model invariant, not a
  UI nicety.
- **Exit tracking** — each open position's accumulating mark series is
  scanned by the shared Exit Registry evaluators
  (`functions/src/options-analysis/exit-evaluators.ts` +
  `shared/options-analysis-registry.ts`) — the same engine used by backtest
  analysis, no run-specific exit logic. **Paper** evaluates every registered
  exit type; **real** evaluates only the instance's one configured stop type.

## Paper vs Real — where they differ

| Aspect | Paper | Real |
|---|---|---|
| `mode` field | `'paper'` | `'real'` |
| Stop type | always `ALL` | exactly one; never `ALL` |
| Run operation | open + track all exits to expiry (observational) | open + enforce one stop (fires real exit) |
| Exit evaluation | every registered exit type | only the configured stop type |
| Purpose | research / exit-matrix tracking | real-money execution |
| ID suffix | `…-ALL` | `…-{STOP}` |
| v1 support | full create/start/stop | tab + schema only; create/start disabled until v2 |

## Goals

1. Rename and repurpose the page to `options/strategy/manage` as the single
   create/configure/initiate surface for strategy runs; migrate all callers
   of the old `options/strategy/build` route (no redirect shim).
2. Conform the UI to the real object model: template → named variant →
   strategy instance, instead of one monolithic config form.
3. Make starting and stopping runs a first-class, one-click action.
4. Reuse the shared exit-evaluation engine so run positions are tracked to
   expiration — all exit types on paper, the one configured stop type on
   real.
5. Keep instance IDs human-meaningful, all caps, and self-describing
   (symbol + spread type + DTE + leg deltas + stop type).

## Non-goals

- Position detail, portfolio-level P&L aggregation, and multi-strategy
  comparison — owned by the Options Strategy Dashboard (redesigned separately).
- Template/variant *hydration* and bulk variant authoring — done outside the
  app by the companion workstream; this page consumes their artifact. (Ad hoc
  in-app variant creation IS in scope — US-2.)
- Per-instance schedule/timer UX (frequency pickers, open-time fields) —
  out of scope. The daily noon-PT routine is the fixed engine behavior;
  instances just declare their trigger kind (daily vs signal) at creation.
- Real-mode execution (order routing, real fills) — v2. The real tab and the
  `real` mode exist in schema and UI now so v2 is an enablement, not a
  redesign.
- Backtest analysis page changes — handled by a separate thread; the
  backtest contract-list logic will adopt this ID format.

## User stories

### US-1 — Navigate to Manage

As a trader, I open the options strategy nav and click **Manage** to reach
the page.

*Acceptance criteria:*
- The route `options/strategy/manage` loads the Manage page; the nav item
  reads "Manage".
- The old `options/strategy/build` route is retired with no redirect —
  every current caller (nav config, route constants, component references)
  is migrated.

### US-2 — Create a named variant ("Create New Strategy")

As a trader, I click **Create New Strategy**, pick a template, assign a delta
and DTE to each of its legs, and save it under a descriptive name — for
one-off custom strategies. (Most variants arrive pre-authored via the
external artifact; this button is the ad hoc path and is expected to be
used infrequently.)

*Acceptance criteria:*
- The dialog lists available templates from the template catalog (external
  JSON artifact).
- Selecting a template renders one delta + one DTE input per leg in the
  template's shape (leg count/roles come from the template, not hardcoded).
- A suggested name is generated from the parameters (e.g., "call debit
  spread 30 50-40" — dte first, then Δlong-Δshort, matching the
  `{type}-{dte}-{Δlong}-{Δshort}` variant id) and is editable before saving.
- The saved named variant becomes selectable in Create New Instance.
- Validation rejects incomplete leg assignments and duplicate names.
- An **Export to JSON** button (in the create flow and/or on the saved
  variant) opens a dialog showing the variant serialized in registry JSON
  format, ready to copy-paste into the registry file.
- Ad hoc variants are NOT persisted to Firestore — they are ephemeral
  (immediately usable for instance creation; durable via the export flow).
  The named-variant picker merges externally authored variants (artifact)
  and ad hoc in-app variants transparently — the user doesn't care where a
  variant came from.

### US-3 — Create strategy instances ("Create New Instance")

As a trader, I click **Create New Instance**, pick a named variant, choose
the mode, and attach it to one or more symbols. One instance per symbol is
created and appears in the table.

*Acceptance criteria:*
- The dialog offers the named-variant list and a multi-symbol picker.
- The create flow targets one mode — paper or real. Paper instances get
  stop type `ALL` automatically. Real instances require selecting exactly
  one concrete stop type — `ALL` is never offered or accepted for real.
  (Real-mode creation is present but disabled in v1; see US-5.)
- The create flow selects the instance's trigger: **daily** (opens every
  trading day at the noon-PT routine) or **signal** (opens when an ST
  signal fires for that symbol). No timer/frequency UI is offered.
- Confirming creates N instances (one per selected symbol) in the UNSTARTED
  state; each appears as its own table row on the tab matching its mode.
- Variant + symbol + stop type is the unique key — a second instance for
  the same triple is impossible; re-running a stopped run is done by
  starting the same instance, never by creating a new one.
- Each new instance gets an ALL-CAPS ID of the form
  `{SYMBOL}-{SPREADTYPE}-{DTE}-{ΔLEGS}-{STOP}` (e.g., `QQQ-CDS-30-50-40-ALL`
  for paper, `QQQ-CDS-30-50-40-T8` for real) — the ID is the dedup key.
  The `{STOP}` segment uses a human-readable stop code (code vocabulary
  TBD — not a v1 blocker).

### US-4 — Review the instance table

As a trader, I see my instances in a sortable, filterable table, segregated
by mode into **Paper** and **Real** tabs, and can tell at a glance what each
is doing.

*Acceptance criteria:*
- Paper and real instances are shown on separate tabs; the create flow adds
  rows to the tab matching the selected mode.
- Columns include at minimum: instance ID / name, symbol, named variant,
  stop type, lifecycle state (UNSTARTED / ACTIVE / STOPPED), whether an
  open position exists, the open position's status when present, and an
  actions column.
- Running-but-untriggered is visually distinct from has-open-position (an
  ACTIVE instance with no open position does not look broken — e.g., a
  signal-triggered instance waiting for a signal).
- The table shows each instance's trigger kind (daily / signal).
- Sort and filter work on the primary columns (symbol, variant, state,
  position status).

### US-5 — Start and stop a run

As a trader, I start an instance when I'm ready and stop it when I want it
off; start/stop are row actions.

*Acceptance criteria:*
- An UNSTARTED instance shows Start; starting moves it to ACTIVE.
- An ACTIVE instance shows Stop; stopping moves it to STOPPED.
- A STOPPED instance can be started again (stopped = off, not terminated);
  UNSTARTED exists only until the first start. Re-running a variant+symbol
  always means starting the same instance — a second instance for that
  triple can never exist.
- No open position is opened or closed by a stop action itself; stops gate
  future openings only (paper semantics; what a stop means for open real
  positions is a v2 decision).
- v1: start/stop is enabled for paper instances. Real-mode start is
  disabled until real execution lands in v2.

### US-6 — View a strategy results summary

As a trader, I open a per-instance popup summarizing how the strategy is
doing without leaving the page.

*Acceptance criteria:*
- The popup shows the instance's stats block: total premium collected,
  realized P&L, unrealized P&L, open/closed position counts, max drawdown.
- It shows the current open position summary (status, legs, premium) when
  one exists.
- It renders a compact equity-curve sparkline.
- It reuses the existing positions/stats/equity-curve callables — no new
  aggregation pipeline.

### US-7 — Jump to run analysis

As a trader, I click an analysis link on an instance to land on its run's
exit-matrix analysis page — opened in a new browser tab.

*Acceptance criteria:*
- The link opens `options/strategy/backtest/analysis/{listDocId}` in a new
  tab for the instance's run.
- The run's contract-list doc id is the instance ID itself — the symbol is
  already the ID's first segment, so nothing is appended. The backtest
  side adopts this same ID format (separate thread).

### US-8 — Exit tracking on run positions

As a trader, positions opened by my runs are tracked to expiration, with
exit evaluation driven by the shared registry.

*Acceptance criteria:*
- Each open position's mark series is scanned by the shared Exit Registry
  (`functions/src/options-analysis/exit-evaluators.ts` +
  `shared/options-analysis-registry.ts`) — the same evaluators as backtest
  analysis.
- **Paper**: every registered exit type is evaluated per position and each
  one's firing (or expiry) is recorded — the exit matrix. **Real**: only
  the instance's one configured stop type is evaluated.
- Results persist in a shape reusing existing analysis infrastructure
  (`st-options-analysis-results` conventions) wherever it fits — prefer
  reuse over a parallel shape.
- Adding a new exit type to the registry automatically applies to paper
  runs; no page-side code change.

## Instance ID format

`{SYMBOL}-{SPREADTYPE}-{DTE}-{ΔLEGS}-{STOP}` — ALL CAPS. Symbol first for
scan-ability, then the spread type code, the shared/primary DTE, the leg
deltas in template-defined leg order, and a human-readable stop-type code
last (`ALL` for paper; a concrete stop code for real, e.g.,
`QQQ-CDS-30-50-40-ALL`, `QQQ-CDS-30-50-40-T8`, `SPY-IC-45-30-10-ALL`).
The ID is globally unique by construction — variant+symbol+stop is a
natural unique key, so no date or sequence suffix is required. The current
`generateInstanceId` (`YYMMDD-SYM-CODE-Δ-DTE-FREQ-TIME`) does not conform
and is replaced — blueprint decides whether the old format's remaining
consumers need a migration shim.

## Technical context

- **Variant/template source**: a `.json` artifact produced outside the app
  by the companion workstream; the page loads it directly (registry-style,
  like `shared/options-replay-templates.ts` — no listing callable). This is
  the primary variant source; ad hoc variants created via US-2 persist
  elsewhere and merge into the same picker list (persistence path is a
  blueprint question).
- **Instance record (v1)**: `{id, variantRef, symbol, mode:'paper'|'real',
  stopType, trigger:'daily'|'signal', lifecycleState, createdAt}` — no
  frequency/openTime/exitPolicy fields. The record also embeds the
  resolved variant definition (legs with Δ/DTE) so it stays
  self-describing when the variant isn't in the registry — ad hoc
  variants are ephemeral and never persisted. Invariants: `stopType` is
  always `'ALL'` for paper; real always carries exactly one concrete
  stop code and never `'ALL'`.
- **Tabs**: the instance table is split into Paper / Real tabs keyed on
  `mode`. v1 execution targets paper; the real tab exists in the schema
  and UI from the start (create/start disabled until v2).
- **Analysis link**: the run's contract-list doc id = `{instanceId}` — the
  symbol is already the first segment. Backtest contract-list logic
  migrates to this format (separate thread).
- **Existing instances**: prior `st-strategy-instances` docs were deleted;
  no migration — clean schema.
- **Related backlog**: #157 (Manual open pass trigger) is superseded by
  US-5's start/stop semantics and should be reviewed at blueprint.

## System context

```mermaid
flowchart LR
    subgraph Catalog["External authoring (JSON artifact)"]
        T[Templates]
        NV[Named Variants]
    end

    subgraph Manage["Manage page — options/strategy/manage"]
        CS[Create New Strategy<br/>template → ad hoc variant]
        CI[Create New Instance<br/>variant × symbols × mode]
        TBL[Instance table<br/>Paper | Real tabs<br/>start / stop / status]
        POP[Results summary popup]
    end

    subgraph Engine["Shared services"]
        INST[(Strategy instance docs<br/>mode: paper | real)]
        EXIT[Exit Registry evaluators<br/>shared/options-analysis]
        CL[(Contract-list docs<br/>doc id = instanceId)]
    end

    subgraph Surfaces
        AN[Backtest analysis page<br/>options/strategy/backtest/analysis]
        DASH[Options Strategy Dashboard<br/>aggregator — separate]
    end

    T --> CS
    T --> NV
    CS --> NV
    NV --> CI
    CI --> INST
    INST --> TBL
    TBL --> POP
    INST --> EXIT
    EXIT --> CL
    CL --> AN
    INST -.-> DASH
```

## Open questions for blueprint

1. Disposition of #157 (manual open trigger) — fold into US-5 or keep
   separate.
2. Registry JSON schema the Export-to-JSON dialog emits (must match the
   external artifact's variant encoding exactly — coordinate with the
   companion workstream).
3. `{STOP}` code vocabulary — the human-readable stop codes used in the ID
   suffix and the real-mode picker (deferred per user; needs a defined
   mapping before real-mode work begins).
4. JSON artifact contract — exact shape the companion workstream ships for
   templates and named variants (list schema, leg encoding, refresh
   mechanism).
5. Confirm `st-options-analysis-results` doc shape fits run-position exit
   tracking for both modes (paper = one doc per position×exitId matrix;
   real = single configured stop type per position).
