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
**Status:** Draft  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# UAT — #648 Daily Session run-sheet

Docs-only task. Deliverable: `docs/topics/625-workflows/625-646-648-RUNSHEET-workflows-daily-session.md`. Acceptance is doc review — no running app required.

## Prerequisites

- Repo checked out locally; the run-sheet doc exists on disk.

## Scenarios

### S1 — Doc exists with standard header

- **Steps:** open `docs/topics/625-workflows/625-646-648-RUNSHEET-workflows-daily-session.md`.
- **Expected:** header block carries all fields; `Issue: #646`, `Task: #648`, `Type: Run-Sheet`; every line ends with two trailing spaces.
- **Result:** PASS — verified by inspection + code review rounds 1–3.

### S2 — Daily sequence in live order

- **Steps:** read `## Daily sequence`.
- **Expected:** 1) portfolio management (with `/portfolio-dashboard` as interim surface), 2) signal review (with `/signal-review` surface + in-flight doc note), 3) event-driven slots. Short-day rule present with live-candidate override.
- **Result:** PASS — verified programmatically (sequence order + override sentence present).

### S3 — Triggered section

- **Steps:** read `## Triggered workflows` table.
- **Expected:** order placement (trigger: signal review flags order candidates) + position selection (marked planned — needs position-builder; today's implicit default noted; future chain `signal review → position selection → order placement` documented).
- **Result:** PASS — verified programmatically + round-3 review confirmed consistency with the user's SR→OP ruling.

### S4 — Weekly + inventory

- **Steps:** read `## Weekly / periodic` + `## Workflow inventory`.
- **Expected:** strategy analysis + results review with cadence/timebox; inventory table has all six workflows with Status, Doc, Last updated columns; ownership/update rule stated (incl. chain-reference updates when position-builder lands).
- **Result:** PASS — all six rows confirmed programmatically; update conventions verified in code review.

### S5 — Timebox honesty + parking lot

- **Steps:** check every timebox carries `(est.)`; read `## Session timebox guidance` + `## Parking lot`.
- **Expected:** all estimates marked; guidance names them estimates; parking lot has real guidance text (no placeholders).
- **Result:** PASS — all four timebox cells carry `(est.)` + blanket note in guidance.

### S6 — Readability / rendered markdown (user judgment)

- **Steps:** preview the run-sheet in IDE markdown preview (Ctrl+Shift+V) or GitHub. Header fields one-per-line; three tables render; no broken cells.
- **Result:** pending user confirmation.

### S7 — Actionable at session start (user judgment)

- **Steps:** pretend it's tomorrow's session start. Open the run-sheet — could you follow it end to end without asking questions? Every step either names a route, marks `(manual)`, or is honestly marked Planned?
- **Result:** pending user confirmation.

## Traceability

| Criterion (task #648 / PRD) | Scenario |
|---|---|
| Doc exists w/ standard header | S1 |
| Daily sequence, PM first | S2 |
| Triggered section + triggers | S3 |
| Six-workflow inventory + status | S4 |
| Template + conventions conformance | S1, S5 |
| Session timebox guidance (IMPL §2) | S5 |
| Handoff chain = user's ruling (SR→OP; PS planned) | S3 |
| Usable at session start (PRD intent) | S7 |

## Refinement pass

No app UI surface — rendered-markdown quality covered by S6.

## Regression / smoke

- `npx jest --coverage=false` — 155 suites / 2112 tests green (docs touch no code).
