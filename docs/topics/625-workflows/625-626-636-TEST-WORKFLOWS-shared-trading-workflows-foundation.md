**Topic:** Trading Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #636  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** Test Plan  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# Test Plan: Workflow Foundation (SHARED)

No executable tests — this Thread produces documentation. Verification is review- and acceptance-driven at the highest available seam: **reading the docs and running a real session**.

## E2E User Journeys

- Journey 1: Trader opens the Daily Session run-sheet at session start → sees the day's workflow order + triggered workflows → opens and follows the Signal Review workflow → reaches its exit criteria with order candidates handed to order placement → distractions recorded in the parking lot.
- Journey 2: Author writes a new workflow doc → follows the template skeleton → produces a conformant doc without asking clarifying questions about format.

## Integration Boundaries

- **Template ↔ pilot conformance:** the pilot doc contains every template section (Purpose/When/Timebox/Inputs/Feeds/Steps/Exit criteria/Parking lot) with no section empty or skipped.
- **Run-sheet ↔ workflow graph:** every workflow named in the run-sheet has a `Feeds:`/trigger entry consistent with the conventions; signal review's `Feeds:` names order placement.
- **Conventions ↔ filenames:** all produced docs match `docs/topics/625-workflows/` + naming pattern.

## Unit Test Targets

N/A — no code.

## Test Seams

- Highest seam: the rendered markdown docs themselves — reviewed via `/proj review` (doc review) and `/proj qa` (UAT checklist on each task).
- Lower seam: PRD user-story acceptance criteria mapped 1:1 onto task acceptance criteria checkboxes.

## Existing Test Coverage

N/A — new doc area. Prior doc-only precedent: PRD/IMPL/TEST/UAT docs under `docs/topics/` for other Topics are verified through the same review/QA gate.

## Edge Cases

- **Step with no app surface** — `(manual)` tag present and the step still describes a complete procedure.
- **Empty Feeds** — a workflow with no downstream handoff writes `**Feeds:** none` explicitly rather than omitting the field (verify convention states this).
- **Timebox overflow** — guidance exists for what to do when the timebox is exceeded (note it in the doc's parking lot / revise estimate later).
- **Stale inventory** — run-sheet status table updates as workflow Threads complete (convention states who updates it and when).
- **Missing run / no signals** — the pilot's Inputs section states the precondition and what "run it anyway" means when there are no new signals.
