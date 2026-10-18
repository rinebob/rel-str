**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1043  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** INVENTORY  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

# DS Inventory — element catalog + mockup convention

**Mockup convention.** Planning-doc mockups are `/dev/ds` screenshots or
token-built SVGs, cited by element name (e.g. "per `state-block`", "per the
`--ds-up`/`--ds-down` badges"). Screenshots come from the live gallery at
`/dev/ds`; SVGs must draw on `--ds-*` tokens only — no ad-hoc hex — so a
mockup is always a claim about existing elements, never invented chrome.

## Extracted elements (this thread)

Source of truth: `C:\aa\projects\savant-ds\styles\` (package). ST consumes via
`@use 'index' as ds` or the `_pd-visual-language.scss` shim (`vl.*`); SA via
`@use 'index' as ds`. Dup count = live call sites, not historical copies.

| Element | Source file(s) | Dup count | Status |
|---|---|---|---|
| `--ds-*` token layer | `savant-ds/styles/_tokens.scss`; emitted once in each app's `src/styles.scss` | 2 apps (ST + SA) | Live #1035 |
| `page-host` | `savant-ds/styles/_page.scss` | 3 ST call sites | Live #1036 |
| `page-shell` | `savant-ds/styles/_page.scss` | 3 | Live #1036 |
| `content-column` | `savant-ds/styles/_page.scss` | 3 | Live #1036 |
| `header-bar` | `savant-ds/styles/_page.scss` | 3 | Live #1036 |
| `dialog-chrome` | `savant-ds/styles/_dialog.scss` | 6 | Live #1037 |
| `dialog-status` | `savant-ds/styles/_dialog.scss` | 3 | Live #1037 |
| `error-banner` | `savant-ds/styles/_feedback.scss` | 3 | Live #1037 |
| `dense-table` | `savant-ds/styles/_data-display.scss` | 7 | Live #1052 |
| `state-block` | `savant-ds/styles/_data-display.scss` | 3 ST + 1 SA (`av-proxy-api/src/app/feat/bz-calendar-view/comps/bz-no-results/bz-no-results.component.scss`) | Live #1052 |
| `stat-strip` | `savant-ds/styles/_data-display.scss` | 3 | Live #1052 |
| Direction-accent tokens (`--ds-up`/`--ds-down`; `vl.$up`/`vl.$down`) | `_tokens.scss`; `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss` | 6 call sites | Live #1035/#1040 |

## Thread infrastructure

| Item | Source file(s) | Status |
|---|---|---|
| `_pd-visual-language` delegation shim | `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss` | Live #1040 — `@forward 'index'`; keeps `bounded-tab-group`/`tab-scroll-pane` PD-local |
| `/dev/ds` element gallery | `src/app/features/ds-gallery/` (route in `src/app/core/core-routes.ts`, `AppRoutes.DS_GALLERY`) | Live #1041 — 12 cards, `seen in:` provenance, host-scoped dark toggle |
| ST vendored consumption | `vendor/savant-ds/`, `package.json` `file:vendor/savant-ds` + `sync:ds`, `angular.json` includePaths, `scripts/sync-savant-ds.ts` | Live #1071 — original vendoring (App Hosting can't resolve sibling `file:../`) |
| SA vendored consumption | `av-proxy-api/vendor/savant-ds/`, `av-proxy-api/angular.json` includePaths, `av-proxy-api/scripts/sync-savant-ds.mjs` | Live #1042 |
| `--mat-sys-*` bridge (SA) | `av-proxy-api/src/styles.scss` | Live #1042 — SA's prebuilt indigo-pink emits no `--mat-sys-*`; bridge maps the 6 the DS reads onto SA palette vars |

## Candidate elements (next thread)

Migration = adopt an already-graduated mixin; Extraction = new package work.

| Candidate | Seen in (representative files) | Dup count | Status |
|---|---|---|---|
| Direction-badge chrome (class styling atop `--ds-up`/`--ds-down`) | `src/app/features/portfolio-dashboard/pages/portfolio-gallery/components/position-card/position-card.component.scss`, `src/app/features/savant-trader/backtest/components/backtest-trade-table/backtest-trade-table.component.scss`, `src/app/features/savant-trader/components/gallery-card/gallery-card.component.scss`, `src/app/features/savant-trader/pages/options-strategy-dashboard/options-strategy-dashboard.component.scss`, `src/app/features/savant-trader/pages/paper-trading/paper-trading.component.scss` | ~10 files | Candidate — extraction |
| Unmigrated error banners (`#fef0f0`/`#fdecea`/`#ffebee`/`#fff3f3` literals) | `src/app/features/savant-trader/pages/options-strategy-dashboard/options-strategy-dashboard.component.scss`, `src/app/features/savant-trader/pages/paper-trading/paper-trading.component.scss`, `src/app/features/savant-trader/pages/strategy-builder/strategy-builder.component.scss`, `src/styles.scss` | 4 files | Candidate — migrate → `error-banner` |
| Empty/no-results variants | 13 files carry `.empty-state`/`.no-results`/`.no-data` | 13 | Candidate — migrate → `state-block` |
| Local stat/KPI strips | `src/app/features/savant-trader/pages/signal-order/order.component.scss` (hand-rolled `sb-label`/`sb-value`/`sb-sep`, no `@include`), `src/app/features/portfolio-dashboard/allocation-bucket-detail-dialog.component.scss` (`.stats-strip`/`.pos-stats`) | 2 | Candidate — migrate → `stat-strip` |
| Filter/toolbar row | `src/app/features/savant-trader/components/chart-toolbar/chart-toolbar.component.scss`, `src/app/features/savant-trader/components/indicator-menu/indicator-menu.component.scss`, `src/app/features/savant-trader/components/signal-detail/signal-detail.component.scss`, `src/app/features/savant-trader/pages/signal-history/signal-history.component.scss`, `src/app/features/savant-trader/pages/spread-chart/spread-chart-page.component.scss` | 5 | Candidate — extraction |
| Chip/badge | 10 files carry `.chip`/`.badge`/`.tag` variants | 10 | Candidate — extraction |
| Dense-table holdouts (`mat-table` overrides) | `src/app/features/heatmap-view/heatmap-view.component.scss`, `src/app/features/rs-table/rs-table.component.scss`, `src/app/features/savant-trader/components/spread-builder-dialog/spread-builder-dialog.component.scss` | 3 | Candidate — migrate → `dense-table` |
| `bounded-tab-group` + `tab-scroll-pane` | `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss` | 2 call sites | Deferred — intentionally PD-local (Material-coupled `::ng-deep`; #1052 decision) |
| `@keyframes spin` / `.spinner` | `src/styles.scss` (global); `src/app/features/savant-trader/components/run-metrics-strip/run-metrics-strip.component.scss` (local copy) | 2 defs | Candidate — dedupe local copy onto the global keyframes |
