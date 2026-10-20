# Implementation Plan — FE: widget consumption + gallery

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1104  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

## 1. Scope

Bring the `savant-ds` widget mixins into SavantTrader: vendor the updated
package, extend `/dev/ds` with a Widgets section (canonical markup
contract), migrate the surveyed consumers off their local CSS, and pin
the contract with a verify relay. SavantApi gets the vendored copy via
its `sync:ds` but has no widget migrations in this thread.

## 2. File changes

### Package consumption

| File | Change |
|---|---|
| `vendor/savant-ds/styles/_widgets.scss`, `_index.scss` | via `npm run sync:ds` |
| `av-proxy-api/vendor/savant-ds/…` | via `av-proxy-api` `sync:ds` |
| `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss` | **no edit** — `@forward 'index'` picks up `_widgets.scss` automatically |

### Gallery — `src/app/features/ds-gallery/`

| File | Change |
|---|---|
| `ds-gallery.component.html` | NEW Widgets section — 9 demo cards, one per mixin, canonical markup |
| `ds-gallery.component.scss` | demo styles consuming `vl.*` mixins |
| `ds-gallery.component.ts` | demo state only (active pill/chip indices for the toggles) |

The Widgets section follows the existing card convention: visual demo +
`seen in:` provenance footer (the canonical source files, not the
migrated ones).

### Migrations — local CSS replaced by `@include vl.<mixin>`

| File | Mixins applied | Deleted local CSS |
|---|---|---|
| `signal-filter-pills.component.scss` | `pill-toggle` | `.pill-group`, `.pill` block (~50 lines) |
| `chart-toolbar.component.scss` | `toolbar-row`, `icon-btn`, `pill-toggle`, `nav-stepper` | `.chart-toolbar` chrome, `.toolbar-icon-btn`, `.interval-toggle`/`.range-toggle` + btn rules, `.symbol-nav` block |
| `signal-review-header.component.scss` | `toolbar-row`, `pill-btn`, `badge` (tf/count/dir) | `.gr-header` chrome, `.pill-btn`+`.pill-count`, `.gr-count`/`.dir-count` literals |
| `review-header.component.scss` | `toolbar-row`, `icon-btn`, `field-input`, `toggle-chip`, `pill-btn` | `.review-header` chrome, `.back-btn`/`.history-btn`, `.header-filter` block, `.strategy-btn`, `.pill-btn` |
| `signal-table.component.scss` | `badge`, `dir-edge` | `.dir-badge` variants, `tr.long`/`tr.short` literals (`#4caf50`/`#f44336` gone) |
| `group-panel.component.scss` | `icon-btn`, `badge` | `.expand-all-btn`, `.signal-badge` |

Markup touched only where the canonical class contract requires it
(e.g. `tr.long` → `tr.dir-edge-long`, `.dir-count` → `.badge dir-long`).

### Verification + docs

| File | Change |
|---|---|
| `scripts/verify/design-system-widgets-<task>.ts` + `.md` | NEW — contract relay |
| `scripts/verify/run-all.ts`, `README.md` | register relay |
| `1024-1025-DS-INVENTORY.md` | candidate rows → Extracted |

### Relay checks

- `_widgets.scss` exists in `savant-ds` and both vendored copies are byte-identical to it
- `_index.scss` forwards `widgets`
- all 9 mixin names present in the partial
- zero `verdict`/`acr`/`expando`/`mat-expansion` occurrences in the partial (retired-scope guard)
- gallery template references each of the 9 demo sections
- inventory rows for all 9 widgets have moved from Candidate to Extracted
- consumer-migration checks (`@include vl.<mixin>` + retired-literal absence) land with Tasks #1114/#1115; they cannot gate the Phase 1 relay before those Phase 2 migrations exist

## 3. Phases / tasks

- **Phase 1 — Consume & demo**
  - Task A: `sync:ds` both repos; `/dev/ds` Widgets section (9 cards); dark-theme coverage.
  - Task B: verify relay + registration; inventory doc update.
- **Phase 2 — Migrate consumers** (blocked by Phase 1)
  - Task C: signals/review surfaces — `signal-filter-pills`, `signal-review-header`, `review-header`, `signal-table`.
  - Task D: charts/gallery surfaces — `chart-toolbar`, `group-panel`.

## 4. Risks / edge cases

- **Visual drift** — compare each migrated surface against the prototype
  baseline (`.devin/tmp/ds-widgets-prototype.html`) and `/dev/ds` demos;
  the mixins emit identical values so any drift is a markup-contract miss,
  not a styling gap.
- **ACR pill-btn variants** — `.review`/`.accept` consumers keep their
  hard-coded rules locally until the workflow retires them for real; the
  mixin deliberately does not emit them. They are marked for deletion,
  not migration.
- **dark theme** — all emitted values ride custom properties, so the
  gallery's `[data-theme="dark"]` toggle exercises widget dark behavior
  for free; verify visually.
