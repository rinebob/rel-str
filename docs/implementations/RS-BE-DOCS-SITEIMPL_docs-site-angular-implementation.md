# RS-BE-DOCS-SITEIMPL Docs Site Angular Implementation

- **Status**: planned
- **Planning doc(s)**:
  - IMPLEMENTATION_EFFORTS_AND_JOURNALING.md (docs workflow and IDs)
  - ROADMAP.md (future work / ideas)
- **Area**: BE
- **Scope**: DOCS
- **Code**: SITEIMPL
- **Created**: 2026-01-25
- **Last updated**: 2026-01-25

## Intent

Design and implement a documentation website for the RS project, powered by an Angular-based docs app. The site should render markdown from the repo, provide navigation across planning and implementation docs, and support both public (user-facing) and internal/dev-only sections. This effort is planning/implementation-focused and will be activated when we prioritize docs site work from the roadmap.

## Tasks

- [ ] RS-BE-DOCS-SITEIMPL-T01 – Decide on hosting model and security boundaries (public vs internal sections, Firebase Hosting targets, auth requirements).
- [ ] RS-BE-DOCS-SITEIMPL-T02 – Define folder structure and build pipeline for the Angular docs app (including how markdown content is loaded).
- [ ] RS-BE-DOCS-SITEIMPL-T03 – Design initial IA/navigation for the docs site (Planning, Implementations, Partner, Roadmap, Tech Debt, etc.).
- [ ] RS-BE-DOCS-SITEIMPL-T04 – Plan integration with ROADMAP and future Tech Debt tracking docs (e.g., dedicated views or filters).
- [ ] RS-BE-DOCS-SITEIMPL-T05 – Define rollout plan (MVP scope, internal-only trial, then public sections).

## Timeline, Decisions & Deviations

### 2026-01-25

- **Status**:
  - Effort defined as a long-lived 4-segment backend DOCS effort (`RS-BE-DOCS-SITEIMPL`).
  - Tasks currently focus on design/planning; no implementation work has started.
- **Decisions**:
  - Prefer an Angular-based docs app (Option B) over standalone static-site generators, to stay aligned with the existing tech stack.
- **Deviations from planning**:
  - None yet.

## Implementation References

- **Key docs**:
  - `docs/planning/IMPLEMENTATION_EFFORTS_AND_JOURNALING.md`
  - `docs/planning/ROADMAP.md`
- **Future code**:
  - Angular docs app (to be defined under `src/app/...` when this effort is activated).
- **Hosting**:
  - To be defined (likely additional Firebase Hosting site/target for docs).
