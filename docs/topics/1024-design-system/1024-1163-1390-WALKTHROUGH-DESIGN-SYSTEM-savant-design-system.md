**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1390  
**Thread Parent:** #1163  
**Topic Parent:** #1024  
**Task:** #1390  
**Domain:** DESIGN-SYSTEM  
**Type:** WALKTHROUGH  
**Status:** Draft  
**Created:** 2026-11-03  
**Last Updated:** 2026-11-04  

# De-Materify — Per-Page Verification Walkthrough

All phases (B–H + dead-selector pass) have landed. **One pass, light + dark.**
For each page: exercise the **CHECK** bullets; flag anything that looks
broken, unstyled, or still Material-rendered outside the zoo.

**Universal CHECK — every page:**

- Buttons are `ds-btn`/`icon-btn`/pills: consistent height, hover + disabled states work
- Menus open as DS panels anchored to their trigger, close on outside click
- Dialogs open centered over a backdrop; Escape and backdrop-click close; focus trapped
- Toasts appear bottom-center
- Inputs/selects/dates render as `dse-*` chrome (no raw Material outlines)
- Text legible in both themes (no dark-on-dark)
- Content isn't clipped below the viewport; scrollbars where needed

**Universal PENDING — never flag:**

- Icon glyphs: ligature font is a KEEP archetype (`.dse-icon` spans are correct)
- `--mat-sys-*` color vars in stylesheets: compat tokens, not bugs
- `/dev/ds-elements` and `/dev/ds-gallery`: the zoo intentionally renders real Material

## Shell (all pages)

- Sidenav fly-out menus open on hover/click, close on outside click
- Header buttons + native tooltips (`title=`)

## `/portfolio` — Portfolio Dashboard — ✅ light/dark verified 2026-11-05

- Account-switcher pill group (re-clicking the active account must NOT re-fire)
- Open-orders / option / equity / order-history table action buttons
- Modify-order, close-position, stop-loss dialogs (typed results: number/boolean)
- Confirm dialogs: Back/Confirm, focus lands on Confirm
- Toasts on order actions
- Tabs (`dse-tabs`) switch sections

## `/portfolio/allocation` — Allocation Page

- Bulk Actions menu opens under trigger; checkbox items are `dse-check`
- Assign / Bucket / Detail dialogs
- Bucket-picker radio group (`dse-radio`)
- Row checkboxes

## `/portfolio-v2` — Portfolio Gallery

- Header buttons, view toggles
- Grouped `dse-acc` sections expand/collapse

## `/positions-view`

- Closed-grid range filter pill group
- Closed-grid table: sortable headers show ⇅/↑/↓, pager works
- Open-card action buttons; open-grid pill groups + `dse-acc` sections

## `/trade-journal`

- View toolbar fields + checkboxes/switches
- New-trade dialog: native date inputs, fields, `dse-select`
- Journal table renders as `dse-table`
- Detail card

## `/tools/topic-viewer`

- Slide-toggle is a `dse-switch`
- Repo picker `dse-select` commits numeric index
- Spinner shows during loads

## `/dashboard`, `/dashboard-v2`, `/dashboard-v3`

- v3: three pill toggle groups (mode/range)
- Select-stock-panel form fields (`dse-field`)
- Stock-list-form autocomplete is a `dse-combobox` (dropdown options on focus)
- All buttons; v2/v3 page fills viewport height

## `/rs-chart-view`, `/rs-table`

- Timeframe pill toggle on rs-chart-view
- rs-table: sticky header + footer over scroll region

## `/trading/analysis` — Pilot (reference page)

- Run-config form: all `dse-*` fields, native date inputs
- View switcher `ds-tabs`; dataset cards `dse-card`
- Filter/column menus `ds-menu`; slice menu dropdown
- Spinners `dse-spinner`; dark-mode text legibility
- Workbench table scroll region

## `/trading/chart-view` · `/trading/paper`

- Toolbar buttons
- Paper-trading dialogs (DsDialogService) + form fields
- Status filter is a native `dse-select`
- Toasts

## `/signals/runs` · `/signals/review` · `/signals/history` · `/signals/order` · `/signals/scanner`

- Run-control buttons (+ `dse-spinner` inside run buttons)
- Signal-review: filter buttons, `dse-acc` group panels
- Signal-list: native `ul` items, direction icons
- Order form fields; scanner compare-panel buttons; toasts

## `/options/chain` · `/options/chart` · `/options/pct-change` · `/options/strategy-dashboard` · `/options/spread-chart` · `/options/strategy-builder`

- option-chain: native date input (type=date — Enter/blur commits)
- option-chart: filter menus (multi-select `dse-check` items stay open), date inputs
- option-chart: left control panel + right generator drawer slide via `aside.side-panel`
- option-chart: dense select dropdowns (optgroup labels uppercase, options padded)
- pct-change: `dse-switch` toggles, `dse-acc` sections, target-type buttons
- spread-chart: list menu + mode pills
- spread-builder dialog: fields, `dse-date` pickers (trading-day allow-list enforced on commit, NOT greyed out), multi-selects with optgroups, spreads table
- strategy-builder fields; contract-list-chooser dialog rows + `.row-id`

## `/swing-analysis`

- Swing-settings dialog (DsDialogRef)
- Symbol-nav `dse-combobox` picker: arrows/Enter/Escape keyboard nav works
- Page buttons

## Backtest pages (`/trading/backtest*`, options-replay)

- New-run / report / contract-series dialogs
- Report dialog is ~95vw×90vh (`.dse-dialog.backtest-report-dialog` sizing)
- Run-control + run-list buttons; `DsToastService` notifications

## `/dev/ds-elements`, `/dev/gallery`, `/dev/screenshot`

- PENDING everything — zoo renders Material on purpose. Never flag mat-* here.

## Results log

Record per-page verdicts: `PASS` / `PASS-w-notes` / `FAIL — {description}`.
Regressions get fixed in place or ticketed; every FAIL gets a note with repro.

| Page | Dark | Light | Notes |
|------|------|-------|-------|
