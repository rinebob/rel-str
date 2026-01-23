# Implementation Efforts, IDs, and Journaling Workflow

## 1. Purpose

This document defines how we map **planning** → **implementation** → **commits** → **time journaling** across the RS app.

Goals:

- Keep a clear chain from high-level planning docs to concrete code changes.
- Ensure every meaningful piece of work has a stable **Effort ID**.
- Capture task-level details in implementation docs (not scattered in planning).
- Maintain a lightweight time journal that summarizes progress and evolution over time.

This process is intended to be reusable across apps, but examples here use the `RS` project.

---

## 2. ID Structure

### 2.1 Effort IDs (Frontend)

Pattern:

```text
<APP>-FE-<SCOPE>-<CODE>-<YYMM>-<NN>
```

- `APP`: short app code, e.g. `RS`.
- `SCOPE`: `CORE` | `FEAT` (frontend core vs feature work).
- `CODE`: short code defined in a planning doc for that core/feature family.
- `YYMM`: year + month when the effort is defined (e.g. `2601` for Jan 2026).
- `NN`: 2-digit sequential number for that month/scope/code.

Example:

- `RS-FE-FEAT-PDR-2602-01` – RS, frontend feature work for the PDR pipeline in Feb 2026.

### 2.2 Effort IDs (Backend)

Pattern:

```text
<APP>-BE-<SCOPE>-<CODE>-<YYMM>-<NN>
```

- `SCOPE` (backend): small, fixed vocabulary:
  - `FEAT` – feature/pipeline work.
  - `ADMIN` – admin utilities, backfill/cleanup, one-off tools.
  - `DOCS` – backend-focused docs/migrations.
  - `MAINT` – maintenance, refactors, grouped bugfixes.

Example:

- `RS-BE-FEAT-PDR-2601-01` – RS, backend feature work for Partner Data Ready → RS archive ingestion (PDR), Jan 2026.

### 2.3 Task IDs (within an Effort)

Tasks are defined only inside **implementation effort docs** and hang off the Effort ID:

```text
<EFFORT-ID>-T<tt>
```

- `tt`: 2-digit task index within the effort (`T01`, `T02`, ...).

Example:

- `RS-BE-FEAT-PDR-2601-01-T01` – confirm bulk pair registry import is implemented and deployed.
- `RS-BE-FEAT-PDR-2601-01-T04` – run initial full-history RS archive backfill in prod.

Effort IDs appear in:

- Planning docs (implementation overview sections).
- Implementation docs (file names and headers).
- Commit messages and branch names.
- JSDoc / inline comments (`@impl <EFFORT-ID>-Txx`).
- Journal entries.

Task IDs primarily appear in implementation docs, commits, and JSDoc.

---

## 3. Document Types and Roles

We distinguish three main layers:

1. **Planning docs** (`docs/planning/*.md`)
   - Define features, architecture, design decisions.
   - Introduce **codes** (e.g. `PDR`) and list related Effort IDs.
   - May include a short, high-level task overview (typically ~5 items) but **not** detailed implementation task checklists.

2. **Implementation Effort docs** (`docs/implementations/*.md`)
   - One file per **Effort ID** (e.g. `RS-BE-FEAT-PDR-2601-01_*.md`).
   - Contain:
     - Header with Effort ID, Area, Scope, Code, planning doc links.
     - Detailed task list with `-Txx` IDs.
     - Dated "Timeline, Decisions & Deviations" section.
     - Implementation references (files, tests, key commits).

3. **Time Journal docs** (`docs/journal/YYYY-MM_Month.md`)
   - One file per calendar month.
   - Provide a time-ordered view of:
     - Current implementation efforts and their status.
     - Dated entries summarizing recent work.
     - End-of-month summary (completed/ongoing/deprecated).
     - Upcoming/new efforts.
   - Remain short; detailed discussion lives in planning/implementation docs.

---

## 4. Templates

### 4.1 Implementation Effort Doc Template

File naming:

```text
docs/tasks/<EFFORT-ID>_<short-description>.md
```

Header:

```markdown
# <EFFORT-ID> <Short Effort Title>

- **Status**: planned | in-progress | done
- **Planning doc(s)**:
  - <PLANNING_DOC_1>.md (code `<CODE>`)
  - <PLANNING_DOC_2>.md (optional)
- **Area**: FE | BE
- **Scope**: CORE | FEAT | ADMIN | DOCS | MAINT
- **Code**: <CODE>
- **Created**: YYYY-MM-DD
- **Last updated**: YYYY-MM-DD
```

Intent:

```markdown
## Intent

One or two paragraphs explaining what this effort is meant to achieve, in implementation terms, and how it relates back to the planning doc sections.
```

Tasks:

```markdown
## Tasks

- [ ] <EFFORT-ID>-T01 – First concrete task
- [ ] <EFFORT-ID>-T02 – Second concrete task
- [ ] <EFFORT-ID>-T03 – ...
```

Timeline & decisions (time-journaled within the effort):

```markdown
## Timeline, Decisions & Deviations

### YYYY-MM-DD

- **Status**:
  - Short bullets describing the current state.
- **Decisions**:
  - Any decisions taken today, with rationale.
- **Deviations from planning**:
  - Where implementation diverged from earlier planning, with links back to updated planning sections.
```

Implementation references:

```markdown
## Implementation References

- **Key code**:
  - Paths to main components/services/functions.
- **Tests / validation**:
  - Paths to tests, validation scripts, or procedures.
- **Primary commits**:
  - Commit hashes + short descriptions.
```

### 4.2 Monthly Journal Template

File naming:

```text
docs/journal/YYYY-MM_MonthName.md
```

Structure:

```markdown
# Month YYYY Journal

## Current Implementation Efforts

- <EFFORT-ID> – <Short title>
  - Status: planned | in-progress | done
  - Last change: YYYY-MM-DD
  - Notes: brief status/pending items.

## Entries

### YYYY-MM-DD

- <EFFORT-ID>
  - Short bullets summarizing what changed, with references to the implementation doc.

## End-of-Month Summary

### Completed Efforts / Tasks

- <EFFORT-ID>
  - Brief summary of outcomes and any notable deviations.

### Ongoing

- <EFFORT-ID>
  - What remains and why.

### Deprecated / Changed Direction

- <EFFORT-ID>
  - Why the effort was superseded or abandoned; link to successor effort(s) if any.

## Upcoming / New Efforts

- <EFFORT-ID> (planned)
  - Short description and planning doc link.
```

---

## 5. Workflow

### 5.1 When Starting a New Significant Effort

1. **In the planning doc** for the relevant area (frontend, backend, archive, etc.):
   - Define a short **Code** for the feature/core family (e.g. `PDR`).
   - Add an "Implementation Efforts" subsection listing one or more Effort IDs using that code.

2. **Create an Implementation Effort doc** under `docs/tasks/`:
   - Name the file `<EFFORT-ID>_<short-description>.md`.
   - Fill in header, intent, and an initial task list with `-Txx` IDs.

3. **Start using the Effort ID** in:
   - Commit messages (e.g. `RS-BE-FEAT-PDR-2601-01: ...`).
   - Branch names (optional).
   - JSDoc `@impl` tags and inline comments for non-trivial logic.

### 5.2 During Day-to-Day Work

- Update the **Tasks** section of the Effort doc as tasks are added/completed.
- Add dated entries to **Timeline, Decisions & Deviations** whenever:
  - A non-trivial decision is made.
  - Implementation deviates from planning.
  - External dependencies or blockers appear.
- At least weekly (ideally 2–3x per week):
  - Update the current month’s **journal** with a short entry for each active Effort ID touched that day.

### 5.3 End of Month

- For the current month’s journal (`docs/journal/YYYY-MM_Month.md`):
  - Fill in **Completed Efforts / Tasks** with outcomes.
  - List **Ongoing** efforts and what remains.
  - Document any **Deprecated / Changed Direction** efforts.
- If recurring patterns or problems are discovered (e.g. repeated ad-hoc patterns), create new Effort IDs (often `ARCH`/`CORE`/`MAINT`) and seed their planning + implementation docs.

---

## 6. Example: PDR (Partner Data Ready RS Pipeline)

- **Code**: `PDR` – Partner Data Ready → RS archive ingestion/backfill.
- **Planning doc**: `RS_ARCHIVE_BACKFILL.md` (Implementation Efforts section).
- **Backend Effort**: `RS-BE-FEAT-PDR-2601-01` – Partner data ingestion & initial prod RS archive backfill.
- **Implementation doc**: `docs/tasks/RS-BE-FEAT-PDR-2601-01_partner-ingestion-and-prod-backfill.md`.
- **Journal**: `docs/journal/2026-01_January.md` lists `RS-BE-FEAT-PDR-2601-01` under Current Implementation Efforts and includes dated entries.

This example is the first full application of this workflow and can be used as a reference pattern for future efforts (both backend and frontend).
