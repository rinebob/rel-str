**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1379  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1360  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-02  
**Last Updated:** 2026-11-02  

# UAT — Task #1360: Marker model + decoupled underlying window

## Scope

This UAT covers the marker model and decoupled underlying window delivered by task #1360:

- Duplicate `date,contractId` lines fold to one contract with `markerDates` = union and `openDate` = earliest; bare `contractId` lines produce no markers.
- One span marker per contract with a dot per pick date and the span running earliest pick → expiration at strike (one series, no stacked lines).
- Dated loads set the underlying window to `[earliest pick − ~70 calendar days, today]` (~50 sessions of prefix); bare-id loads leave it unchanged.
- Clip (`displayWindow='position'`) clips contract marks only — `underlyingBars`, `underlyingWindow`, and underlying axis dates are untouched.
- Authoritative replace semantics: a new pasted list replaces marker dates (no ghost dots); same-list duplicates union.
- Focused/focused-removal paths, pad buttons, and failed contract loads can never silently narrow or destroy the set's context window.

## Prerequisites

- Dev server running at `http://localhost:4200` (`npm start` from repo root).
- Signed in with an existing account (route is behind `authGuard`).
- Backend services reachable — the page reads contract data via the partner endpoint and underlying bars from local Firestore. Use the same environment used for normal dev work.
- A symbol with contract corpus — **QQQ** is used throughout.
- Two real contract IDs for QQQ plus three valid pick dates inside their listed range. Obtain them on-page (Scenario 0) rather than trusting IDs from docs — the corpus changes.

## Start instructions

1. Browse to `http://localhost:4200/options/chart`.
2. The page loads with symbol `QQQ` (or set the symbol input to `QQQ` and let the underlying load).

## Scenario 0 — Inputs (verified against the live corpus 2026-11-02)

Use these verbatim — confirmed real via `queryContractCatalog`:

| Placeholder | Value | Notes |
|---|---|---|
| `ID_A` | `QQQ261016C00710000` | $710 call, exp 2026-10-16, observed 2026-03-24 → 2026-10-16, 144 obs |
| `ID_B` | `QQQ261016P00710000` | $710 put, same window, 140 obs |
| `D1` | `2026-05-01` | Friday — call delta 0.43 (near-ATM) |
| `D2` | `2026-08-03` | Monday — call delta 0.49 (ATM) |
| `D3` | `2026-09-01` | Tuesday — call delta 0.52 (ATM) |

QQQ rallied ~90 points across the window (K=710 call delta ran 0.11 → 0.68
through mid-year), so no single strike is ATM for the whole range. These
dates place every pick at/near the money for `ID_A` — verified against the
contract's own per-date delta from `getHistoricalOptionsContract`.

If the corpus has moved on when you run this, re-derive via the page's catalog query or:

```powershell
Invoke-RestMethod -Method Post -Uri 'https://us-central1-rel-str.cloudfunctions.net/queryContractCatalog' -ContentType 'application/json' -Body '{"data":{"symbol":"QQQ","expiration":"2026-10-16","pageSize":15}}'
```

Result: PASS — values verified against the live callable 2026-11-02.

## Scenario 1 — Duplicate lines fold; multi-dot span; bare id unmarked

**Feature:** parser fold + single-series multi-vertex span marker (AC 1, 2).

**Steps:**

1. In the pair textarea, paste exactly:
   ```
   2026-05-01,QQQ261016C00710000
   2026-08-03,QQQ261016C00710000
   2026-09-01,QQQ261016C00710000
   QQQ261016P00710000
   ```
   (or substitute fresh values from Scenario 0 — one `date,id` per line; `ID_B` bare with no date).
2. Click **Load**.

**Expected:**

- Two chips appear: `ID_A` showing earliest open date `D1`; `ID_B` with no open date.
- `ID_A`'s mark line plots; a dashed horizontal span-marker runs from `D1` to the contract's expiration at its strike, with **3 dots** (one per pick date) — a single marker series, not stacked lines.
- `ID_B` plots with **no** span marker and **no** dots.
- Rejected-lines readout is empty.

**Result:** PASS (2026-11-02)

## Scenario 2 — Context prefix on dated load

**Feature:** decoupled underlying window (AC 3, first half).

**Steps:** observe the chart from Scenario 1 (underlying overlay ON — default).

**Expected:** the underlying line/path is visible starting approximately **50 sessions (~70 calendar days) before D1**, continuing to today — the price action that produced the picks is on screen.

**Result:** PASS (2026-11-02)

## Scenario 3 — Bare-id load leaves the window alone

**Feature:** bare loads carry no context obligation (AC 3, second half).

**Steps:**

1. Clear the textarea, paste bare ids only:
   ```
   ID_A
   ID_B
   ```
2. Click **Load**.

**Expected:** both marks plot with no markers; the underlying overlay keeps whatever window it had — no jump to a dated prefix, no collapse.

**Result:** PASS (2026-11-02)

## Scenario 4 — Authoritative replace (no ghost dots)

**Feature:** successive `loadPlotted` lists replace marker dates (replace semantics).

**Steps:**

1. Re-paste the Scenario 1 list.
2. Then edit it to drop `D3`:
   ```
   D1,ID_A
   D2,ID_A
   ID_B
   ```
3. Click **Load**.

**Expected:** `ID_A` shows exactly **2 dots** (D1, D2) — the D3 vertex does not linger as a ghost marker.

**Result:** PASS (2026-11-02)

## Scenario 5 — Clip-to-entry cannot move the underlying (regression for the reported issue)

**Feature:** clip invariance (AC 4).

**Steps:**

1. With the dated set from Scenario 4 plotted, click the **Clip to entry** toggle (display window control in the chart toolbar) to `position`.

**Expected:** `ID_A`'s mark line clips to observations ≥ D1. The underlying overlay, its axis dates, and the left-edge prefix do **not** move — same domain before and after the toggle. Toggle back to `lifetime` — marks restore, domain still unchanged.

**Result:** PASS (2026-11-02)

## Scenario 6 — Single-contract view keeps the wide underlying window

**Feature:** context-clamped contract fetch, both edges (review finding 2-3 class).

**Vocabulary used here and in Scenario 7:**

- **Set view** — the chart showing every contract from your pasted list (all chips + all lines).
- **Single-contract (focused) view** — the chart showing just one contract, entered by clicking a catalog row or loading one bare id.
- **Context window** — the date span covered by the gray QQQ underlying line.
- **Prefix** — the stretch of that line *before* your earliest pick date (~50 sessions).
- **Tail** — the right end of that line, which should reach today.

**Steps:**

1. With the dated set plotted, click **Search Catalog** in the left panel (defaults are fine — symbol is already QQQ). The results table appears below the button.
2. Click any row in the table. (Alternative: paste one bare contract id you *know exists* — e.g., `QQQ261016P00715000` — and click **Load**. A single bare id takes the single-contract path.)

**Expected:**

- The chart switches to the single-contract view for that contract — only its line + the underlying draw.
- The chip strip swaps **immediately on click** — the set's chips are replaced right away by one chip for the incoming contract (spinner while it fetches, then its swatch matching the line color). The set's chips are hidden, not deleted — Loading the list again brings them back.
- Hovering the chip highlights its line; the ✕ on it drops focus and returns to the set view.
- The gray underlying line still covers the same span — prefix before D1 through today. The single-contract fetch can only *widen* that span, never shrink it.

*If the contract fails to load instead, that's Scenario 9 territory: the set should stay rendered with an error chip — the view must not strand on an empty pane.*

**Result:** PASS (2026-11-02, after fix). FAIL → filed **#1382**, three defects found and fixed: (1) `loadContractInternal` claimed `chartFocusContractId` at call time — a failed fetch stranded the view on an empty focused pane with the plotted set unreachable; focus now claims on intent and *releases on error* (guarded against stale in-flight failures). (2) The chip strip always rendered the plotted set even while focused — stale chips whose hover dimmed the focused line; it now mirrors the displayed contract(s) in both views. (3) Chips lingered through the fetch window — they now swap to the incoming contract's loading chip on intent. Specs cover claim/release timing, the stale-error race, focused chip mirror, foreign-focus chip synthesis, and swatch indexing.

## Scenario 7 — Back to the set; underlying window intact

**Feature:** context restore on unfocus / chip removal.

**Steps:**

1. From the single-contract view of Scenario 6, click **Load** on the pair textarea again (the pasted list is still there) — this returns to the set view.

**Expected:** all contracts from the list render again, and the gray underlying line covers the same date span as before — prefix and today's tail both there, nothing shortened. Same check if you remove a chip instead: the remaining set keeps the full span (and removing the chip you're focused on exits the single-contract view too).

**Result:** PASS (2026-11-02)

## Scenario 8 — Pad buttons never narrow the context

**Feature:** `+20d`/`+50d`/`Reset` clamp to the set's window on both edges (AC-adjacent; review finding 2-3).

**Steps:**

1. With the dated set plotted (and a contract having been loaded at least once so pad is enabled), click **+20d**, then **Reset**.

**Expected:** the underlying overlay may widen further left; it must never shrink below the set's prefix or lose today's tail. If the previously loaded contract was expired, its `endDate` does **not** truncate the right edge.

**Result:** PASS (2026-11-02)

## Scenario 9 — Failed contract load preserves the context

**Feature:** error-path bar preservation + set-symbol restore (review findings 2-1/2-4).

**Steps:**

1. With the dated set plotted, enter a malformed or nonexistent OCC id (e.g., `QQQ999999P00999999`) in the single-contract input and load it.

**Expected:** an error message appears; the underlying overlay and window do not blank or collapse — the set's context survives the failed load.

**Result:** PASS (2026-11-02)

## Scenario 10 — Round-trip: re-paste reproduces markers

**Feature:** deterministic rendering from the raw list.

**Steps:** reload the page, re-paste the Scenario 1 list, click **Load**.

**Expected:** identical chips, dots, span, and window — rendering derives fully from the pasted lines.

**Result:** PASS (2026-11-02)

## Negative / boundary scenarios

| # | Scenario | Expected |
|---|----------|----------|
| N-1 | Paste a line with an invalid date (`notadate,ID_A`) | Line lands in the rejected-lines readout naming the cause; chart unaffected for that row. |
| N-2 | Paste a contract for a different underlying (`SPY...` while set to QQQ) | Rejected as wrong-underlying; readout names it. |
| N-3 | Paste a single `D1,ID_A` (one date) | Single dot + span D1→expiration — byte-identical to pre-task single-date behavior (AC 6). |
| N-4 | Line with reversed/invalid order or junk text | Rejected; readout enumerates. |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Duplicate `date,id` lines fold; markerDates union; openDate earliest; bare id unmarked | 1 |
| d1/d2/d3 → 3 dots + one span, single marker series | 1 |
| Dated load sets `[earliest − ~70d, today]`; bare leaves window unchanged | 2, 3 |
| Clip clips contract marks only — underlying/axis unchanged | 5 |
| Replace semantics across loads; same-list union | 4, 1 |
| Single-date marker byte-identical | N-3 |
| Underlying fetch clamped on both edges (focused view, pads, restore) | 6, 7, 8 |
| Failed loads preserve context; restore fetches the set's symbol | 9 |
| Round-trip determinism (raw list → same markers) | 10 |

## Regression / smoke checklist

- [ ] Catalog query still populates and rows remain clickable (single-contract load unchanged).
- [ ] Greeks / Volume-OI lower panes still render for the single-contract view.
- [ ] Chip hover highlights the corresponding mark line; legend colors match mark/span colors.
- [ ] `Full history` button loads the deep underlying window.
- [ ] No console errors during the scenarios above.

## Known limitations carried into QA (not gate items)

- The chip strip wires hover + remove only; an explicit "back to set" affordance lands in #1362/#1363. Returning to the set view is via Load on the pair list or removing the focused chip.
- `contractData`-driven chrome (quality chips, header) can show the last-loaded contract's values while a set is displayed — tracked as a thread-level follow-up.
- `plottedLoadProgress` can read transiently wrong if two loads overlap — cosmetic.
