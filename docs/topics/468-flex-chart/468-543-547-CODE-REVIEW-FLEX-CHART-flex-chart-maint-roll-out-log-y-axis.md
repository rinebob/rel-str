# CODE REVIEW — Task #547: Wire log Y-axis toggle into signal-detail

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Roll log y-axis scale to all consumers  
**Thread Slug:** roll-out-log-y-axis  
**Issue:** #543 (FE Blueprint)  
**Task:** #547  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** PASS  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

## Summary

signal-detail already carried all the wiring — `[logScale]` bound on the
chart toolbar, `(logScaleToggle)` → `onToggleLogScale()`, and `logScale`
threaded into the single-mode `chartConfig` and all three triple-mode
configs. The task was the default: `signal<boolean>(false)` was
explicitly overriding the shared log default to linear. Flipped to `true`
and added the component's first-ever spec, covering default-true,
toolbar-sync, page-toggle round-trip, and single-mode.

## Standards axis

- Spec follows the quick-charts mock-component pattern exactly:
  standalone mocks with signal `input`/`output`, `overrideComponent`
  remove/add, `By.directive` queries, `jest.fn()` provider mocks. No
  `any`.
- Component change is a single default flip plus an accurate docstring —
  nothing else needed because the wiring pre-existed.
- Toolbar renders the pill bound to the page signal, so the "Log Y-axis"
  state is consistent from first change detection.

## Spec axis

| TEST doc criterion | Status |
|---|---|
| default-true — all three timeframes receive `logScale: true` | Met — asserts bound `config.logScale` on all three mocked `app-flex-chart` instances in triple mode |
| toolbar-sync — toolbar displays the page-level state | Met — asserts `toolbar().logScale() === true` after binding; note the page has ONE toolbar governing all charts (doc said "all three toolbars" — degenerate criterion, satisfied trivially) |
| page-toggle — toggling flips all three charts | Met — emit `logScaleToggle` → all three configs `false` + toolbar `false`; round-trip back to `true` |

## Thermo-nuclear axis

- Correct seam: the flip removes the only consumer still overriding the
  shared default — the app is now uniformly log-on.
- Downstream axis rebuild handled by the lifecycle facade's
  `lastLogScale` guard — verified, no changes needed.
- Session-scoped signal, no persistence — consistent with PRD.
- No-symbol state hides the toolbar entirely (`@if (showChart())`) — no
  affordance to toggle when nothing is rendered.

## Findings

### Resolved during review

| Severity | Finding | Resolution |
|---|---|---|
| Low | Single-mode test called `component.onToggleLogScale()` directly instead of exercising the template binding. | Changed to `toolbar().logScaleToggle.emit()` — same external path as the triple-mode test. |
| Low | Shared module-level `mockUiState.chartLayout` mutated to SINGLE by the last test and never reset. | `beforeEach` now resets it to `TRIPLE` with a comment explaining why. |

### Advisory (non-blocking)

| Severity | Finding | Notes |
|---|---|---|
| Minor | `ChartToolbarComponent.logScale` input still defaults to `false` — a future host that forgets the binding would show "No" while charts are log. | Dead default today (signal-detail always binds it). Flip to `true` in a follow-up, ideally alongside the shared `LogScalePillComponent` extraction — the Yes/No pill now exists in three places. |
| Nit | No test for toggling mid-layout-switch or during `chartLoading`. | The shared signal makes both trivially correct; noted for completeness. |
| Nit | Mock input types are looser than the real component's (`unknown`/`string` vs `FlexChartDataset`/union). | Cosmetic — mock surface is compile-checked by the bindings themselves. |

## Test results

- `npx jest src/app/features/savant-trader/components/signal-detail/signal-detail.component.spec.ts` — **4 tests passed**
- `npx jest --coverage=false` (full suite) — **132 suites, 1780 tests passed**
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `npx tsc --noEmit -p tsconfig.spec.json` — clean

## Second pass

A full three-axis re-review ran after the findings were fixed. All axes
verified both fixes (external emit path in the single-mode test,
`chartLayout` reset in `beforeEach`) and confirmed no regressions.
Remaining observations are informational only: mock input types are
looser than the real component's, `component` is assigned but unused,
and the TEST doc's "all three toolbars" wording is stale — the page has
one toolbar governing all charts.

## Verdict

**PASS**

Ready for QA. Run `/proj qa 468 547` — manual check: chart-review /
signal-detail should render "Log Y-axis Yes" in the toolbar and all
charts in log scale; clicking the pill flips all charts to linear.
