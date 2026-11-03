**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1381  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1347  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-30  
**Last Updated:** 2026-11-02  

# UAT — #1347: element/component inventory + disposition matrix

## Scope

Deliverables: `scripts/inventory-ui-elements.mjs` (re-runnable
scanner), `docs/topics/1024-design-system/ui-element-sites.json`
(artifact: per-site records with file:line + per-archetype aggregates),
`docs/topics/1024-design-system/1024-1163-ELEMENT-INVENTORY.md`
(disposition matrix + phase order + D1–D5 decisions).

This task is documentation/tooling — no user-facing surface.

## Prerequisites

- Repo at the working tree containing #1347/#1348 changes (the
  scanner covers `src/app/**`, including `ds-elements/`).
- Node.js available (any modern version; script uses only `node:fs`,
  `node:path`).

## Scenarios

### S1 — Scanner is re-runnable and deterministic

1. From repo root: `node scripts/inventory-ui-elements.mjs`
2. Expected: console line
   `3,219 usages · 54/66 archetypes · 291 files → docs/topics/1024-design-system/ui-element-sites.json`
3. `git status` on the JSON shows no diff (byte-deterministic output).
4. Result: PASS — output matched exactly; no diff on regenerated file.

### S2 — Artifact structure

1. Open `ui-element-sites.json`.
2. Expected top-level keys: `scope`, `limitations`, `summary`,
   `archetypes`, `sites`.
3. `summary` reports `usages: 3219`, `archetypes: 54`,
   `archetypesDeclared: 66`, `filesWithUsages: 291`.
4. `archetypes` contains zero-hit entries (mat-fab, mat-slider,
   mat-tree, MatBottomSheet, cdk-drag-drop, …) with `total: 0`.
5. `sites` records carry `file`, `line`, `archetype`, `count`.
6. Result: PASS — all keys present; 12 zero-hit archetypes emitted;
   sites carry line numbers.

### S3 — Site records resolve to real usages

1. Pick a site record, e.g.
   `src/app/core/comps/header/header.component.html:5` (mat-icon).
2. Open the file at that line.
3. Expected: the line contains the archetype (`<mat-icon>menu</mat-icon>`).
4. Repeat for 2–3 other records across different archetypes.
5. Result: PASS — header.component.html:5 = `<mat-icon>menu</mat-icon>`
   (verified); new-trade.dialog.html sites extend through line 209.

### S4 — Doc ↔ artifact consistency

1. In `1024-1163-ELEMENT-INVENTORY.md`, check headline numbers and
   each table row against `archetypes` totals/files in the JSON.
2. Expected: all row counts match; family totals reconcile
   (Buttons 650, Forms ~460, Overlays 455, Data ~210, Layout 135,
   Feedback ~60, Select 140, Icons 495, Shell+Icons ~525).
3. Result: PASS — verified in review pass 3 (rows ↔ JSON exact;
   A–G = 2,110; retire-scope footnote clarified).

### S5 — Disposition completeness (AC2)

1. Every nonzero archetype in the JSON appears in the matrix with a
   disposition (REPLACE / ADOPT / NEW / KEEP / DECISION / DROP).
2. Result: PASS — all 54 nonzero archetypes dispositioned (review
   pass 1 + spot checks).

### S6 — High-impact order + blueprint readiness (AC3/AC4)

1. §"Proposed phase order" lists phases A–H with sizes and rationale.
2. D1–D5 decisions are enumerated as separate calls, not hidden.
3. Result: PASS — phase table present; decisions D1 (select), D2
   (icon), D3 (tooltip), D4 (sidenav), D5 (datepicker) isolated.

## Traceability

| AC | Scenario |
|----|----------|
| Every mat-*/ejs-*/ds-widget/styled-native usage enumerated w/ file refs | S1–S3 |
| Each archetype carries disposition + proposed DS path | S5 |
| Matrix identifies high-impact order | S6 |
| Findings become blueprint phases under #1163 | S6 |

## Regression / smoke

- [x] Full jest suite green (287/4954 — from review; script + docs
      only, nothing jest-visible changed since).
- [x] `dev/ds-elements` page unaffected (scanner is read-only; page
      loads unchanged — verified during #1348 work).
- [x] No source-file modifications made by the scanner (read-only +
      single JSON write).

## Refinement pass

Not applicable — no user-facing surface (scanner + JSON + doc).
The live `/dev/ds-elements` view is #1348's QA surface.
