**Topic:** Savant Design System  
**Topic Slug:** 1024-design-system  
**Thread:** FE Blueprint: Theme plumbing, bridge, explorer + literal sweep  
**Thread Slug:** 1202-fe-blueprint  
**Issue:** #1202  
**Thread Parent:** #1202  
**Topic Parent:** #1024  
**Task:** #1217  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1217 FE: literal sweep — long-tail + inventory re-run

## Verdict

**PASS** (gate-mode) — 0 critical / 0 major findings. All minors were
resolved during the three implementation verification passes; review
confirmed each fix landed and found no new defects.

## Scope reviewed

Final literal-sweep task — every FE surface not consumed by #1213
(global styles), #1214 (savant-trader), #1215 (options surfaces), or
#1216 (shared components + shared contracts):

- core: header, login, signup (+html inline debug styles), sidenav-menu,
  core.component
- dashboards: dashboard (+heatmap, stock-list-selector), dashboard-v2
  (+heatmap, stock-list-selector), dashboard-v3 (+heatmap-v3/v4, store)
- features: decision-board, heatmap-view, heatmap-chart (+view, data
  service), symbol-input, trade-journal (+detail card, table),
  rs-table, rs-chart-view, topic-viewer (page + tree), sync-chart-view
- data/stores/utils: features/data/*, rs-chart.store,
  stock-list-v2.feature, dashboard-v3.store, heatmap-view.feature,
  color-utils, heatmap-base-palettes, constants-rs
- ds-gallery (definition-layer mirrors)
- savant-trader residuals missed by #1214 (dead var() fallbacks, rgba,
  named colors)
- src/app/styles partials (verified def-layer only)

## Axes

### Standards — PASS

- All conversions follow the established `#1213–#1216` mapping table:
  chrome greys → `border-subtle`/`border-strong`, whites →
  `surface`/`on-surface`, `#1976d2`/`#007bff` → `accent` + `on-accent`,
  `#000`/`black` matrix hairlines → `border-strong`, direction pairs →
  `up`/`down` containers, warn pair → `warning-container` +
  `on-warning-container`, rgba alphas → `color-mix(var(--ds-*) …)` or
  `--ds-shadow-*`, `--theme-*` reads → canonical `--ds-*`.
- Exception tags use the established `literal-sweep exception #1217:`
  format on all retained literals (data `rsColor` fields, heatmap
  ramp/palette literals, chart-series hues, stage-identity categorical
  palettes, Syncfusion widget chrome, ds-gallery mirrors).
- `--mat-sys-*` / `--theme-*` vars confirmed always defined at `:root`
  in `src/styles.scss` — the ~170 dropped literal fallbacks were
  unreachable dead code (same precedent as #1214/#1216 `--fc-*` drops).

### Spec — PASS

- Inventory regenerated: 2042 sites total; every site in the swept
  scope is now inside a tagged exception block or is a documented
  false positive (issue refs, arrow entities, spec fixtures).
- No new color literals introduced — the 3 literal `+` lines in the
  diff are pre-existing lines re-emitted when tag comments inserted
  above them.
- Direction semantics preserved: `tj-detail-card` up/down pairs,
  `decision-board` `chip--long`/`chip--short` → `--ds-up-*`/`--ds-down-*`
  container pairs.
- Visual spot-check: deferred to the phase-level visual pass per the
  established convention (user opted for one broad walkthrough at the
  end). Flagged deltas for that pass: heatmap `#000`/`black` matrix
  hairlines → `--ds-border-strong` (black → `#3d434c` dark / `#b9c0ca`
  light — visible-but-subtle change); interval-button active states →
  `--ds-accent` cyan.

### Thermo — PASS

- Three independent verification passes during implementation each
  caught real misses (inventory-blind files, named colors, `var()`
  fallback literals, `dashboard/heatmap` dir) — all closed before
  review. No fourth-pass class of hiding spots remains: all 26
  feature dirs enumerated, hsl/hsla zero, inline `style=`/`ngStyle`/
  `setStyle` zero untagged, SVG attrs tagged, `.css` files none,
  shadow named colors zero.
- Self-inflicted `var(--mat-sys-X)` → `var(--mat-sys-)` corruption
  (bash `$1` interpolation) restored via `git show` — 98 token names
  verified byte-identical post-restore; zero malformed `var()` remain.
- `//` inside `<e-series>` markup (NG5002) fixed — verified no other
  JS comments leaked into template/`styles:` blocks.

## Test evidence

- `npx jest` full suite: **278/278 suites · 4,787 tests · PASS**
  (NG0914 zoneless warnings + worker force-exit are pre-existing)
- `npx sass` on all touched `.scss`: clean
- Inventory: `scripts/inventory-ui-colors.mjs` regenerated —
  `docs/topics/1024-design-system/ui-color-sites.json`

## Findings log

None outstanding. Items resolved in-implementation (for the record):

| # | Severity | Finding | Resolution |
|---|----------|---------|------------|
| 1 | minor | `dashboard/heatmap` dir inventory-blind — 20 `1px solid black` | → `border-strong` (5 live + 15 commented) |
| 2 | minor | 3× `lightgrey` hover fills (sidenav, 2× stock-list-selector) | → `--ds-surface-overlay` |
| 3 | minor | `color-utils.ts` tag silently no-opped (CRLF) | re-tagged via edit tool; all 30 batch edits re-verified landed |
| 4 | minor | `var(--mat-sys-)` corruption across 20 files | token names restored from git; fallbacks re-dropped |
| 5 | minor | `//` comment in `<e-series>` markup → NG5002 | `<!-- -->` moved above attributes |
| 6 | minor | ~72 dead `var(--mat-sys-*, literal)` fallbacks in savant-trader (#1214 blind spot) | dropped — unreachable |

## Next

`/proj qa 1024 1217` — create QA issue, UAT doc, close the gate.
