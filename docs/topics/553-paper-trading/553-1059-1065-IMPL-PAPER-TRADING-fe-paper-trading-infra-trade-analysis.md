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
**Last Updated:** 2026-10-20  

## Scope

The analysis surface (PRD US3–US7): new `trading/analysis` route beside `trading/paper`. Dataset library → workbench (full-CSV table) → analysis views on the filtered subset → saved slices + compare. Deps: `papaparse` (new), `@syncfusion/ej2-angular-charts` (existing), AngularFire `getDownloadURL` (precedent: trade-journal).

## 1. Service + store — `analysis.service.ts` / `analysis.store.ts`

- `analysisDatasetsPath()` collection: list index docs (ordered by generatedAt desc), `updateTagsNotes`, `delete` (doc + Storage object together).
- `loadDataset(id)` → `getDownloadURL(storageRef)` → fetch → `papaparse.parse` → coerce via SHARED `COLUMN_TYPES` → rows signal.
- Slice CRUD on `analysisSlicesPath()` (name + serialized `SliceFilter[]`).
- Store signals: `datasets`, `activeDataset`, `rows`, `filters`, `filteredRows`, `slices`, `compare` state, `loading`/`error`. OnPush + computed throughout (same pattern as paper-trading store/component).

**As-built (#1081):**
- `AnalysisService` / `AnalysisStore` under `savant-trader/services|stores` — Observable-returning service methods gated on `requireUserId`, Firestore SDK calls wrapped in `runInInjectionContext` (AllocationBucketService pattern); `signalStore` with `withState`/`withComputed`/`withMethods` (PaperTradingStore pattern).
- `loadDataset$(doc)` takes the index **doc**, not a bare id — `gcsPath` on the doc is authoritative and the caller already holds it. Returns `{ rows, columns }` — the CSV header names actually present; `applySlice` skips predicates on absent columns and records them on `skippedSliceColumns` for the UI notice.
- `deleteDataset$` deletes the Storage object **then** the index doc — a hard object failure aborts before the doc changes; `storage/object-not-found` is tolerated (generating/failed docs have a gcsPath but no object, and a retry after a partial delete must still reach the doc).
- Rules (required at deploy): `firestore.rules` grants authed update+delete on `paper-trading/analysis-datasets/items` (create stays callable-only); `storage.rules` grants authed delete on `analysis-datasets/` objects. **Deploy needed:** `firebase deploy --only firestore:rules,storage` before the workbench works.
- Store extras: `sorts` chain in state (asc→desc→removed, additive shift+click — #1067 cycle) feeding `sortedRows`; `filteredCompareRows` runs the same filter chain over the compare dataset; every `TradeAnalysisRow` key present after coercion (absent CSV columns → null). Filter/sort predicates live in `utils/analysis-rows.util.ts` (pure fns; keeps the store under the file-size guideline).
- In-flight cancels (paper-trading-store pattern): `openDataset`/`loadDatasets`/`loadCompareDataset`/`closeDataset`/`clearCompare` unsubscribe the previous subscription — a slower prior GCS fetch cannot overwrite a newer selection's rows. `deleteDataset` also clears the compare slot when the deleted dataset was the compare target.
- `papaparse@5.7.0` + `@types/papaparse` added; real papaparse in specs, mocked only at the `@angular/fire` + `fetch` boundary.

## 2. Route + library + run-config — `trading/analysis`

- Route `trading/analysis` beside `trading/paper`; nav affordance from the paper page.
- Library view: card/table of index docs — origin badge, params summary, symbol scope, rowCount, generatedAt, status chip (`generating` shows spinner + auto-refresh), tags/notes inline edit, delete w/ confirm.
- Run-config form → `generateTradeDataset` callable → returns `datasetId`; library shows the `generating` entry until ready.
  - Live snapshot: no params beyond notes/tags.
  - Replay: symbol scope (single/list/all), signalTypes multi, exit-rule text with registry-grammar validation hint, bar range, max hold days.

**As-built (#1082):**
- Route `AppRoutes.TRADE_ANALYSIS = 'trading/analysis'` beside `trading/paper` (same lazy + authGuard pattern); `PAGE_INFO` title 'Trade Analysis'; Trading nav gains an 'Analysis' item; paper page header gains a 'Trade Analysis' link next to Strategy Builder.
- `pages/analysis/analysis.component` — card grid library: origin badge, status chip (`generating` renders spinner + disables Open), exitRule/entryConvention/barRange/scope/signalTypes/rowCount/generatedAt, tags pills + notes, failed cards surface `error`. Search box filters by id ("name")/origin/exitRule/symbols/signalTypes/tags/notes via `matchesDatasetSearch`. Delete is inline two-step (Delete → Confirm/Keep). Poll: while any `generating` entry exists, `loadDatasets` re-runs every 5 s (skips while a load is in flight).
- `pages/analysis/analysis-run-config.component` — reactive form emitting `{params, meta}` (never calls the service directly). Replay origin: symbols (comma text → uppercase dedupe), signalTypes multi-select over `SIGNAL_TYPES`, exit-rule text with registry-grammar validator + hint (`trailing-{pct}`/`initial-stop-{pct}`/`time-{N}d` — mirrors `exits/registry.ts`), mat-datepicker bar range with from≤to group validator. Live origin: replay controls **disable** (a stale invalid exit rule can't block a snapshot) and submission sends `LIVE_DEFAULTS` (empty scopes = all, `trailing-8` provenance, `2023-01-01 → today`, `signal-bar-close`). `form.invalid` submits are swallowed with `markAllAsTouched` — AC3 guarantees nothing reaches the callable.
- `AnalysisService.generateDataset$(params)` wraps `httpsCallable` (`CallableName.GENERATE_TRADE_DATASET`) → `res.data.datasetId`. `AnalysisStore.generateDataset(params, meta?)` chains callable → optional `updateTagsNotes$` (meta failure tolerated — the minted doc still refreshes in) → `listDatasets$` refresh so the `generating` doc surfaces immediately; `isGenerating` flag disables the submit button.
- **Deviation:** "max hold days" dropped — `AnalysisRunParams` has no such field; time-based exits are expressed in the registry grammar (`time-{N}d`). Symbols are a single comma-input covering single/list (empty = all) rather than three modes.
- Pure helpers in `utils/analysis-run-config.util.ts`: `EXIT_RULE_RE`, `isValidExitRule`, `toIsoDate` (local-midnight → `YYYY-MM-DD`, no UTC day-shift), `parseSymbolScope`, `parseTags`, `matchesDatasetSearch`, `LIVE_DEFAULTS`.

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
