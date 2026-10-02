**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Workflow Foundation  
**Thread Slug:** foundation  
**Issue:** #650  
**Thread Parent:** #626  
**Topic Parent:** #625  
**Task:** #647  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# UAT — #647 Workflow template + conventions doc

Docs-only task. Deliverable: `docs/topics/625-workflows/625-646-647-CONVENTIONS-workflows-trading-workflows.md` + checker `scripts/verify/workflows-template-647.ts`. Acceptance is doc review + script run — no running app required.

## Prerequisites

- Repo checked out locally; docs uncommitted on the working branch.
- `npx tsx` available (devDependency already used by other verify scripts).

## Scenarios

### S1 — Conventions doc exists with standard header

- **Feature:** deliverable doc in the per-Topic directory.
- **Steps:** open `docs/topics/625-workflows/625-646-647-CONVENTIONS-workflows-trading-workflows.md`.
- **Expected:** file exists; header block lines 1–14 carry `**Topic:**`, `**Topic Slug:**`, `**Thread:**`, `**Thread Slug:**`, `**Issue:** #646`, `**Thread Parent:** #626`, `**Topic Parent:** #625`, `**Task:** #647`, `**Domain:** WORKFLOWS`, `**Type:** Conventions`, `**Status:**`, `**Created:**`, `**Last Updated:**` — each bold, one per line, each ending in two trailing spaces.
- **Result:** PASS — verified by inspection + code review round 2.

### S2 — Template completeness (automated)

- **Feature:** the template defines every required section.
- **Steps:** run `npx tsx scripts/verify/workflows-template-647.ts`.
- **Expected:** `=== ALL CHECKS PASSED ===`, exit 0 — conventions doc exists, defines naming pattern / doc-as-script / `(manual)` / `Feeds: none` / per-workflow Thread model, embeds all 5 fields + 3 sections.
- **Result:** PASS — 14/14 checks green (output captured during implementation and re-run in review round 2).

### S3 — Template is generic and copy-paste-usable

- **Feature:** new workflow docs can be authored without inventing structure.
- **Steps (user judgment):** read the `## The Template` skeleton and `## Section guide`; confirm an author could produce a conformant workflow doc without asking clarifying questions.
- **Expected:** skeleton is generic (no signal-review content); every section's purpose is explained.
- **Result:** PASS — user confirmed copy-paste-usable and unambiguous.

### S4 — Conformance checker works in both directions

- **Feature:** `workflows-template-647.ts <path>` validates a workflow doc.
- **Steps:** ran against a conformant fixture (mixed `[ ]`/`[x]` steps, `(manual)` step) and a non-conformant fixture (no destinations, empty sections, empty Feeds).
- **Expected:** conformant → all pass; non-conformant → targeted FAILs.
- **Result:** PASS — conformant fixture all green; non-conformant produced 3 targeted FAILs (empty Exit criteria, empty Parking lot, step without destination).

### S5 — Rendered markdown reads cleanly

- **Feature:** the doc must render correctly when viewed on GitHub (or IDE markdown preview).
- **Steps (user judgment):** preview the conventions doc (IDE markdown preview or GitHub after commit); header fields should each be on their own line, tables should render, fenced skeleton should display as a code block.
- **Expected:** no run-together lines, no broken tables.
- **Result:** PASS — user confirmed markdown preview renders cleanly.

## Traceability

| Criterion (task #647 / PRD) | Scenario |
|---|---|
| Doc exists under `docs/topics/625-workflows/` w/ standard header | S1 |
| Template contains every section | S2, S3 |
| Conventions: naming, Feeds+`none`, `(manual)`, doc-as-script, Thread model, timeboxes | S2, S3 |
| Template generic — no signal-review content | S3 |
| Verify script works (implementation verification) | S2, S4 |
| Markdown renders cleanly (QA issue refinement item) | S5 |

## Refinement pass

No app UI surface — the "user-facing" surface is the rendered markdown itself; covered by S5.

## Regression / smoke

- `npx jest --coverage=false` — 153 suites / 2089 tests green (script + docs touch no app code).
- `scripts/verify/run-all.ts` / `README.md` registration rows verified during code review.
