**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** FE Blueprint: Theme plumbing, bridge, explorer + literal sweep  
**Thread Slug:** 1202-fe-blueprint  
**Issue:** #1202  
**Thread Parent:** #1202  
**Topic Parent:** #1024  
**Task:** #1333  
**Domain:** FE  
**Type:** WALKTHROUGH  
**Status:** In Progress  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# Visual Walkthrough — #1333 literal-sweep regression + app smoke

Deferred phase-level visual pass for the literal-sweep series
(#1213–#1217, phase #1212). All sweep code shipped; this is the
manual dark+light eyeball pass the task UATs deferred.

## How to run

App at `http://localhost:4210` (`npm start`). Dark theme first, then
flip to light via the header theme toggle and re-check anything that
looked off. One row = one surface. Results: PASS / FAIL / NIT —
FAILs and NITs get a Findings entry at the bottom.

## Tier 1 — UAT union (must-pass)

### A. Chrome (#1328 D3; #1298 S1, S2)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/login` | form chrome, greys re-themed | | |
| `/signup` | form chrome, button accent+on-accent | | |
| header | surface-overlay bg, hover color-mix | | |
| sidenav | `lightgrey` hovers → surface-overlay | | |
| scrollbars | visible but subtle (S1) | | |
| neutral buttons | readable on dark (S2) | | |

### B. Dashboards (#1328 D1, D2; #1298 S3, S4)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/dashboard` heatmap | `#000` hairlines → border-strong (delta: →`#3d434c`) | | |
| `/dashboard-v2` + heatmap | hairlines, interval buttons accent cyan | | |
| `/dashboard-v3` + heatmaps v3/v4 | hairlines; selected option (S3); headers/separators (S4) | | |
| stock-list selectors | `lightgrey` hover/active → surface-overlay | | |
| `.interval-badge` | accent + on-accent | | |

### C. Charts (#1323 D1–D3; #1298 S5, S6; #1328 D5)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/sync-chart` | page legacy surfaces (S5) | | |
| `/rs-chart` | Syncfusion scrollbar + MA hues UNCHANGED | | |
| `/heatmap-view` | `#000` matrix hairlines → border-strong | | |
| `/heatmap-chart` | series fills UNCHANGED (exception) | | |
| interval-toggle | active indigo `#3f51b5` → cyan accent (delta) | | |
| `/dev/flex-chart` | crosshair/labels/no-data via `--fc-*` (no unstyled flash) | | |
| `/dev/ds` gallery | palette swatches UNCHANGED; chrome re-themes | | |
| `/tools/topic-viewer` | row hover (S6); warn banner on warning pair; stage dots UNCHANGED | | |

### D. Savant Trader 1 (#1311 D1–D7)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/options/pct-change` | grid, live badge, direction colors, top-gainer | | |
| → swing dialog | SVG pivots, panel surfaces | | |
| → contract-mini popup | call=accent/put=down, legend | | |
| `/options/chain` | grid, ATM accent row, separators, cell popup | | |
| `/trading/paper` | status chips, direction, queue dots, order-confirm | | |
| `/trading/gallery` | direction chip, tf-purple (exception), status borders | | |
| `/signals/review` | pills, ACR 7-hue ramp UNCHANGED | | |
| `/signal-history` | long/short/zone/strength chips | | |
| `/trading/analysis` | pills, open-banner, stats ±, histogram UNCHANGED | | |

### E. Savant Trader 2 (#1311 D8–D14)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/analysis/swings` | subtitle/loading/error; settings dialog; stats | | |
| `/options/strategy/build` | error banner, validation | | |
| `/options/strategy/backtest` | trigger chips (nightly-purple exception); chart UNCHANGED | | |
| `/tools/account` | `.json-output` dark-terminal — intentional exception | | |
| `/options/spread-chart` | chart UNCHANGED | | |
| `/trading/scanner` + `/trading/live` | headers/toolbars; trade-btn dark text on green | | |

### F. Portfolio (#1317 D1–D6)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/positions-view` cards | long/short tints, badges (status visible!), PnL | | |
| `/positions-view` open grid | rows, p/l chips, `.pv-more` hover delta | | |
| `/positions-view` closed + summary | p/l colors, strip surfaces | | |
| `/portfolio` | account-summary labels readable (was rgba near-invisible); equity table | | |
| `/portfolio` stop-loss dialog | meta text, unprotected warning (user #888 layout aside) | | |
| `/portfolio-v2` | hairline borders, active pill color-mix (light!), tier badges | | |

### G. Long tail (#1328 D4 + Tier 2 swept-but-unlisted)

| Surface | Check | Dark | Light |
|---------|-------|------|-------|
| `/decision-board` | chip--long/short up/down containers | | |
| `/trade-journal` | status chips, detail-card up/down pairs | | |
| `/rs-table` | converted chrome | | |
| `/options/chart` | swept scss | | |
| signal-detail / run-history-panel / chart-view-toolbar | inside parent pages | | |

## Tier 3 — full-app smoke (optional, user call)

| Surface | Dark | Light |
|---------|------|-------|
| `/history` | | |
| `/portfolio/allocation` | | |
| `/options/strategy-dashboard` | | |
| `/signals/runs` | | |
| `/signals/charts` | | |
| `/dev/gallery` | | |
| `/dev/screenshot` | | |
| `/documentation` | | |
| `/contact` | | |
| `/trading/chart-view` (user WIP — coordinate) | | |

## Findings

### F1 — App canvas never themed (`mat-drawer-content` pinned to `#fafafa`)

**Surface:** global — every page without its own painted background
(most visibly `/login`, `/signup`).

**Root cause:** `@angular/material/prebuilt-themes/indigo-pink.css`
sets `--mat-sidenav-content-background-color: #fafafa`. Pre-sweep this
was invisible because page text/inputs were dark literals that looked
fine on `#fafafa`. Post-sweep, components correctly resolve dark-theme
`--ds-*` values (light text, dark inputs) while the canvas stays
`#fafafa` → light-on-white breakage. Not a sweep regression — a latent
hole the sweep exposed.

**Fix (applied):** `core.component.scss` — `mat-sidenav-content,
mat-drawer-content { background-color: var(--ds-surface) }`.
`--ds-surface` is the documented page-background token (`#0f1114` dark
/ `#ffffff` light; light delta vs `#fafafa` is negligible).

**Verify:** `/login` + `/signup` dark — canvas dark, labels readable,
inputs dark-on-dark with visible borders. Re-check every page: any
page that *still* shows a light canvas is painting its own literal
bg (a sweep miss — report it).

**Open question:** `.login__btn` text on dark cyan `#22d3ee` uses
`--ds-on-accent` `#05252b` — should be readable; looked washed-out in
capture. Re-verify after canvas fix.

### F2 — Header auth buttons on prebuilt indigo-pink

**Surface:** header (unauthed: `Login`, `Sign up`; authed: `Logout`).

**Root cause:** raw Material `mat-button` / `mat-raised-button
color="primary"` — Login renders near-invisible muted text, Sign up +
Logout render indigo-pink blue. Never swept (not literals — Material
component defaults).

**Fix (applied):** `auth-btn` / `auth-btn--primary` classes +
`--mat-button-text-label-text-color` → `--ds-on-surface`,
`--mat-button-filled-container-color` → `--ds-accent`,
`--mat-button-filled-label-text-color` → `--ds-on-accent`. MDC-var
override, no `!important`. Login = ghost, Sign up + Logout = accent
CTA (matches `.login__btn`).

**Note:** `New Order` (`mat-stroked-button`) still Material-styled —
broader de-materify concern (#1163), not this fix.

**Verify:** both themes — Login readable as ghost, Sign up/Logout
cyan accent with on-accent text.

### F3 — SYSTEMIC: no element-level theme spec (buttons are the symptom)

**Surface:** global. One screen shows 4 button treatments (flat accent
rect, Material raised accent, ghost text, dark bordered rect) for 3
semantic roles.

**Root cause:** savant-ds ships compact widgets (pill-btn, icon-btn,
badge, toggles, field-input…) but **no page-level element specs** —
no `ds-btn` hierarchy, no ds-dialog/menu/tooltip/toast/field
contracts. The literal sweep themed color values only; element-level
themability was never scoped. #1101's PRD explicitly deferred
selects/form controls; #1163 De-Materify had no blueprint.

**Disposition:** not fixable in-place — this is the real DS work.
Element inventory + disposition matrix produced as #1347
(`1024-1163-ELEMENT-INVENTORY.md`): ~3,700 usages, 49 archetypes,
phases A–H proposed. **User decision: full redesign first, this
walkthrough runs LAST** after the element work completes.

**Walkthrough status:** paused at 4_BACKLOG; F1/F2 fixes already
applied remain; findings collection resumes post-redesign.
