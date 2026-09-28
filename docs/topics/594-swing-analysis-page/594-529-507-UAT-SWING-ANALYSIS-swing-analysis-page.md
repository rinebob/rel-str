**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #529  
**Blueprint:** #506  
**Task:** #507, #508, #509 (shared QA issue)  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# UAT â€” #506 Symbol picker + company info header (tasks #507/#508/#509)

## How to get there

`npm start` â†’ log in â†’ navigate to the Swing Analysis page (savant-trader
route `/swing-analysis`). The page loads the default symbol and enters
fullscreen; the nav row (prev / picker / next / position / filter / chips)
sits directly above the chart, and the company-info strip sits in the page
header next to the title.

## What to confirm

### S1 â€” Company info strip renders all fields (#508)

- [x] The header shows `TICKER â€” Company Name` followed by inline fields:
  `Sector`, `Industry`, `Exch`, `Cap`, `Tier`, `Î²`, `P/E`, `52w`, `MA50`,
  `MA200`, `Yield` â€” small muted label + value per field.
- [x] Fields wrap cleanly if the strip exceeds header width (no overlap,
  no truncation of the page title).

### S2 â€” Missing-profile fallback (#508)

- [x] Pick a tracked symbol that has no synced profile (e.g. a newly added
  ticker the profile sync hasn't covered). The strip shows just the ticker
  (no partner display name) and every field renders `â€”`.
- [x] A partially-populated profile shows real values where present and
  `â€”` for the missing fields only.

### S3 â€” Strip updates on every setSymbol path, never blocks (#507/#508)

- [x] Click nav **next** â€” strip updates to the new symbol's profile
  immediately; the chart still renders/animates normally.
- [x] Change the nav-filter select (e.g. All symbols â†’ a watchlist) â€” the
  sequence jumps to the first member and the strip follows.
- [x] Commit a symbol via the picker (see S5) â€” strip follows.
- [x] At no point does the strip delay or block the chart load â€” if
  profiles are still fetching, the ticker + dashes show meanwhile.

### S4 â€” Profiles load once per session (#507)

- [x] Open DevTools â†’ Network, filter `signal`/`getAllSymbols` (or the
  callable that backs `signalService.getAllSymbols`). Reload the page:
  exactly **one** profiles request fires.
- [x] Navigate to another page and back to Swing Analysis: **no second**
  profiles request â€” `loadProfiles()` no-ops once warm.
- [x] Reload the full page: the fetch runs again once (fresh session).

### S5 â€” Picker basics (#509)

- [x] A text input sits between the **prev** and **next** buttons showing
  the current symbol; clicking/focusing it opens a dropdown.
- [x] Options render as `TICKER â€” Company Name` for every tracked symbol.
- [x] Typing filters the list by **ticker** substring (e.g. `aa` â†’ matches
  AAPL/AALâ€¦) AND by **company name** substring (e.g. `apple` â†’ AAPL).

### S6 â€” Picker commit paths (#509)

- [x] Type an exact tracked ticker (e.g. `msft`, lowercase) + Enter â†’
  page navigates to MSFT; input reverts to display the committed symbol.
- [x] Type a name substring that uniquely matches one tracked symbol (e.g.
  `microsoft` when only MSFT matches) + Enter â†’ commits that symbol.
- [x] Highlight a dropdown option with arrow keys + Enter â†’ the
  highlighted option wins over raw text.

### S7 â€” Picker revert paths (#509)

- [x] Type an untracked ticker (e.g. `ZZZZ`) + Enter â†’ input reverts to
  the current symbol, no navigation.
- [x] Type garbage (e.g. `!!`) â†’ Esc â†’ input reverts AND loses focus.
- [x] Type anything â†’ click elsewhere (blur without Enter) â†’ input
  reverts to the current symbol.
- [x] Type a substring matching multiple tracked symbols + Enter â†’
  reverts (no ambiguous commit).

### S8 â€” Picker disabled while universe loading (#509)

- [x] Throttle network (DevTools â†’ Slow 3G), reload: while trackedSymbols
  is empty the picker input is disabled; once the universe lands it
  enables.

### S9 â€” Dialog symbol input removed (#509)

- [x] Open the settings dialog (âš™). There is **no** free-text Symbol
  input â€” the only entry points are the nav picker and prev/next.

### S10 â€” Regression: nav sequence + triage chips (#451/#461)

- [x] Prev/next still step through the filtered sequence and wrap at the
  ends; position indicator shows `N of M`.
- [x] Watchlist filter narrows the sequence to list members; `Not
  triaged` covers tracked symbols in zero exclusive lists.
- [x] Triage chips under the nav row still file the viewed symbol.
- [x] Chart, swing table, stats panel, settings dialog â€” all behave as
  before (covered by #609 UAT for config-manager behavior).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| #507 profiles/profilesLoading state, profilesBySymbol Map | S3, S4 |
| #507 loadProfiles no-ops when warm; single fetch | S4 |
| #507 slice spec coverage | `npx jest` (automated) |
| #508 all fields inline | S1 |
| #508 missing â†’ em-dash; absent profile â†’ ticker + dashes | S2 |
| #508 updates on every setSymbol path; never blocks | S3 |
| #509 input between prev/next; dropdown on focus | S5 |
| #509 ticker AND name match; TICKER â€” Name rendering | S5 |
| #509 untracked reverts; Esc reverts; disabled while loading | S6â€“S8 |
| #509 settings-dialog symbol input removed | S9 |

## Automated evidence

- `npx jest swing-analysis` â€” all suites green on the ship candidate
  (working tree with #507â€“509 changes present).

## Findings

- None — user-verified pass on all scenarios, 2026-09-28.
