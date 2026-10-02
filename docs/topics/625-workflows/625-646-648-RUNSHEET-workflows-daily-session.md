**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #646  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #648  
**Domain:** WORKFLOWS  
**Type:** Run-Sheet  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Daily Session Run-Sheet

**Purpose:** the single doc opened at session start — sequences the Trading Workflows into the day's plan so nothing gets skipped and nothing rabbit-holes.  
**When:** once per trading session, before any workflow begins.  
**Timebox:** ~5 min to skim + orient; the workflows themselves carry their own budgets.  
**Inputs:** the workflow docs listed below; the app.  
**Feeds:** none — this doc launches workflows, it doesn't hand data between them.  

Doc-as-script: open this beside the app at session start. Work the sections in order. Checkboxes in the linked workflow docs are optional scaffolding — tick them or don't (conventions: `625-646-647-CONVENTIONS-workflows-trading-workflows.md`).

## Daily sequence — live order

1. **Portfolio management** — positions come first once you hold any: systematic pass at `/portfolio-dashboard` — open positions, exposure, anything needing action today. Positions also get watched intraday; the session-start pass is the deliberate one. *(Planned — no workflow doc yet; route is the interim procedure.)*
2. **Signal review** — the funnel, not the firehose: ~150–200 raw signals/day → filter by watch list → timeframe → direction → ~5–15 actionable for primary daily long. Per-candidate decision is **live / paper / decline**. Feeds order placement. *(Surface: `/signal-review`; workflow doc in flight — task #649.)*
3. **Event-driven slots** — after signal review, work whatever the triggered workflows below have queued. Skip slots with nothing pending; don't manufacture work.

The whole point is compartmentalization — each step is its own box, so 150+ signals never sit on the desk at once.

If the day is short, the daily sequence still runs in this order — but a triggered slot with a **live candidate** (an approved candidate awaiting order placement) outranks routine review: place pending orders before re-running routine triage.

## Triggered workflows — run when their trigger fires

| Workflow | Trigger | Timebox | Doc |
|---|---|---|---|
| Order placement | Signal review flags order candidates | ~15 min (est.) | *Planned — no doc yet* |
| Position selection | *(planned)* Signal review flags candidates — needs the position-builder surface (pick structure/strikes/stops). Today it's implicit: default to shares or long calls inside order placement. | ~15 min (est.) | *Planned — no Thread yet. When built it slots in: `signal review → position selection → order placement`* |

## Weekly / periodic

| Workflow | Cadence | Timebox | Doc |
|---|---|---|---|
| Strategy analysis | Weekly (or on request) | ~60 min (est.) | *Planned — no doc yet* |
| Results review | Weekly (or on request) | ~30 min (est.) | *Planned — no doc yet* |

## Session timebox guidance

All workflow timeboxes are **estimates** until the docs exist and get tuned by real use (conventions: timeboxes start as estimates). Budget the session loosely — daily workflows plus whatever triggered slots actually fired. If a workflow blows its timebox, note the overflow in that doc's parking lot — don't silently absorb it; the timebox exists to make rabbit-holing visible.

## Workflow inventory

| Workflow | Status | Doc | Last updated |
|---|---|---|---|
| Portfolio management | Planned — no Thread yet | — | — |
| Signal review | In progress — task #649 | `docs/topics/625-workflows/625-646-649-WORKFLOW-workflows-signal-review.md` (in flight) | — |
| Position selection | Planned — no Thread yet | — | — |
| Order placement | Planned — no Thread yet | — | — |
| Strategy analysis | Planned — no Thread yet | — | — |
| Results review | Planned — no Thread yet | — | — |

Update this table whenever a workflow doc is written, materially revised, or retired — whoever changes a workflow owns the table update in the same change. If a doc lands under a different filename than the one linked, fix the link in the same change. When the position-builder lands and position selection becomes live, update the chain references in the daily sequence too (signal review's Feeds edge flips from order placement to position selection).

## Parking lot

Stray thoughts and ideas that surface at session start go here — capture them, act on them after the day's workflows are done, not during.
