**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1163  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1347  
**Domain:** FE  
**Type:** INVENTORY  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-11-02  

# Element/Component Inventory + De-Materify Disposition Matrix

Component-level analog of the literal sweep's `ui-color-sites.json`.
The sweep themed color *values*; this inventory enumerates every
element *archetype* in use so #1163 can plan replacement/adoption by
family instead of page-by-page discovery.

## Method & artifact

- Scanner: `scripts/inventory-ui-elements.mjs` (re-runnable)
- Artifact: `docs/topics/1024-design-system/ui-element-sites.json`
  (per-site records with file:line for specimen lookup, plus
  per-archetype aggregates; zero-hit archetypes emitted explicitly)
- Live view: `/dev/ds-elements` (#1348) — one rendered specimen per
  archetype, grouped by the families below, labeled with counts +
  provenance. Serves as the phase-by-phase migration testbed.
- Scope: `src/app/**` (.html/.ts/.scss/.css, specs excluded,
  comments stripped, close-tags not counted)
- Result: **3,219 usages · 54 nonzero archetypes (66 declared) · 291
  files with usages** — refreshed 2026-10-30.
- Caveats: regex inventory — counts usages, not semantics; figures are
  order-of-magnitude for prioritization, not bookkeeping. Known
  exclusions: `native-button` skips ~85 `<button>`s already carrying
  DS widget classes (they count under §9 instead); `mat-icon` excludes
  `mat-icon-button` prefixes; `ds-pill-toggle` excludes `pill-btn`;
  family totals below **exclude sub-element matches** (`mat-option`,
  `mat-form-field-parts`) which are counted inside their parent rows.
  TS-side class-name coverage is partial; `rh-select-menu` includes
  its own component files (~5 hits); `filter-pill` classes count
  under `ds-pill-toggle` (pill family, correct bucket).

## Disposition matrix

### 1. Buttons — ~650 usages, biggest visible surface

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| mat-button | 59 | 28 | REPLACE → `ds-btn` |
| mat-stroked-button | 122 | 43 | REPLACE → `ds-btn--outline` |
| mat-flat-button | 55 | 33 | REPLACE → `ds-btn` |
| mat-raised-button | 15 | 10 | REPLACE → `ds-btn--primary` |
| native `<button>` (no mat-/ds-class) | 231 | 55 | REPLACE → `ds-btn` family |
| mat-icon-button | 105 | 45 | ADOPT → `ds.icon-btn` (exists) |
| mat-button-toggle | 63 | 16 | ADOPT → `ds.pill-toggle` (exists) |
| mat-fab / mini-fab | 0 | — | n/a |

**Needs:** a `ds-btn` spec — primary/secondary/outline/ghost/danger
roles, sizes, icon slots — **built in savant-ds (`_widgets.scss`)
under #1348**. The F3 systemic gap stands: header/login alone shows
4 different button treatments.

### 2. Forms — ~460 usages (excl. select path)

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| mat-form-field | 120 | 25 | REPLACE → `ds-field` (label, hint, error — built) |
| mat-form-field-parts (label/hint/error/suffix) | 163 | 33 | subsumed by `ds-field` |
| matInput | 90 | 22 | REPLACE → `ds-field` input |
| native `<input>` text/other | 88 | 27 | REPLACE → `ds-field` |
| native `<input type=checkbox>` | 23 | 8 | NEW → `ds-check` (built) |
| native `<input type=date…>` | 8 | 5 | feeds D5 |
| native `<input type=radio|file>` | 5+3 | 2+1 | NEW → `ds-radio` / keep native |
| native `<textarea>` | 7 | 6 | REPLACE → `ds-field` |
| mat-checkbox | 21 | 13 | NEW → `ds-check` (built) |
| mat-slide-toggle | 14 | 8 | NEW → `ds-switch` (built) |
| mat-radio | 6 | 2 | NEW → `ds-radio` (built) |
| mat-datepicker | 59 | 10 | DECISION → `ds-date` vs native `input[type=date]` (spread-builder range is the hard case) — `ds-date` chrome built |
| mat-autocomplete | 12 | 4 | NEW → `ds-combobox` (built) |
| mat-select + mat-option/optgroup | 46+70 | ~20 | DECISION → see D1 below |
| native `<select>` | 24 | 13 | DECISION → same D1 |

### 3. Overlays & popups — ~455 usages

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| MatDialog / mat-dialog-* / MatDialogRef | 222 | 71 | REPLACE → `ds-dialog` shell (built; backdrop/scrim + CDK integration at adoption time) |
| matTooltip | 142 | 46 | DECISION → `ds-tooltip` vs native `title=` (audit: most are short strings — title may suffice) — `ds-tooltip` built |
| mat-menu | 43 | 11 | NEW → `ds-menu` (built; `rh-select-menu` is internal precedent) |
| MatSnackBar | 48 | 23 | NEW → `ds-toast` (built) |
| MatBottomSheet | 0 | — | n/a |

### 4. Data display — ~210 usages (concentrated)

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| mat-table (+row/cell/colDef) | 155 | 7 | REPLACE → `ds-table` (`dense-table` accent precedent; only 7 files: spread-builder-dialog, tj-table, closed-grid, rs-table, ds-elements +2) |
| mat-chip | 33 | 6 | ADOPT → `ds.badge`/`pill` family |
| matSort / MatSort | 19 | 4 | REPLACE → `ds-table` sort contract |
| mat-paginator | 2 | 2 | REPLACE → `ds-table` pager or drop (check real pagination need) |

### 5. Layout & nav — ~135 usages

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| mat-expansion-panel/accordion | 34 | 9 | NEW → `ds-accordion` (built; positions open-grid + pct-change are the big users) |
| mat-tab | 31 | 7 | NEW → `ds-tabs` (built; portfolio, gallery-ticket, backtest-report, allocation) |
| mat-sidenav/drawer | 31 | 11 | KEEP-MATERIAL for now — app shell; revisit last (only structural Material piece; replacing needs a custom drawer+scrim) |
| mat-card | 22 | 7 | REPLACE → `ds-card` (built — was scoped under #1162) |
| mat-toolbar | 8 | 3 | ADOPT → `ds.toolbar-row` |
| mat-list/nav-list | 9 | 3 | DROP → plain markup |
| mat-divider | 0 | — | n/a (already borders) |

### 6. Icons — 495 usages

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| mat-icon element | 495 | 138 | DECISION → see D2. The font is Material-free; the *element* is not — every `<mat-icon>` pulls `MatIconModule` from `@angular/material/icon`. |

### 7. CDK primitives — ~28 usages

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| cdk-virtual-scroll | 15 | 5 | KEEP — behavioral primitive (heatmap perf) |
| cdk-drag-drop / cdk-text-field | 0 | — | n/a |
| cdk-overlay/portal | 13 | 2 | KEEP — ds-menu/tooltip will sit on CDK |

### 8. Third-party — KEEP domain

| Archetype | Uses | Files | Disposition |
|-----------|------|-------|-------------|
| syncfusion ejs-*/e-* | 61 | ~11 | KEEP — chart lib; literals tagged exceptions (visual contract, #1164 territory) |

### 9. Already-DS (adoption baseline)

| Archetype | Uses | Files |
|-----------|------|-------|
| ds-pill-toggle | 122 | 23 |
| ds-badge | 88 | 41 |
| ds-pill-btn | 42 | 15 |
| ds-icon-btn | 44 | 15 |
| rh-select-menu | 32 | 14 |
| ds-dir-edge | 13 | 8 |
| ds-toolbar-row | 9 | 6 |
| ds-nav-stepper | 6 | 6 |
| ds-toggle-chip / ds-field-input | 4+9 | 4+4 |

## Open decisions (surface at #1163 planning)

- **D1 — select path:** `mat-select` (46 uses + 70 option/optgroup
  children), 24 native selects, and 32 `rh-select-menu` uses coexist.
  PRD already deferred this. `rh-select-menu` is the in-house
  precedent — likely disposition is converge on it.
- **D2 — mat-icon disposition:** keeping the Material Icons *font*
  does not retire the `<mat-icon>` *component* — ~495 usages still
  require `MatIconModule`. The real options: (a) declare
  `MatIconModule` a de-materify *exception* and keep it; (b) sweep
  `<mat-icon>foo</mat-icon>` → `<span class="material-icons">foo</span>`
  — near-mechanical since Material Icons is a ligature font, drops the
  module entirely, needs one global glyph class + `aria-hidden` —
  i.e. the largest archetype is also the cheapest migration; (c) thin
  `ds-icon` wrapper if styling hooks are wanted. Recommend **(b)**:
  keep the font, drop the component.
- **D3 — tooltip policy:** `title=` for simple text vs `ds-tooltip`
  where rich/delayed. Audit the 142.
- **D4 — sidenav:** keep Material drawer (structural) vs ds-shell —
  do last, it's the app shell not a widget.
- **D5 — datepicker:** `ds-date` chrome vs native `input[type=date]`;
  spread-builder date-range is the constraint.

## Proposed phase order (becomes #1163 blueprint skeleton)

| Phase | Family | Size | Why first/last |
|-------|--------|------|----------------|
| A | Buttons | ~650 | biggest visible surface; `ds-btn` already built under #1348 |
| B | Overlays | ~455 | ds-dialog/menu/tooltip/toast built; dialog pattern unblocks the other three |
| C | Forms | ~460 | high density; ds-field/check/radio/switch/combobox built |
| D | Select (D1-gated) | ~140 | decision first — convergence, not just migration |
| E | Data display | ~210 | concentrated — 7 table files |
| F | Layout | ~135 | ds-accordion/tabs/card/toolbar-row |
| G | Feedback | ~60 | spinner/progress — small widgets |
| H | Shell + icons | ~525 | app shell last; icon phase gated on D2 (sweep → near-mechanical ~495, keep-exception → phase shrinks to ~30) |

Total Material/native retire-scope ≈ **2,100 usages** (A–G sums to
2,110; sidenav's 31 sits inside phase-F's 135 but is D4-gated —
excluding it reads 2,079; mat-icon's 495 additionally excluded
pending D2).
