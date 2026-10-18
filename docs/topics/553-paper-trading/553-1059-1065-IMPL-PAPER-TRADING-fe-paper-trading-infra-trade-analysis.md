# FE IMPL — Trade Analysis & Forensics

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1065  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** Implementation Plan  
**Status:** Draft  
**Created:** 2026-10-17  
**Last Updated:** 2026-10-17  

## Scope

The analysis surface (PRD US3–US7): new `trading/analysis` route beside `trading/paper`. Dataset library → workbench (full-CSV table) → analysis views on the filtered subset → saved slices + compare. Deps: `papaparse` (new), `@syncfusion/ej2-angular-charts` (existing), AngularFire `getDownloadURL` (precedent: trade-journal).

## 1. Service + store — `analysis.service.ts` / `analysis.store.ts`

- `analysisDatasetsPath()` collection: list index docs (ordered by generatedAt desc), `updateTagsNotes`, `delete` (doc + Storage object together).
- `loadDataset(id)` → `getDownloadURL(storageRef)` → fetch → `papaparse.parse` → coerce via SHARED `COLUMN_TYPES` → rows signal.
- Slice CRUD on `analysisSlicesPath()` (name + serialized `SliceFilter[]`).
- Store signals: `datasets`, `activeDataset`, `rows`, `filters`, `filteredRows`, `slices`, `compare` state, `loading`/`error`. OnPush + computed throughout (same pattern as paper-trading store/component).

## 2. Route + library + run-config — `trading/analysis`

- Route `trading/analysis` beside `trading/paper`; nav affordance from the paper page.
- Library view: card/table of index docs — origin badge, params summary, symbol scope, rowCount, generatedAt, status chip (`generating` shows spinner + auto-refresh), tags/notes inline edit, delete w/ confirm.
- Run-config form → `generateTradeDataset` callable → returns `datasetId`; library shows the `generating` entry until ready.
  - Live snapshot: no params beyond notes/tags.
  - Replay: symbol scope (single/list/all), signalTypes multi, exit-rule text with registry-grammar validation hint, bar range, max hold days.

## 3. Workbench table

- Generic CSV-table component driven by `ANALYSIS_COLUMNS` manifest — all columns render, visibility togglable, sticky header + rows-only scroll (patterns proven in #1067: `.table-scroll`, `border-collapse:separate`, sort chain w/ shift+click + aria-sort + keyboard).
- Filters compose (AND): enum multiselect (signalType, direction, captureList, sector, `ind.zoneV*`), numeric range, date range; filtered-count + reset always visible.
- Open-row quarantine: `status` column badge; analysis views default to `status=CLOSED`/`analysisCohort='signal-equity'`, opt-in "include open/provisional" toggle with a visible banner.
- Column cells typed via manifest kind (mono for numbers, chips for enums) — the table is generic enough to reuse on `trading/paper` later (PRD concept item 5 — not wired now).

## 4. Analysis views — filtered subset, live recompute

- **Histogram** (`ejs-chart` column series): `tradeRetPct` bins w/ adjustable width, win/loss coloring, mean/median markers, optional second-cohort overlay.
- **Scatter** (`ejs-chart` scatter): x/y/color pickers over any manifest column, jitter toggle for discrete x, point hover → tradeId.
- **Stats block**: count, %profitable, avg/median return, avg win/loss, payoff, profit factor, expectancy, max consecutive W/L, avg daysHeld, avg MFE/MAE, giveback — plus per-`signalType` breakdown table. All derived from `filteredRows` via computeds; `analysisCohort='excluded'` rows never enter stats.

## 5. Slices + compare

- "Save as slice" → serialize current filters → `analysisSlicesPath()` doc; slice list on library + workbench.
- Apply-to-current-dataset; missing-column predicates skipped with a notice (per contract).
- Compare mode: pick a second dataset + the active slice → overlaid histogram + side-by-side stats block.

## Risks

- **Parse perf**: ~45 cols × tens of thousands of rows is fine for papaparse + in-memory signals; no worker needed at this scale — revisit only if a dataset crosses ~50k rows.
- **Column drift**: FE trusts `ANALYSIS_COLUMNS`, not the CSV header order — parse by header name so old datasets keep working when columns are appended.
