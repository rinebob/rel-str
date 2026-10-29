**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1328  
**Topic Parent:** #1024  
**Task:** #1217  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1217 FE literal sweep: long-tail + inventory re-run

## Scope

Final literal-sweep task — every FE surface not consumed by
#1213–#1216: core (header/login/signup/sidenav/core), dashboards
v1–v3 (+heatmaps, stock-list selectors), decision-board, heatmap-view,
heatmap-chart, symbol-input, trade-journal, rs-table, rs-chart-view,
topic-viewer, sync-chart-view, stores, features/data, ds-gallery,
plus savant-trader residuals the earlier sweeps missed.

~95 real UI literals → `var(--ds-*)` across ~20 files; ~170 dead
`var(--mat-sys-*, literal)` / `var(--theme-*, literal)` fallbacks
dropped (unreachable — always defined at `:root`); 17 new
`literal-sweep exception #1217` tags on data `rsColor` fields, heatmap
ramps, chart-series hues, stage-identity palettes, Syncfusion chrome,
ds-gallery definition-layer mirrors.

## Prerequisites

- Repo on `prod` branch, `npm install` up to date
- App served at `http://localhost:4210` (`npm start`)
- Signed-in session (routes are `authGuard`-protected)
- Dark theme default; light via header theme toggle

## Acceptance results

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| AC1 | Inventory re-run: sites consumed or tagged | **PASS** | regenerated — 2042 sites; swept scope = tagged exception blocks + documented FPs (issue refs, arrow entities, spec fixtures, ds-gallery palette-definition demo hexes) |
| AC2 | No new literals introduced | **PASS** | scoped diff — added lines are `var(--ds-*)`/`color-mix` + comment tags only; the 3 literal `+` lines are pre-existing lines re-emitted by tag insertion |
| AC3 | `--ds-up`/`--ds-down` semantics preserved | **PASS** | `tj-detail-card` up/down pairs + `decision-board` `chip--long`/`chip--short` → `--ds-up-*`/`--ds-down-*` container pairs (border on the up/down token itself) |
| AC4 | Visual spot-check, dark + light | **DEFERRED** | user-directed — deferred to phase-level walkthrough; scenarios D1–D5 below |
| AC5 | Existing specs green | **PASS** | full `npx jest` — 278/278 suites, 4,787 tests (NG0914 warnings + worker force-exit pre-existing); sass compile clean on all touched `.scss` |

## Deferred visual walkthrough checklist (phase-level)

Run on `http://localhost:4210`, dark first, then light.

- **D1** Heatmap matrix surfaces (`heatmap-view`, `dashboard*/heatmap*`)
  — `#000`/`black` grid hairlines → `--ds-border-strong`. **Visible
  delta: black → `#3d434c` dark / `#b9c0ca` light.** Verify grids stay
  legible both themes.
- **D2** Dashboard interval buttons + `.interval-badge` — active state
  `#1976d2`/`#007bff` blue → `--ds-accent` cyan (`--ds-on-accent` text).
  Same hue-shift question as interval-toggle in #1216.
- **D3** Login / signup / header / sidenav — chrome greys re-theme;
  hover states (`lightgrey` → `--ds-surface-overlay`) both themes.
- **D4** Trade-journal + decision-board chips — status chips on
  success/error/direction container tints; long/short chips on
  up/down containers — verify contrast both themes.
- **D5** ds-gallery — palette swatches unchanged by design (tagged
  definition-layer mirrors); page chrome re-themes.

## Regression / smoke

- Theme toggle on any converted surface — literals that were
  hard-coded light greys now track `[data-theme]` (this is the point;
  check nothing was intended to stay fixed).
- Syncfusion charts (`heatmap-chart`, `rs-chart`, `sync-chart-view`) —
  series fills, scrollbar skins, crosshair unchanged (tagged
  exceptions, third-party widget chrome).
- Topic-viewer — stage-identity dot colors unchanged (categorical
  palette exception); warn banner now on `--ds-warning-*` pair.
- `features/data/*` mock candle colors unchanged (`rsColor` is
  chart data, tagged).

## Findings

- Nit (parked): comment-only literals inside tagged exception blocks
  keep counting as inventory sites — noise, not drift.
- Nit (parked): `dashboard-v3.store.ts` `fallbackColor` sits inside
  its file-level tag; legitimate data color.
- Incident (resolved): bash `$1` interpolation collapsed 98
  `var(--mat-sys-X)` names → restored from git, verified
  byte-identical; `//` comment in `<e-series>` markup → NG5002, fixed
  to `<!-- -->`.
