# Code Review — #590 FE Positions tab + assign-bucket dialog

**Status:** Complete — PASS (2 rounds)
**Topic:** Portfolio Allocation (#576)
**Blueprint:** #582 (FE)
**Task:** #590
**Date:** 2026-09-28

## Scope

- `src/app/features/portfolio-dashboard/allocation-positions-table.component.ts` (+spec) — NEW
- `src/app/features/portfolio-dashboard/allocation-assign-dialog.component.ts` (+spec) — NEW
- `src/app/features/portfolio-dashboard/allocation-page.component.ts` — Positions subtab wiring
- `src/app/features/portfolio-dashboard/allocation.types.ts` — `unresolved` flag
- `src/app/features/portfolio-dashboard/allocation.store.ts` — unresolved derivation

## Round 1 (3-axis)

### Standards — mostly consistent with the #589 dialog pattern

- Dialog owns the write, pending spinner, inline error, closes only on
  success — matches the shipped bucket-dialog convention.
- LOW: plain-field `selected` + ngModel (precedented repo-wide; sibling
  dialog uses signals — acceptable), `*ngFor` inside the radio group
  (lone `NgFor` in the feature), missing `aria-label` on `mat-radio-group`.
- MEDIUM (verify): `instrumentId + '_' + $index` track key implied
  duplicate instrumentIds, which would collide testids — resolved by
  dropping `$index` (instrumentId is unique per row via
  `attrByInstrument`).

### Spec — all ACs PASS

- Row shows bucket or Unassigned; assign/move writes AttributionEvent and
  watch stream re-derives `positionsRows` (in-place update); ACTIVE-only
  picker; linkKey fanned to group; no agentic gating.
- LOW: Unassigned filter predicate `bucketId === null` disagreed with the
  header/pseudo-row "dangling = unassigned" semantics — a 'Unknown bucket'
  row was counted in `unassignedExposure` but hidden by the filter.

### Thermo — 1 MED

- Same dangling-attribution divergence (independent confirmation), plus
  LOW nits: `$index` defeats DOM reuse; `mat-mdc-radio-checked` spec
  assertion couples to Material internals.

## Round 2 fixes

- **`PositionRow.unresolved`** — store flags dangling attributions;
  table's Unassigned filter/count predicates now match
  `unassignedExposure` exactly. Dangling rows still render 'Unknown
  bucket' in All (data-issue surfacing kept).
- Track key → `row.position.instrumentId` (stable testids, DOM reuse).
- `*ngFor` → `@for`; `aria-label="Assign to bucket"`; confirm button
  reads Move when editing an attributed row.
- Specs: preselect asserted via `componentInstance.selected`; link-note
  via testid; new dangling-row filter test + `currentBucketId`
  passthrough assertion; no-linkKey note absence.

## Verdict

**PASS** — 312/312 portfolio-dashboard specs green.

## Post-review addition (user request during QA)

Bulk assign landed after the review pass — scope added, not reviewed
as a finding: row checkboxes + select-all (scoped to the filtered view),
"Actions ▸" menu (Assign to bucket… / Unassign), dialog extended to
`items[]` (per-item linkKey preserved for group atomicity, no preselect
on mixed selections), sequential store writes
(`assignPositions`/`unassignPositions`). Covered by 6 new specs —
dialog bulk items forwarding + no-preselect, table selection bar,
select-all-under-filter, bulk dialog payload, bulk unassign clear.
