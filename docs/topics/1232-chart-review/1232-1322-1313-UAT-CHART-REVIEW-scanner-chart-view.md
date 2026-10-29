**Topic:** Scanner Chart View  
**Topic Slug:** chart-review  
**Thread:** Chart View Extension  
**Thread Slug:** scanner-chart-view  
**Issue:** #1322  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1313  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# UAT — #1313 Pane enrichment (company names + row data)

CHORE: symbol-pane rows on `/trading/chart-view` gain a company-name line
and a recipe ranked-column detail. Resolution precedence: wire `Name`
column in the cached scan row → `SymbolListStore.profilesBySymbol`
(session-cached `st-symbols` bulk read) → ticker-only degrade.

## Scope / acceptance criteria

From issue #1313:

- AC1 — Scan pane rows show ticker + company name when resolvable;
  untracked names degrade gracefully to ticker-only
- AC2 — Name resolution is batched/reused (no per-row Firestore storm)
- AC3 — ≥1 recipe-relevant column value displayed alongside the ticker
- AC4 — Unit specs for resolution precedence + rendering

## Prerequisites

- Dev server on `http://localhost:4200` (`npm start`) — live during QA.
- Signed in; at least one cached scan in `st-scanner/latest-runs/items`
  (the same fixtures the #1258 UAT used — e.g. `near-52w-high`,
  `gainers`).
- Some pane symbols with resolvable names (tracked st-symbols docs or
  scan rows carrying `Name`) and some without.

## Scenarios

### S1 — Name + detail on a scan source *(live)*

- **Steps:** `/trading/chart-view` → Scan dropdown → pick a cached scan.
- **Expected:** every pane row shows `TICKER` on line 1 plus a
  right-aligned `{sort column}: {value}` detail (e.g.
  `Range pos: 97.5%`, `ROE: 14.9%`, `% Change: 3.2%`). Rows with a
  resolvable name show it on the second line; unresolvable rows stay
  ticker-only (no blank space, no "undefined").
- **Covers:** AC1, AC3.
- **Result:** **PASS** — user-observed live row: `LAMR / NEW / ROE: 58.9% / Lamar Advertising` — detail right of ticker, name on second line. LAMR untracked → name came from the wire `Name` column.

### S2 — Names on a list source *(live)*

- **Steps:** pick a **List** source (e.g. a tracked list or All).
- **Expected:** rows show company names where the st-symbols profile
  has one; no `{col}: {value}` detail (detail is scan-only).
- **Covers:** AC1 (list-source path, disclosed scope expansion).
- **Result:** **PASS** — user-confirmed 2026-10-28.

### S3 — Truncation + narrow-pane behavior *(live)*

- **Steps:** on a scan source, shrink the browser/narrow the pane if
  possible; observe long company names.
- **Expected:** names ellipsis-truncate (`nowrap` + `text-overflow`);
  the detail stays right-aligned and does not overlap the NEW chip or
  ticker.
- **Covers:** refinement pass.
- **Result:** **PASS** — user-confirmed 2026-10-28 ("everything looks great").

### S4 — No per-row fetch storm *(evidence: code + network)*

- **Steps:** open DevTools Network tab filtered to
  `firestore.googleapis.com`; reload the page; switch scan sources.
- **Expected:** ONE bulk `st-symbols` query per session
  (`loadProfiles`), not one doc read per pane row. The per-symbol
  `getDoc` only fires for the *selected* symbol (pre-existing toolbar
  name).
- **Covers:** AC2.
- **Result:** **PASS** — user-observed Network: fetches only for existing (tracked) symbols, none for new/untracked pane rows.

### S5 — Selection/dimming/NEW chips regression *(live)*

- **Steps:** click rows (dimming), select a symbol, toggle **New only**
  off/on, verify NEW chips on untracked rows.
- **Expected:** identical behavior to pre-#1313 — name/detail lines
  don't break click targets, dimming, chips, or selection.
- **Covers:** regression.
- **Result:** **PASS** — user-confirmed 2026-10-28.

### S6 — Unit specs — precedence + rendering *(automated)*

- `scanPaneMeta`: wire `Name` extraction, columnLookup canonicalization,
  blank cell → no detail, no-run/no-recipe, first-wins dedupe —
  `scanner-rows.util.spec.ts` (7 its).
- `paneRowMeta` precedence (wire > profile > ticker-only) + list-source
  names + `loadProfiles` called — `chart-view.component.spec.ts` (2 its).
- Row rendering + ticker-only degrade — `signal-list.component.spec.ts`
  (1 it).
- **Command:** `npx jest --coverage=false --testPathPatterns="scanner-rows|signal-list|chart-view"`.
- **Covers:** AC4 (+ AC1/AC2/AC3 at unit level).
- **Result:** **PASS** — 77/77 focused tests on the final tree
  (2026-10-28); full suite 275 suites / 4,757 tests green;
  `ng build` clean under `strictTemplates`.

## Traceability

| AC | Scenarios |
|---|---|
| AC1 names + degrade | S1, S2, S6 |
| AC2 batched resolution | S4, S6 |
| AC3 recipe-relevant detail | S1, S6 |
| AC4 unit specs | S6 |

## Regression checklist

- [x] S5 — selection, dimming, NEW chips, New-only toggle unchanged
- [x] Manual-symbol pane + history rows unchanged (row type added
  `name`/`detail` as optional — history rows render as before)
- [x] chart-review page unaffected (it doesn't bind `rowMeta`)

## Findings

- None. All 6 scenarios PASS.
