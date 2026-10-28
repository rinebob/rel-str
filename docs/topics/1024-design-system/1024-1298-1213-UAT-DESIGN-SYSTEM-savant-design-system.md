**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1298  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1213  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete — visual deferred  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# UAT — #1213 FE: literal sweep — styles/global layer

> **Deferral note:** per user decision (QA session), the S1–S9 manual
> visual walkthrough is **deferred to a single phase-level pass after
> #1214–#1217 ship** — the literal-sweep phase ends with one screen-by-
> screen review covering all swept surfaces. All automated acceptance
> items below are green. This doc stays the checklist for that pass.

## Scope

- `--theme-*` alias re-pointing to `--ds-*` (10 names; 6 previously
  undefined — heatmaps, dashboard-v3, rs-chart-view consumers)
- `rsButtonOne` / `border1` / `customScrollbar` tokenization
- `--mat-sys` bridge blocks tagged as literal-sweep exceptions +
  3 missing keys per theme (`background`, `surface-variant`, `warning`)
- Drive-by fixes for never-defined vars: `--ds-font-size-xs` → `-sm`
  (paper-trade dialog), 5 MUI-style vars → `--ds-*` (sync-chart-view)

## Prerequisites

- Dev server: `npm start` → http://localhost:4210, logged in
- Theme toggle in header flips `data-theme` dark ⇄ light

## Automated evidence (already green)

- `node scripts/inventory-ui-colors.mjs` re-run — 0 untriaged literals in
  `src/styles.scss` / `src/app/styles/*`; 68 `--mat-sys` literals carry
  `literal-sweep exception` tags
- `npx sass --load-path=vendor/savant-ds/styles src/styles.scss` — clean
- `scripts/verify/design-system-palette-lock-1211.ts` — 19/19
- `npx jest` — 269 suites / 4,650 tests

## Scenarios

### S1 — Scrollbar visibility (dark)
Navigate to `/rs-table`, `/heatmap-view`, or `/trading/chart-view`.
In dark theme, confirm the scrollbar thumb is visible against the track
and brightens on hover. (Was always `#bbb`; now `--ds-border-strong`
`#3d434c` / hover `#9aa3ad`.)
**Result:** DEFERRED — phase-level pass

### S2 — Neutral buttons
On `/dashboard-v3` or the symbol-input / select-stock / open-card
dialogs, confirm buttons render as neutral grey tiles with readable
text in BOTH themes (was stranded `lightgrey`+`black`).
**Result:** DEFERRED — phase-level pass

### S3 — dashboard-v3 selected option
On `/dashboard-v3`, select an option-button row — the selected state
now shows the Cyan accent fill + dark text (previously unstyled — the
`var(--theme-primary)` declaration silently dropped).
**Result:** DEFERRED — phase-level pass

### S4 — Heatmap headers + separators (dark)
On `/heatmap-view` (v2/v3/v4 variants) in dark theme, header rows now
use dark surfaces (were light-grey `#ececec` fallbacks); week
separators read as subtle grey instead of invisible black.
**Result:** DEFERRED — phase-level pass

### S5 — sync-chart-view page (legacy)
Open `/sync-chart` in dark theme — page/cards now show raised surfaces,
text fills, and dividers (previously 10 dropped declarations →
transparent bg / missing text).
**Result:** DEFERRED — phase-level pass

### S6 — topic-viewer hover
On `/tools/topic-viewer`, hover tree/topic rows — hover background is
themed (was always `#f5f5f5`, jarring in dark mode).
**Result:** DEFERRED — phase-level pass

### S7 — paper-trade dialog .mono
On `/trading/paper`, open an action dialog — `.mono` values render
12px mono (was inheriting body size; `--ds-font-size-xs` never
existed).
**Result:** DEFERRED — phase-level pass

### S8 — Light-theme regression scan
Flip to light theme and re-walk S1–S4 surfaces: scrollbars ≈ old
`#bbb`, neutral buttons ≈ lightgrey, heatmap week separators now soft
grey `#b9c0ca` (was black — the one intentional light-mode change).
**Result:** DEFERRED — phase-level pass

### S9 — Regression smoke
General click-through of `/trading/chart-view` and one other dense
page in both themes — no new contrast failures, no flashing light
surfaces in dark mode.
**Result:** DEFERRED — phase-level pass

## Traceability

| AC | Scenarios |
|---|---|
| Inventory consumed/tagged | automated (evidence above) |
| No new color literals | automated (exception-tagged only) |
| --ds-up/--ds-down preserved | automated (untouched) |
| Visual spot-check dark+light | S1–S9 — DEFERRED to phase-level pass |
| Specs green | automated (4,650 tests) |

## Regression checklist

- [ ] No console CSS warnings (invalid var refs) on swept surfaces
- [ ] Theme flip mid-session re-renders cleanly
- [ ] Header/footer/nav chrome unchanged (mat-sys bridge intact)
