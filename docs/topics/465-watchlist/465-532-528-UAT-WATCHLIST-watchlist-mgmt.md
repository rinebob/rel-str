**Topic:** Watchlist management  
**Topic Slug:** `watchlist-mgmt`  
**Issue:** #532  
**Blueprint:** #523  
**Task:** #528  
**Topic Parent:** #465  
**Domain:** WATCHLIST  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-28  
**Last Updated:** 2026-09-28  

# UAT â€” #528 Rewire surfaces to catalog + retire enum-era plumbing

Covers the catalog rewiring acceptance criteria plus the post-review icon
restore on the shared chip row (`symbol-list-actions`).

## How to get there

`npm start` â†’ log in. Surfaces under test:

- **Signal Review** â€” `/signal-review` â€” header list-filter dropdown,
  per-row triage chips, group-panel header chips, signal-detail toolbar chips.
- **Chart Review** â€” `/chart-review` â€” review-header list-filter dropdown,
  signal-detail toolbar chips.
- **Swing Analysis** â€” `/swing-analysis` â€” symbol-nav filter `<select>` +
  chip row under the nav row.

## What to confirm

### S1 â€” Dropdowns render identical grouped options (#528 AC1)

- [x] Signal-review header list dropdown shows `All`, a `Triage` optgroup
  (New symbols, Primary, Secondary, Neutral, Avoid, Hidden), `Not triaged`,
  then `My lists` (user lists) â€” same grouping on chart-review header and
  the swing-analysis nav `<select>` (with its `All symbols` sentinel).
- [x] No option renders a raw key or `undefined` label.

### S2 â€” Triage chips render as icons with per-list colors

- [x] Chip row shows icon buttons â€” not text pills: `fiber_new` (New),
  `star` (Primary), `visibility` (Secondary), `remove_circle_outline`
  (Neutral), `trending_down` (Avoid), `block` (Hide), `history` (Monitor).
- [x] Active chip shows its per-list color ring (Primary blue, Secondary
  purple, Neutral grey, Avoid orange, Hide red, Monitor teal); Monitor
  flips to `history_off` while active.
- [x] Tooltips show the list label on hover. Same icons on every surface
  (signal-review rows, group-panel header, signal-detail toolbar, swing
  nav chip row).

### S3 â€” Chip toggles persist (#528 regression)

- [x] Clicking a chip on a symbol files it into that exclusive list â€”
  the chip activates, and the symbol moves under the corresponding list
  filter. Clicking the same chip again unfiles it.
- [x] Filing into a different exclusive list strips the previous one.

### S4 â€” Role-aware "Not triaged" (#528 AC3)

- [x] Select `Not triaged` on signal review: only tracked symbols in zero
  exclusive lists show. A symbol in only MONITOR or a user list still
  appears (non-exclusive membership doesn't count as triaged).
- [x] A symbol filed into Primary disappears from the `Not triaged` view.

### S5 â€” Live user-list propagation (#528 AC4)

- [x] In Firestore, create a doc under `savant-trader/data/symbol-lists`
  (e.g. `{userId}_test-list`, role `nonexclusive`, order â‰¥ 100). It
  appears under `My lists` in all three dropdowns without a page reload.
- [x] Delete or rename it â€” the dropdowns update live.

### S6 â€” Deleted-list filter fallback (#528 AC5)

- [x] With a user-list filter selected, delete that list doc in Firestore:
  the signal-review filter resets to `All`; the swing-analysis nav filter
  resets to `All symbols`; the chart-review viewport silently shows
  everything (no crash, no stuck filter).

### S7 â€” Signal list renders on page load (regression guard)

- [x] Hard-reload `/signal-review`: the grouped signal list renders once
  data lands â€” not an empty page with fetched signals.
- [x] If the page ever shows empty under the default `Primary` filter,
  switching to `All` reveals the symbols (filter-state bug surface).

### S8 â€” Regression sweep

- [x] Signal review: group dimension switch (sector/industry/cap) regroups
  correctly; expand-all works; quick-chart prev/next steps through rows.
- [x] Chart review: list filter narrows the chart set; viewport paging
  unaffected.
- [x] Export (`Export list`) on a named list produces the TXT file.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| All three dropdowns render identical grouped options | S1 |
| Enum-era plumbing deleted (no runtime name-checks) | automated: `jest` + build |
| 'Not triaged' role-aware on every surface | S4 |
| User-list doc appears in every dropdown live | S5 |
| Deleted-list filter fallback | S6 |
| Icon chips restored (post-review fix) | S2 |
| Chip toggles still persist | S3 |

## Automated evidence

- `npx jest src/app/features/savant-trader` â€” 75 suites / 1,313 tests green
  on the ship candidate (working tree, 2026-09-28).

## Findings

- None — user-verified pass on all scenarios, 2026-09-28.
