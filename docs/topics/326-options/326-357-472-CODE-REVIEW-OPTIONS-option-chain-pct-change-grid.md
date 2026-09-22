**Topic:** Option chain percent change grid  
**Topic Slug:** option-chain-pct-change-grid  
**Thread:** Misc fixes for option pct change grid  
**Thread Slug:** misc-fixes-pct-change  
**Issue:** #357  
**Thread Parent:** #357  
**Topic Parent:** #326  
**Task:** #472  
**Domain:** OPTIONS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-21  
**Last Updated:** 2026-09-21  

---

# Code Review — #472: Lift swing-compare entry to sidebar top; collapse manual controls

## Scope

`option-chain-pct-change.component.ts` + spec. The Swing Compare expando
was replaced by a top-level `.swing-compare-entry` block (frame summary +
Pick frame swing button, or the no-saved-analyses empty state), a
`.panel-divider` `<hr>`, and a collapsed-by-default "Manual run"
`mat-expansion-panel` wrapping all previous manual controls (saved config,
symbol/date, type toggle, Target Dates and Filters expandos, Run/Reset).

## Standards

- **Minor (fixed):** inner template content was flush-indented under the
  new outer expando — re-indented the whole nested block +2 so the DOM
  depth is visible.
- **Minor (noted):** file is 669 lines — over the >400 documented-reason
  smell threshold. Pre-existing; the ~175-line sidebar form is a
  candidate for extraction, deferred.
- **Nit (fixed):** spec asserted Material-internal `mat-expanded` class;
  now asserts `manualExpanded()` directly.

## Spec

All five acceptance criteria met: entry at sidebar top outside expandos
(spec asserts `closest('mat-expansion-panel') === null`), divider present
and ordered entry → divider → manual panel (compareDocumentPosition),
manual controls collapsed by default, all manual bindings preserved,
collapsed-rail mode covered by the existing `> :not(.panel-toolbar)` rule.

## Thermo-nuclear

- **Major (fixed):** the `resolveNonce` effect reopened the Target Dates
  inner panel inside the now-collapsed outer panel — invisible state
  churn. Effect now guards the initial run (`nonce === 0`) and opens
  `manualExpanded` too, so a config resolve is actually visible.
- **Minor (noted):** three disclosure levels deep in the sidebar is
  heavy; acceptable for a secondary path.
- **Nit (deferred):** `[expanded]`/`(opened)`/`(closed)` is the verbose
  equivalent of `[(expanded)]` — pre-existing pattern, kept consistent.
- **Info (fixed):** header docstring updated to describe the new layout.

## Test results

341/341 option-chain-pct-change tests green; `tsc --noEmit` clean on
`tsconfig.app.json` and `tsconfig.spec.json`.

## Verdict

**PASS** — one major finding (invisible `resolveNonce` reopen) found and
fixed with a test; minors/nits fixed or noted as non-blocking.
