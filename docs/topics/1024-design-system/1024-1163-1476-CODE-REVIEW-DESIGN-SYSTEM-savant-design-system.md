**Topic:** Savant Design System  
**Topic Slug:** design-system  
**Thread:** Savant Design System  
**Thread Slug:** savant-design-system  
**Issue:** #1480  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1476  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-13  
**Last Updated:** 2026-11-13  

# Code Review — #1476: Run-controls toolbar dedup — .pill-btn → dse-chip, .filter-input shared chrome

## Verdict: PASS

Small diff — 7 files (+35/−72): markup swaps in two run-control
toolbars, one new `input.dse-input` element-form in `styles.scss`, both
duplicated SCSS blocks deleted, one new spec file (the component had
zero coverage), replay spec selectors updated.

## Axis results

- **Standards — PASS.** Zero hard violations. Reuse confirmed:
  `input.dse-input` emits the existing `ds-input-chrome` mixin;
  `.dse-chip` (`toggle-chip`) already emitted globally. New spec follows
  repo conventions (jest.fn/expect, awaited TestBed, real typed inputs).
  Soft findings applied in-cycle: replay spec gained a `dse-input
  compact` pin; the two `.compact` selectors were grouped into one rule
  so the 24px/11px dimensions stay synchronized.
- **Spec — PASS.** Every issue-#1476 requirement verified with
  file:line evidence: all pill sites → `dse-chip`, all text inputs →
  `filter-input dse-input compact`, both local blocks deleted,
  `aria-pressed`/`role="group"`/`aria-label` bindings intact,
  `clear-filters-btn`/`symbol-input`/etc. hook classes preserved, and
  the *other* `ds.pill-btn` mixin (the micro action pill — different
  thing) correctly untouched.
- **Thermo-nuclear — acceptable-with-notes.** Specificity math
  verified: `.filter-group .filter-input` (0,2,0) beats
  `input.dse-input`'s `width:100%` (0,1,1); `.compact` (0,2,1) beats the
  base field height. Seam choice correct — `input.dse-input` mirrors
  `select.dse-select` precedent; the `.dse-field` wrapper would force
  `<label>` restructuring for a bare sizing case.

## Fixes applied in-cycle

- Grouped `select.dse-select.compact, input.dse-input.compact` into one
  rule (dimension sync).
- Replay spec: added `dse-input compact` regression pin.
- styles.scss: documented `dse-input` is text-like inputs only.

## Deferred findings (not blocking)

- **Third `.pill-btn` copy survives** in
  `run-control-card.component.scss` — the fossil the thermo-nuclear
  flagged. It only serves `run-dashboard` (deprecated Signals surface,
  per user direction /signals pages are skipped), so migration is
  low-value; if that page revives, do the same swap there.
- **`.pill-group` name mismatch** — the global `.pill-group` emits
  `savant-ds.pill-toggle` whose child selector is `.pill`; children are
  `.dse-chip`, so only the bordered-box chrome applies. Pre-existing,
  unchanged by this diff; a `.chip-group` rename is a cosmetic follow-up.
- **~80 lines of layout SCSS still near-verbatim duplicated** between
  the two stylesheets (`run-control-card`/`filter-group`/`filter-label`/
  `sort-*`) — the real fix is a shared mixin/partial; flagged as a
  possible separate consolidation task.
- **Mixed token families in the toolbar row** — `dse-input` reads
  `--ds-*` (accent-glow focus) while chips/labels still read `--mat-sys-*`.
  Expected transitional state; QA should eyeball the seam.

## Tests

`npx jest src/app/features/savant-trader/backtest/components/` —
7 suites, **70/70 green** (incl. new 4-spec backtest-run-control file and
the added replay `dse-input` pin). `npx sass src/styles.scss` compiles
clean; `input.dse-input` verified in emitted CSS.
