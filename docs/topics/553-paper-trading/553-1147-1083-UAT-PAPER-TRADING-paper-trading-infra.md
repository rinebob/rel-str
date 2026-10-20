# UAT — #1083 FE workbench table (manifest columns, sort chain, filters, quarantine)

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1083  
**QA Issue:** #1147  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Blueprint:** #1080  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Results log

- **2026-10-20 — headless verification:** 348/348 focused specs green
  (store 32, table 18, page+form 27, all savant-trader utils; 2,168
  across the feature tree post-refactor); `tsc` clean; `ng build` AOT
  clean (papaparse CommonJS warning — known).
  Review: `553-1080-1083-CODE-REVIEW-*` — PASS, 3 passes.
- **User click-through — PASS** on the real dataset
  `ds-20261020-replay-e1aded53` (AMAT · trailing-8 · 104 rows, 103
  closed signal-equity + 1 quarantined):
  - S1 PASS — workbench mounts below the library, header + id + ✕,
    card shows "Open in workbench"
  - S2 PASS — "103 of 103 rows" under the closed-cohort default
  - S3 PASS — sort click cycles; after the content-visibility fix the
    sort re-render is fast (see R6)
  - S4 PASS — per-column `filter_list` popups drive `in`/`range`/
    `dateRange` filters; chips, ×, Reset, live count
  - S5 PASS — column picker lists manifest order; hidden-by-default
    unchecked; toggles live
  - S6 PASS — include-open reveals the quarantined row under the amber
    provisional banner
  - S7 PASS — empty-filtered state + "0 of 104"
  - S8 PASS — close/reopen resets sorts, filters, toggle
- **Verdict: PASS — ship-eligible.**

## Scenarios

Surface: `trading/analysis` → Open a `ready` dataset. The workbench
mounts below the dataset library under a `{scope} · {rule}` header.

| # | Scenario | Expected |
|---|----------|----------|
| S1 | Open dataset | Workbench appears below the library; header shows `{SYMBOL(s)} · {exitRule}` + dataset id + close ✕; card shows "● Open in workbench"; closed signal-equity rows render |
| S2 | Default quarantine | Row count reads "N of M rows" where N = closed signal-equity rows only; open/excluded rows absent by default |
| S3 | Sort chain | Click a column header → asc icon; click again → desc; third click → cleared. Shift+click a second column → both sorts active with rank badges 1/2. Tab to a header, Enter/Space → sorts. aria-sort present |
| S4 | Filters per kind | Enum/string columns → multi-select of values present in the data → `in`; number columns → min/max → `range`; date columns → from/to → `dateRange`. Multiple filters AND together; chips appear, × removes one, Reset clears all; count updates |
| S5 | Column picker | `view_column` menu lists every column in the CSV in manifest order; `defaultVisible:false` columns start unchecked; toggling adds/removes columns live |
| S6 | Include-open toggle | Checkbox shows hidden-row count; checking → amber provisional banner ("returns are marks, not realized") + open/excluded rows appear italicized with amber status chips; unchecking hides them again |
| S7 | Empty filtered state | Filter to no rows → "No rows match the active filters." + count "0 of M" |
| S8 | Close/reopen resets | Close ✕ then open the same or another dataset → filters, sorts, and the open-rows toggle are all reset |

## Refinements during UAT

- **R3:** `GENERATED` label glued to its value — `.line-label` was
  64px, narrower than the uppercase label; widened to 72px.
- **R4:** Long card titles wrapped mid-token (`trailing-\n8`) — exit
  rule segment now `white-space: nowrap` so it breaks at the `·`
  separator instead.
- **R5 (functional):** the CSV load path used `getDownloadURL` →
  browser `fetch` to firebasestorage.googleapis.com — hung indefinitely
  on the QA machine (~950 ms RTT / lossy path; large response bodies
  stall). A `fetchDatasetCsv` callable was deployed (returned **200 in
  0.85 s** server-side) and the response *still* stalled client-side —
  so `loadDataset$` now reads a **Firestore chunk mirror**: the writer
  persists the CSV as `items/{id}/chunks/{i}` docs (~400 KB each,
  `{i, data}`, batched), the service concatenates them through the same
  Firestore channel every other read already uses, and the callable
  remains as fallback for pre-migration datasets. `deleteDataset$`
  removes chunk docs before the index doc. Deployed
  `analysisDatasetTask` 2026-10-20; `ds-20261020-replay-e1aded53`
  regenerated with the mirror (1 chunk / 42,361 B verified).
- **Logged (not fixed):** a dataset stuck at `generating` keeps the
  page's 5s poll alive indefinitely. The three `verify-1076-*` docs are
  BE relay artifacts — `verify-1076-enqueue` will never resolve.
  Candidates: stale-generating affordance, or task-level timeout on the
  BE side. Library-hygiene follow-up, not #1083 scope.
- **R6 (functional):** eager per-column `mat-select` filters froze the
  tab (hundreds of `mat-option` instances + per-CD `optionsFor`
  recompute). Filter controls moved to one lazy `mat-menu` per column
  behind a header `filter_list` icon — zero DOM cost until opened;
  active filters tint the icon. Spec-pinned.
- **R7 (functional):** the page was unbounded, so `.table-scroll`
  never got a scroll region. `.analysis-page` now uses the sibling
  `calc(100vh - var(--header-height))` convention; `.dataset-grid`
  scrolls in its own region; rows scroll under the sticky header.
- **R8 (functional):** sorting re-bound ~3,800 cells and Chrome's
  `width: max-content` measurement ground the tab. `tbody tr` now
  carries `content-visibility: auto` + `contain-intrinsic-size` so
  off-viewport rows skip layout/paint.
- **Logged (not fixed):** the library grid still competes with the
  workbench for vertical space — user flagged wanting real separation
  between dataset list and table UI. Layout follow-up, not #1083 scope.
- **Logged (not fixed):** column visibility should persist — user wants
  column-selection presets saved to localStorage so the picker isn't
  redone per session. Candidate for #1085 (slices) or a prefs follow-up.

## AC traceability

| AC | Scenario |
|---|---|
| Every manifest column renders, sorts, filters per kind | S1, S3, S4, S5 |
| Filtered count always visible; Reset restores unfiltered set | S4, S7 |
| Open rows displayable but never contaminate closed analysis by default | S2, S6 |
