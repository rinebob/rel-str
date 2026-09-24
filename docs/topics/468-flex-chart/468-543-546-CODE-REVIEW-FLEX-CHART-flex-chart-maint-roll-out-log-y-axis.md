# CODE REVIEW — Task #546: Wire log Y-axis toggle into swing-analysis-page

**Topic:** Flex Chart Maintenance  
**Topic Slug:** flex-chart-maint  
**Thread:** Roll log y-axis scale to all consumers  
**Thread Slug:** roll-out-log-y-axis  
**Issue:** #543 (FE Blueprint)  
**Task:** #546  
**Topic Parent:** #468  
**Domain:** FLEX-CHART  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-24  
**Last Updated:** 2026-09-24  

## Summary

Wired the swing-analysis page into the shared log-scale rollout. The page
owns a `logScale = signal(true)` and a "Log Y-axis Yes/No" pill in the
header actions; `chartConfig` threads the signal into the single
FlexChart instance.

**Scope note:** both touched files also contain unrelated in-progress user
work (CompanyInfoStripComponent, symbol picker, nav filter updates). Only
the log-pill hunks were reviewed. Ship-time staging must use partial-file
staging — several hunks are interleaved.

## Standards axis

- Pill markup/styles match the established `.qcp-log-pill` pattern from
  quick-charts; `matTooltip` usage matches the sibling buttons in this
  header.
- `signal` merged into the existing `@angular/core` import; `update`
  idiom used.
- `chartConfig` reads `this.logScale()` so toggling recomputes the config
  and the lifecycle facade's `lastLogScale` guard rebuilds the axis.
- Spec follows the file's existing conventions: mock `app-flex-chart`,
  `data-testid` queries, assertions on the bound `config` input.

## Spec axis

| Criterion | Status |
|---|---|
| Page-level `logScale` signal, session-only, default true | Met |
| Visible Yes/No pill toggle | Met — `data-testid="log-pill"` in `.header-actions` |
| Chart-level change only; shared transform untouched | Met |
| Spec covers default-on + toggle propagation | Met — asserts `config.logScale` on the mocked chart, round-trip both directions |

## Thermo-nuclear axis

- Single-chart page seam is correct — one signal, one config computed, no
  store involvement, no persistence.
- Spec exercises real DOM click → bound config input, not internals.
- Round-trip assertion added during review so the symmetric path is covered.

## Findings

### Resolved during review

| Severity | Finding | Resolution |
|---|---|---|
| Nit | Spec only exercised on→off, not the return path. | Added second click asserting `logScale` returns to `true` and label returns to Yes. |

### Advisory (non-blocking)

| Severity | Finding | Notes |
|---|---|---|
| Minor | The "Log Y-axis Yes/No" pill is now duplicated in three places (`chart-toolbar`, `quick-charts-panel`, `swing-analysis-page`). | The IMPL doc prescribed per-page pills, so this is not a defect. Recommend a follow-up task to extract a shared `LogScalePillComponent` or shared `.st-log-pill` styles if a fourth surface appears. |
| Nit | Pill lacks `aria-pressed` and a `:focus-visible` indicator. | Same gap exists in all three copies; fix together if the pill is extracted. |
| Nit | `logScale` resets to `true` on every page visit (session-only). | Consistent with PRD — flagging in case persistence is ever wanted. |

## Test results

- `npx jest src/app/features/savant-trader/swing-analysis/swing-analysis-page.component.spec.ts` — **84 tests passed**
- `npx jest --coverage=false` (full suite) — **131 suites, 1773 tests passed**
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `ng build --configuration development` — clean (via dev-server watch rebuild)

## Verdict

**PASS**

Ready for QA. Run `/proj qa 468 546` to perform the manual checklist before
shipping. When shipping, use partial-file staging: the component and spec
files contain unrelated in-progress user changes that must not be committed.
