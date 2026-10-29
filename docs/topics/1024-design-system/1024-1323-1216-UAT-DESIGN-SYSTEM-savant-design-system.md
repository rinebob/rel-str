**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1323  
**Topic Parent:** #1024  
**Task:** #1216  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1216 FE literal sweep: shared components

## Scope

Hardcoded color literals in shared components converted to
`var(--ds-*)` or tagged as exceptions. 36 inventory sites → 1 file
converted (`interval-toggle`), 28 tagged exceptions (flex-chart
indicator categorical hues, `rs.constants` MA palette + Syncfusion
crosshair, rs-chart Syncfusion scrollbar skin), 4 documented false
positives (`&#9660;`/`&#9650;` arrows in `stop-loss-form.component.html`
— user WIP, untouched). Beyond the inventory: repo-root `shared/`
chart contracts tagged (outside scan roots) and 9 dead
`var(--fc-*, literal)` fallbacks dropped (unreachable — template binds
all `--fc-*` on the wrapper).

`stop-loss-form.component.html` is the user's in-flight WIP — not
touched, not shipped by this task.

## Prerequisites

- Repo on `prod` branch, `npm install` up to date
- App served at `http://localhost:4210` (`npm start`)
- Signed-in session (routes are `authGuard`-protected)
- Dark theme default; light via header theme toggle

## Acceptance results

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| AC1 | Inventory re-run: sites consumed or tagged | **PASS** | regenerated post-review; features/shared literal sites = 28 (all tagged `literal-sweep exception #1216`), src/app/shared = 4 arrow-entity FPs; repo-root shared/ literals tagged at file level |
| AC2 | No new literals introduced | **PASS** | scoped diff — added lines are `var(--ds-*)`/`var(--fc-*)` declarations + comment tags only |
| AC3 | `--ds-up`/`--ds-down` semantics preserved | **PASS** | no direction colors in scope; zone ramp + RSI reference lines match convention |
| AC4 | Visual spot-check, dark + light | **DEFERRED** | user-directed — deferred to phase-level walkthrough; scenarios D1–D3 below |
| AC5 | Existing specs green | **PASS** | full `npx jest` — 275/275 suites, 4,759 tests; scoped shared re-run post-fix; sass compile clean |

## Deferred visual walkthrough checklist (phase-level)

Run on `http://localhost:4210`, dark first, then light.

- **D1** Any surface using `interval-toggle` (e.g., chart pages with
  timeframe buttons) — button borders (`--ds-border-subtle`), active
  state **changes hue: indigo `#3f51b5` → cyan `--ds-accent`** (verify
  acceptable + readable both themes)
- **D2** Any flex-chart surface (`/dev/flex-chart`, embedded chart
  cards) — crosshair lines/labels, log-axis labels, no-data text:
  all unchanged (bound via `--fc-*` palette props; dead fallbacks
  removed — verify no unstyled flash)
- **D3** `/` rel-str chart surfaces using `rs-chart` — Syncfusion
  scrollbar grey ramp unchanged (tagged exception); MA line colors
  (amber/blue/violet) unchanged (identity palette exception)

## Regression / smoke

- Flip `[data-theme]` dark/light on a flex-chart page — indicator
  series colors stay literal by design (exception), chrome re-themes
- `indicator-registry` + `st-anchored-vwap` specs cover the
  `ST_ZONE_FALLBACK_COLOR` constant swap (compile + registry load)

## Findings

- Nit (parked): `[style.--fc-axis-text]` binding consumed nowhere —
  pre-existing dead binding
- Nit (parked): `!important` ×3 in interval-toggle active state —
  probably not load-bearing; clean exit is MDC token overrides
- Nit (parked): V1 `st-zone` ±3 table deliberately diverges from the
  canonical ±4 contract (`flex-chart-indicator-visuals.ts` header) —
  documented inconsistency, separate decision
