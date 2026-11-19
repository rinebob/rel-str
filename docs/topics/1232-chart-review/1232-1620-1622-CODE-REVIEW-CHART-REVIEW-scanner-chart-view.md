**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Bar-Count Range Pills  
**Thread Slug:** bar-count-range-pills  
**Issue:** #1620  
**Thread Parent:** #1616  
**Topic Parent:** #1232  
**Task:** #1622  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — FE-IMPL: Per-chart range state (#1622)

Scope: `ChartRange` union (`'25'|'50'|'100'` in, `'recent'` out), `ChartToolbarStateService.rangesByInterval`/`activeRange`/`setRange`, `signal-detail` `rangeBarsFor` + per-chart computeds, template binding rewires (forced `Recent` removal), service + signal-detail + toolbar specs. Review diff pre-scoped to the task's 10 files; unrelated working-tree changes excluded.

## First pass complete

Three parallel axes ran:

### Standards

- Judgment call → **major**: `setRange`/`activeRange` keyed `activeChartInterval` for both layouts, but single mode renders `selectedInterval` — desync after triple-cell-click → layout toggle (see Spec).
- Dead union members `'25'|'50'|'100'` until Task #1623 — sanctioned by staged IMPL; consequence: no `.active` pill at defaults.
- Minor: spec-local mocks use signal `input()`/`output()` vs AGENTS.md decorator convention — pre-existing file convention, works via `overrideComponent`.
- Documented/accepted: mirrored pill markup in both toolbars (IMPL decision), `Number(range)` parse (IMPL decision).
- Clean: no SDK calls, `'recent'` fully removed, `TWO_DAY` slot + `selectedIdsByInterval` precedent followed, no stale docblock claims.

### Spec

- **US-3 violated**: PRD line 114 — "`setRange` writes `selectedInterval` in single mode" — implementation wrote `activeChartInterval` unconditionally. Reachable wrong-chart write: triple → click monthly cell → toggle single → pills highlight/write monthly while daily renders.
- US-7 parity caveat: hidden `chart-toolbar` input now receives numeric ranges with no matching pill until #1623 — hard ordering dependency.
- Test-plan coverage: service spec targets all covered; `'5y'` pin initially missing.
- Mock fidelity: `input<string>` vs real `input.required<ChartRange>` — pre-existing drift.

### Thermo-nuclear

- **Major** (same finding): divergent active-range keys; recommended `layout === SINGLE ? selectedInterval : activeChartInterval` + spec.
- Minor: numeric members UI-unreachable (same ordering caveat); spec mock type-erasure.
- Nits: `rangeFor` vs alias precedent; public writable signals (`asReadonly` suggestion — pre-existing design, out of scope).
- Praised: `Number()`+`isNaN` is the clean parse; map mirrors `selectedIdsByInterval`; specs assert external behavior.

## Remediation (same review — finding was small and PRD-unambiguous)

- `activeRangeKey` computed added: `chartLayout === SINGLE ? selectedInterval : activeChartInterval` → `chartIntervalKey` — `activeRange` and `setRange` both key off it. New spec pins the exact desync scenario (triple cell click → single toggle → pills follow `selectedInterval`).
- `'5y'` added to the calendar-preset spec — every union member now pinned (`'25'`, `'50'`, `'100'`, `'6m'`, `'1y'`, `'5y'`, `'all'`→99999).

## Second pass complete

Re-checked every hunk of the final diff (including remediation) against all three axes: full coverage — no unreviewed lines, no unexamined error paths (`Number('all')`→NaN→`default`→`ALL_BARS_MAX`; `TWO_DAY` slot inert). Remaining open findings are sanctioned ordering items (no `.active` pill at default until #1623) or pre-existing convention drift (mock decorators, writable signals) — none critical/major.

## Convergence: PASS

Major finding remediated and spec-pinned; remaining items are documented, sanctioned, or out-of-scope. No further passes needed.

## Test results

`npx jest chart-toolbar-state signal-detail chart-view-toolbar chart-toolbar --coverage=false` — 61 tests green. `npx jest --coverage=false` full suite — 324 suites / 6100 tests green. `npx tsc --noEmit` — zero errors in touched files (pre-existing errors in `scripts/bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts` are unrelated to this task's tree).

## Verdict: PASS

No critical or major findings remain on the final diff.
