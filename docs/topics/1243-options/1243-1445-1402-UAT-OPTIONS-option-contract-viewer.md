**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** options  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1445  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1402  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-07  
**Last Updated:** 2026-11-07  

# UAT — #1402 FE Task: Picker UX batch — range UX + month shading + DOW/cadence + polish (chunk dates, strip removal)

Verifies the #1402 batch on top of the shipped #1419/#1420 picker:

- **Range UX** — the typed date inputs are gone; a `Range` button
  applies the chart-brush bound (`Select range`) to the selection.
- **Week shading** — alternating calendar-week (Mon–Sun) row tint on
  the Rows tab.
- **DOW + cadence** — Mo–Fr toggles + `Every wk / Every 2 wk /
  Every mo` preset that *selects* matching pick rows (replace
  semantics; manual checks compose after). **Biweekly anchors on the
  first pick row** — 7-day blocks, not calendar weeks: a Friday in
  the anchor's own week must be kept (the review-round bug).
- **Chunk dates** — Chunks readout shows `chunk i/n · start → end`.
- **Strip removal** — the page-level mini-controls are gone; the
  dialog's Send is the sole emit surface.

## Prerequisites

- Dev server at `http://localhost:4200` (`npm start`)
- List doc: `2026-11-06_fri_120138_manual_j9gqhh_QQQ` — QQQ, template
  `csp-45-20`, 212 picks / 0 misses, 2026-01-02 → 2026-11-05.
  **Its first pick is a Friday (2026-01-02)** — perfect for the
  non-Monday biweekly anchor cases. (Chooser `row-id` line shows
  current ids if this one was deleted by #1439 testing.)
- Getting to the feature: route `/options/chart` → either
  `?list={docId}` in the URL, or the page `Lists…` button → pick a
  row → dialog opens, or reopen an open session via the `Picker —
  N/M selected` button (contract header bar, next to `Select range`).
- **Fresh-default caveat:** a saved `rs-optlist:QQQ` session
  restores itself (correct). For fresh-path checks, clear Local
  Storage or use a never-opened list.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Range button — unbound | Open picker with NO range brushed on the chart → look at the toolbar | `Range` button present but **disabled**; tooltip says to brush a range first; zero `input[type=date]` controls anywhere in the dialog | |
| S2 | Range button — bound | Close picker → on the chart, use `Select range` and brush e.g. Mar→Apr 2026 → reopen picker → click `Range` | Button label shows `Range 2026-03-… → 2026-04-…`; click selects exactly pick rows inside the bound (inclusive ends); readout count matches a manual count | |
| S3 | Week shading | Rows tab → scroll a list spanning ≥2 weeks | Alternate Mon–Sun weeks carry a subtle band tint on both pick and `—` marker rows; a checked row on a banded week keeps its selection paint (check visually — band vs selected differ); repeat in the other theme | |
| S4 | DOW — single weekday | Check `Mo` only → `Days` | Only Monday pick rows check; readout = `N rows → M unique` | |
| S5 | DOW — multi + weekly | Check `Mo` + `Fr` → `Every wk` → `Days` | Every Monday AND Friday pick row checks (union) | |
| S6 | DOW — biweekly anchor | Keep `Mo`+`Fr` checked → `Every 2 wk` → `Days` | Anchor = first pick (**Fri 2026-01-02**): block 0 = 01-02…01-08 keeps BOTH Fri 01-02 and Mon 01-05; next block skips; alternating after. Spot-check: a Friday within ~7 days of the first pick MUST be checked — that was the review bug | |
| S7 | DOW — monthly | `Every mo` → `Days` | Only pick rows in the same week-of-month (days 1–7) as the first pick row check — e.g. with Fri 01-02 anchor, week-1 Fridays/Mondays/etc of later months only | |
| S8 | DOW — compose + no-op | After S6, manually check one extra row; then uncheck ALL toggles → `Days` | Manual row stays checked on top of the preset (toggle composes); with no weekdays the `Days` button is disabled / a no-op — the selection is NOT wiped | |
| S9 | Prefs survive failure | With DOW prefs set: navigate to `?list=<bogus-id>` (load fails) → reopen on a good list | The weekday toggles + cadence are still set — prefs are not session data and must not reset on failure | |
| S10 | Chunk dates | Chunks tab | Readout shows `chunk i/n · startDate → endDate · N days · M unique`; **last (partial) chunk shows its own last pick date**, not the doc's final date; dates update on step and on chunk-size change | |
| S11 | Strip removal + reopen placement | Look at the contract header bar | No old mini-controls strip (◀ i/n ▶ · size · All); the `Picker — N/M selected` button now sits **in the header bar** next to `Select range` (+ `Lists…`, `Open picker` empty-state). `All` + `Send` live inside the dialog | |
| S12 | Prefs persist | Set `Mo`+`Fr`/`Every 2 wk` → close picker → symbol swap SPY → back to QQQ → reopen | Toggles + cadence restore from `rs-optlist:QQQ` | |
| R1 | Selection ops regression | all / none / invert / stride / random / contains | Unchanged: ops check expected rows; `—` markers disabled; ↻n badges work | |
| R2 | Timeline regression (#1420) | Chunks → tick click; step | Ticks shade by selection, mint band = cursor, chunk-granular toggle, no emit while open | |
| R3 | Send → >50 confirm | `All` → Send → confirm dialog → Load | Picker closes first, confirm over page, Load plots (#1419 boundary) | |

## Refinement pass

- Toolbar crowding: DOW toggles + cadence select + `Days` at the
  dialog's width — no awkward wrap/overlap
- `.week-alt` tint visible-but-quiet in BOTH themes; checked rows
  and `—` marker rows stay readable on the band
- Header bar controls fit: Filter/History/Select range/Picker buttons
  no longer clip at the 28px bar height
- `Range` button's disabled/unbound state reads clearly; bound label
  isn't cramped (long `Range start → end` text)
- DOW toggle `on` state is obvious; `aria-pressed` toggles
- `Days` button title says it *replaces* the selection — expectation
  set before clicking

## Findings raised (out of #1402 scope)

- (none yet — record any here)

## Traceability

| AC | Scenarios |
|---|---|
| A1 — bound range applies inclusive | S2 |
| A2 — unbound disabled + explanation | S1 |
| A3 — mini-chart swiper | deferred (not tested) |
| B1 — week alternation, both themes | S3 |
| C1 — DOW multi-select | S4, S5 |
| C2 — cadence rules (weekly / anchor-7d / same-week-of-month) | S5, S6, S7 |
| C3 — replace semantics + compose | S5→S8 |
| C-prefs — persist + survive failure | S9, S12 |
| D1 — chunk start/end dates incl. partial tail | S10 |
| D2 — strip gone, reopen, All+Send in picker | S11, R3 |
| Date inputs removed | S1 |

## Automated evidence

- Review PASS doc (2 rounds): `1243-1359-1402-CODE-REVIEW-OPTIONS-option-contract-viewer.md`
- Focused sweep: 8 suites / 138 tests green; full suite 302/5,312
  green; `tsc --noEmit` clean; AOT dev build clean
- Key specs: inclusive `selectDateRange` bounds; biweekly
  multi-weekday `{06-01,06-05,06-15}` + non-Monday anchor
  `{06-05,06-19}`; monthly same-week-of-month; docId/selection/cursor
  blob preservation after explicit failure; `.chunk-info` rendered
  dates; cadence-select off-union guard; month-parity DOM spec

## Results log

| # | Result | Notes |
|---|---|---|
| S1 | PASS — user-verified live, 2026-11-07 | |
| S2 | PASS — user-verified live, 2026-11-07 | |
| S3 | PASS — user-verified live, 2026-11-07 | week cadence (post-pass delta — was month) |
| S4 | PASS — user-verified live, 2026-11-07 | |
| S5 | PASS — user-verified live, 2026-11-07 | |
| S6 | PASS — user-verified live, 2026-11-07 | |
| S7 | PASS — user-verified live, 2026-11-07 | |
| S8 | PASS — user-verified live, 2026-11-07 | |
| S9 | PASS — user-verified live, 2026-11-07 | |
| S10 | PASS — user-verified live, 2026-11-07 | |
| S11 | PASS — user-verified live, 2026-11-07 | button now in header bar |
| S12 | PASS — user-verified live, 2026-11-07 | |
| R1 | PASS — user-verified live, 2026-11-07 | |
| R2 | PASS — user-verified live, 2026-11-07 | |
| R3 | PASS — user-verified live, 2026-11-07 | |

## Post-pass deltas (user-verified as they landed)

Three UX changes were requested during the pass and folded in before
the verdict — S3/S11 and the refinement clip check above cover them:

- **Week shading** — row band cadence month → calendar week
  (`week-alt`/`weekParity`, Mon–Sun blocks via epoch-Monday index).
- **Picker button into the header bar** — `Picker — N/M selected`
  moved next to `Select range` (was a full-width block below the bar).
- **Header button clip fix** — `ds-btn` emits a fixed 32px height that
  `min-height` couldn't shrink inside the 28px bar; `.header-btn` and
  `.filter-dropdown-btn` now carry `height: 22px`.

A fourth delta landed **after** the pass verdict — a quick eyeball is
recommended before ship:

- **Rows-table column set** — order is now Entry, DOW, Und. Close,
  Δ, IV, Contract, Mark, Strike, Expiry, DTE, Bid, Ask, Vol, OI
  (DOW cell new; DTE/Bid/Ask/Vol/OI appended — the complete
  `PickDocDay` field list). Spec'd in the picker suite (37 green).
