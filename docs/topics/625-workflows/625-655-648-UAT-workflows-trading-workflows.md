**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #655  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #648  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-10-11  

# UAT — Daily Session run-sheet → Daily/Weekly Checklist (#648 / QA #655)

## Scope

Document-deliverable task. The artifact under test is
`docs/topics/625-workflows/625-646-648-RUNSHEET-workflows-daily-session.md`.

## Scope change (2026-10-11 — user-directed)

The original ACs specified a workflow-framework run-sheet (live-order
sequence, triggered-workflow table, six-workflow inventory, template
conformance). On review the user redirected: what they need is a **simple
daily + weekly checklist** that grows as more strategy types ship. The doc
was rewritten to that form; the heavy scaffolding (inventory/status table,
timebox ceremony, `Feeds:` graph references, per-workflow docs indexing) was
removed. ACs below are re-mapped to the checklist form — the original ACs
are superseded by this decision.

## Checklist form under test

- `## Every session — in order` — daily items as plain `- [ ]` checkboxes
- `## Triggered — run only when it fires` — event-driven items
- `## Weekly — pick a session` — incl. `(external)` RS Momentum item
- `## Per-candidate drill-down` — growth seam for per-strategy checklists
- `## Parking lot` — anti-distraction capture
- Tags: `(manual)` = no app surface; `(external)` = outside this app

## Scenarios

### 1. Doc exists with standard proj doc header

- Steps: open the file under `docs/topics/625-workflows/`; canonical header,
  fields one-per-line, two-space breaks, `Task: #648`.
- Result: **PASS** — header intact; `Last Updated` bumped 2026-10-11.

### 2. Daily items in live order, portfolio first, routes valid

- Steps: read `## Every session` — portfolio pass first, then signal review
  (funnel numbers + live/paper/decline decision), then triggered work; each
  names a route or tag.
- Expected: routes match `AppRoutes` (`/portfolio`, `/signals/review`).
- Result: **PASS** — order + content verified; routes checked against
  `core/common/interfaces.ts`.

### 3. Triggered section names workflows + triggers

- Steps: read `## Triggered` — order placement fires on flagged candidates;
  position selection tagged `(manual)` with today's implicit procedure.
- Result: **PASS** — both items present, position selection honestly tagged.

### 4. Weekly section incl. external item

- Steps: read `## Weekly` — strategy analysis, results review, and
  "Review RS Momentum App for new symbols (external)".
- Result: **PASS** — all three present; external item tagged.

### 5. Growth seam + parking lot

- Steps: `## Per-candidate drill-down` holds per-strategy-type checklist
  stubs (long stock, vertical debit, calendar, short put, synthetic long);
  parking lot line present.
- Result: **PASS** — five strategy stubs + parking lot.

### 6. Rendered markdown *(user judgment)*

- Steps: preview the doc — header lines, checkboxes, sections render clean.
- Result: **PASS** — user confirmed 2026-10-13 (directed the checklist rewrite, reviewed the result, issued the ship directive).

### 7. Actionable at session start *(user judgment)*

- Steps: pretend it's tomorrow's open — can you work it top to bottom
  without asking questions?
- Result: **PASS** — user confirmed 2026-10-13 ("ok thats a lot better" on
  the checklist skeleton + the rewritten doc; ship directive issued).

## Execution record

| Date | Run by | Result | Notes |
|---|---|---|---|
| 2026-09-28 | agent | Partial | First draft UAT vs original run-sheet. |
| 2026-10-08 | agent | — | Stale routes fixed, then user redirected scope. |
| 2026-10-11 | agent | 5 of 7 PASS | Checklist-form rewrite; scenarios re-mapped to new ACs. 6/7 await user. |
| 2026-10-13 | user | PASS | Scenarios 6/7 confirmed; ship directive issued. QA #655 → RESOLVED. |
