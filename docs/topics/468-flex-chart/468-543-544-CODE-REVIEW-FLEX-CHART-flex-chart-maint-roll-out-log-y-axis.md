# CODE REVIEW — Task #544: Shared: FlexChartComponent default logScale + ChartToolbarComponent log toggle

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Roll log y-axis scale to all consumers  
**Thread Slug:** roll-out-log-y-axis  
**Issue:** #543 (FE Blueprint)  
**Task:** #544  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-23  
**Last Updated:** 2026-09-23  

## Summary

Implemented the shared-layer rollout foundation: `FlexChartComponent` now
defaults `logScale` to `true` while still allowing parent opt-out, and
`ChartToolbarComponent` exposes a reusable `logScale` input and
`logScaleToggle` output with a Yes/No button.

## Standards axis

- `effectiveConfig` merge order correctly lets explicit `logScale: false`
  override the default (`logScale: this.config().logScale ?? true`).
- New specs follow existing project conventions: `componentRef.setInput`,
  `jest.spyOn` on outputs, `NO_ERRORS_SCHEMA` for child components.
- No duplication, dead code, or security issues introduced.
- Sync overlay template binding was aligned with `effectiveConfig()` so all
  log/linear reads use the same defaulted value.

## Spec axis

PRD acceptance criteria coverage:

| Criterion | Status |
|---|---|
| US-1 — log axis on by default | Met: `effectiveConfig()` defaults `logScale` to `true`; spec asserts this and the observable axis effect. |
| US-1 — parent can opt out to linear | Met: explicit `logScale: false` wins. |
| US-2 — toolbar toggle | Met: `ChartToolbarComponent` renders Yes/No state and emits `logScaleToggle`. |
| US-3 — overlays/tooltips/crosshairs stay correct | Met by reusing existing transform seam; fixed the sync-overlay binding to read `effectiveConfig().logScale`. |
| US-4 — staged rollout with per-task specs | Shared-layer spec added; consumer tasks remain separate. |

## Thermo-nuclear axis

- `effectiveConfig` as a single derived computed is the right seam vs.
  threading a defaulted input through every consumer.
- Tests assert external axis behavior (gridline width in log mode), not
  only the internal computed value.
- Toolbar output is independent of other toolbar controls.

## Findings

### Resolved during review

| Severity | Finding | Resolution |
|---|---|---|
| Critical | Sync overlay was bound to raw `config().logScale` instead of `effectiveConfig().logScale`, causing linear math on a log chart for default-on consumers. | Fixed in `flex-chart.component.html` line 311. |
| Major | `effectiveConfig` spread could copy an explicit `logScale: undefined` over the default. | Changed to `this.config().logScale ?? true`. |
| Minor | No test covered the `undefined` edge case. | Added explicit `undefined` spec. |
| Minor | No test asserted an observable downstream effect of the default. | Added `primaryYAxis().majorGridLines.width` assertions. |

### Advisory (non-blocking)

| Severity | Finding | Notes |
|---|---|---|
| Nit | `ChartToolbarComponent.logScale` defaults to `false` while `FlexChartComponent` defaults to `true`; a standalone toolbar without a binding will disagree with its chart. | Acceptable for the shared-layer task; every planned consumer binds the same page-level signal. Could be hardened to `input.required<boolean>()` in a follow-up if desired. |
| Nit | Toolbar tooltip describes state rather than action. | Cosmetic; existing buttons vary. |

## Test results

- `npx jest src/app/features/shared/components/flex-chart/flex-chart.component.spec.ts`
  + `chart-toolbar.component.spec.ts` — **6 passed**
- `npx jest --coverage=false` (full suite) — **129 suites, 1761 tests passed**
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `ng build --configuration development` — clean

## Verdict

**PASS**

Ready for QA. Run `/proj qa 468 544` to perform the manual checklist before
shipping.
