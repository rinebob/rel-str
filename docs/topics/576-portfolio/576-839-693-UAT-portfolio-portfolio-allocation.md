**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Issue:** #839  
**Task:** #693  
**Topic Parent:** #576  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-08  

# UAT — Bucket-detail form factor: expandable inline rows

## Scope

Task #693 replaced the modal bucket-detail dialog with expandable inline
rows on the `/portfolio/allocation` **Buckets** tab. Clicking a bucket or
**Unassigned** name toggles a panel under the row showing a stats strip
(Target `pct% → $`, Exposure, Drift, Realized, Unrealized, Open/Closed)
and a positions mini-table (Instrument, Qty, Market value, Cost basis,
Unrealized) with a totals row. Retired rows expand inside the retired
section; **Cash** has no expand affordance; multiple rows can be open at
once. The detail dialog component is retained in the repo but is no
longer wired from this table.

Automated coverage (already green at review): 9 new expansion tests in
`allocation-buckets-table.component.spec.ts`; 158 allocation tests +
`tsc --noEmit` clean. This UAT covers live-data behavior and the
manual/visual checks the specs can't see.

## Prerequisites

- Dev server running: `npm start` (spawns Observation API on `:3456` +
  `ng serve` on `:4210`).
- Signed-in user with at least one Robinhood account holding **open
  positions**, and at least one bucket configured (scenarios create,
  retire, and delete a scratch bucket — do not use a bucket whose
  attribution you want to keep).
- Chrome/Edge devtools for the `aria-expanded` attribute check.
- For scenario 12 (account-switch carry-over): ≥2 accounts. If only one
  account exists, mark that step N/A.

## Start

1. Navigate to `http://localhost:4210/portfolio` (sign in if prompted).
2. Click **Allocations** in the header to reach `/portfolio/allocation`.
3. Stay on the **Buckets** subtab (default).

## Scenarios

### 1. Expand a bucket row

- **Start:** Buckets tab, ≥1 active bucket listed.
- **Steps:** Click a bucket's name (e.g., the button with testid
  `expand-{bucketId}`).
- **Expected:** A panel opens directly under the row. The chevron flips
  `▸` → `▾`. Devtools: the name button's `aria-expanded` is `"true"`.
- **Result:**

### 2. Panel contents — stats strip + mini-table

- **Steps:** With the panel open, inspect its contents.
- **Expected:**
  - Stats strip shows `Target {pct}% → {dollars}`, `Exposure`, `Drift`,
    `Realized`, `Unrealized`, `Open/Closed`.
  - Mini-table columns: Instrument, Qty, Market value, Cost basis,
    Unrealized — one row per position in the bucket — followed by a
    **Total** footer row summing Market value, Cost basis, Unrealized
    (Qty cell intentionally blank).
  - Negative P&L values render in the negative styling.
- **Result:**

### 3. Collapse

- **Steps:** Click the same bucket name again.
- **Expected:** Panel removed; chevron returns to `▸`;
  `aria-expanded="false"`.
- **Result:**

### 4. Unassigned row expands

- **Start:** At least one position has no bucket attribution (default
  state for untouched positions).
- **Steps:** Click **Unassigned** (button testid `expand-unassigned`) in
  the Buckets table.
- **Expected:** Panel opens listing all unattributed positions — the
  same set/count the **Positions** tab shows under its `Unassigned (n)`
  filter. Stats strip shows Exposure/Realized/Unrealized/Open-Closed;
  Target cells show `—`; Drift renders `$0.00` (see scenario 13).
- **Result:**

### 5. Dangling attribution lands in Unassigned

- **Start:** A bucket exists with ≥1 assigned position (use a scratch
  bucket — it will be deleted).
- **Steps:**
  1. In the **Positions** tab, use a row's `Move` button (or
     `assign-{instrumentId}`) to assign a position to the scratch
     bucket.
  2. Back on **Buckets**, click the scratch bucket's delete icon
     (testid `delete-{bucketId}`) and confirm — the tooltip says
     "Delete — contents return to Unassigned".
  3. Expand **Unassigned**.
- **Expected:** The previously assigned position now appears under
  Unassigned (attribution deleted/dangling → `isUnassignedRow` both
  ways). It does not silently vanish or stay listed under a ghost bucket.
- **Result:**

### 6. Retired bucket expands inside the retired section

- **Steps:**
  1. Retire a scratch bucket via its retire icon
     (`retire-{bucketId}`, confirm in dialog).
  2. Click the `▸ Retired (n)` toggle to open the retired section.
  3. Click the retired bucket's name.
- **Expected:** The retired bucket expands inline within the retired
  table — same panel layout (stats strip + mini-table/totals), rendered
  in the retired section's dimmed/italic style.
- **Result:**

### 7. Cash row has no expansion affordance

- **Steps:** Locate the **Cash** row; inspect and click its name cell.
- **Expected:** `Cash` renders as plain text — no button, no chevron,
  no `aria-expanded`; clicking does nothing.
- **Result:**

### 8. Multiple rows expanded simultaneously

- **Steps:** Expand two different rows (e.g., a bucket + Unassigned).
  Then collapse the first.
- **Expected:** Both panels stay open independently; collapsing one
  leaves the other expanded. Expansion state is per row.
- **Result:**

### 9. Live re-derivation on store change

- **Start:** A bucket expanded, containing ≥1 position.
- **Steps:** Switch to the **Positions** tab, use that position's `Move`
  button to move it to a different bucket or unassign it. Return to the
  **Buckets** tab.
- **Expected:** The still-expanded panel no longer lists the moved
  position; the totals row updated accordingly. (Panels re-derive from
  `positionsByRowKey` on store refresh — no stale membership.)
- **Result:**

### 10. Empty bucket state

- **Steps:** Create a new bucket (`create-bucket-btn`, any name/target),
  then expand it.
- **Expected:** Panel opens; stats strip shows zeros; instead of a
  mini-table it shows the dimmed **"No positions"** empty state.
- **Result:**

### 11. Detail dialog never opens

- **Steps:** Click bucket names and the Unassigned name repeatedly;
  also try rapidly double-clicking.
- **Expected:** Only inline expansion happens — no modal scrim, no
  dialog, no focus trap. (The old `openDetail` path is removed.)
- **Result:**

### 12. Expansion carries across account switches (documented behavior)

- **Start:** ≥2 accounts; expand a bucket row on account A.
- **Steps:** Switch to account B via the account pill, then back to A.
- **Expected:** On B, a row with the same positional `rowKey` may
  appear pre-expanded (state is keyed by bucket id / `'unassigned'`,
  intentionally not cleared — documented on `expandedIds`). Back on A
  the original row is still expanded. Judge whether it feels right in
  use (refinement item, not a defect gate).
- **Result:**

### 13. Refinement pass — visual containment

- **Steps:** With several panels open, inspect: expanded `td` styling,
  mini-table alignment, chevron convention vs the `▸/▾ Retired` toggle,
  narrow viewport (~800px), dark theme if available.
- **Expected:**
  - Panel cell has light `#fafafa` background **and a visible left
    border** — reads as "inside the row" (spec §4).
  - Numeric columns right-aligned; quantities to 2 decimals; totals row
    visually distinct.
  - Chevron orientation matches the retired-toggle convention.
  - Judge: Unassigned strip's hardcoded `Drift $0.00` — acceptable or
    should drift be hidden for non-bucket rows? (record decision as a
    finding if it should change)
- **Result:**

### 14. Regression — existing bucket behaviors

- **Steps:**
  1. Create a bucket (valid name + target) → appears in table.
  2. Edit it (`edit-{id}`) → rename/retarget persists.
  3. Set targets summing > 100% across buckets → `target-over-100`
     warning banner appears and is non-blocking.
  4. Retire the bucket → moves to Retired section.
  5. Retired toggle collapses/re-expands the section.
  6. Delete the retired bucket → gone entirely.
  7. Positions tab: `Unassigned (n)` count matches the number of
     position rows under the expanded Unassigned panel (shared
     `isUnassignedRow` predicate agreement).
- **Expected:** All behave as before; no console errors.
- **Result:**

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Click bucket name expands inline panel; chevron + `aria-expanded`; second click collapses | 1, 3 |
| Panel shows stats strip (Target pct→$, Exposure, Drift, Realized, Unrealized, Open/Closed) | 2 |
| Mini-table: Instrument, Qty, Market value, Cost basis, Unrealized + totals | 2 |
| Unassigned row expands to unattributed positions (incl. dangling) | 4, 5 |
| Retired rows expand within the collapsed retired section | 6 |
| Cash has no expand affordance | 7 |
| Multiple concurrent expansions, per-row state | 8 |
| Expanded content re-derives on store change | 9 |
| Empty bucket → explicit empty state | 10 |
| Detail dialog no longer opened from the table | 11 |
| Expansion state carry-over across accounts documented | 12 |
| Left-border containment + `pct → $` strip per spec | 13 |
| Create/edit/retire/delete, >100% warning, retired toggle intact | 14 |
| `isUnassignedRow` single shared predicate — tab counts agree | 14.7 |

## Regression / smoke

- Scenario 14 covers nearby surfaces: bucket CRUD, warning banner,
  retired section, Positions-tab Unassigned filter/count.
- Review findings re-verified: `positionsByRowKey` re-derivation (9),
  shared predicate agreement (14.7), left border + `pct → $` strip (13).
- Full jest suite must be green before ship — the 4 gallery-spec
  compile failures (`allOccurrences` refactor) were cleared during
  review pass 2 (7/7 gallery suites, 137 tests).

## Results log

Automated evidence: `npx jest allocation-buckets-table.component.spec.ts`
— 20/20 green 2026-10-06. The spec exercises the real component DOM
(`aria-expanded` attrs, panel/mini-table/totals markup, multi-expand,
Unassigned/retired/Cash/empty behaviors, re-derivation, no-dialog), so it
covers the mechanics of the flagged scenarios against fixture data; the
manual pass confirms them against live account data plus the visual and
multi-account items.

| # | Scenario | Result | Evidence | Date |
|---|---|---|---|---|
| 1 | Expand a bucket row | PASS (auto) | spec: `bucket name expands an inline panel with stats + the bucket positions — no dialog` | 2026-10-06 |
| 2 | Panel contents | PASS (auto) | spec: stats strip + `expanded mini-table shows column totals` + `fractional share quantities to 2 decimals` | 2026-10-06 |
| 3 | Collapse | PASS (auto) | spec: `a second name click collapses the panel` | 2026-10-06 |
| 4 | Unassigned expands | PASS (auto) | spec: `the Unassigned row expands to list unattributed positions` | 2026-10-06 |
| 5 | Dangling → Unassigned | PASS | user: assigned position to scratch bucket, deleted bucket, position lands under expanded Unassigned | 2026-10-08 |
| 6 | Retired expands | PASS (auto) | spec: `retired rows expand inside the retired section` | 2026-10-06 |
| 7 | Cash no expand | PASS (auto) | spec: `the Cash row has no expand affordance` | 2026-10-06 |
| 8 | Multiple expansions | PASS (auto) | spec: `multiple rows can be expanded at once` | 2026-10-06 |
| 9 | Live re-derivation | PASS (auto) | spec: `expanded panel re-derives when positions change — a moved position disappears` | 2026-10-06 |
| 10 | Empty bucket | PASS (auto) | spec: `an empty bucket expands to an empty state, not a blank panel` | 2026-10-06 |
| 11 | Dialog never opens | PASS (auto) | spec: name click asserts `dialog.open` not called | 2026-10-06 |
| 12 | Account-switch carry-over | PASS | user: expansion persists by row key across account switch and return — feels right | 2026-10-08 |
| 13 | Refinement pass | **PASS (re-verify)** — prior FAIL 2026-10-06 → findings routed: **(a)** page didn't scroll (interim shell had no scroll bound) — fixed by #779's page-host `calc(100vh − --header-height)` + `.table-wrap` row-scroll; **(b)** nested-wrapper look — fixed by the #779 visual-language migration + expando inset styling. User re-verified 2026-10-08: scrolls to bottom, inset reads inside-the-row, chevrons/alignment/totals good. Decision recorded: Unassigned `Drift $0.00` kept as-is. | 2026-10-08 |
| 14 | Regression | PASS | user: scratch bucket create/edit/retire/delete, >100% banner, Positions `Unassigned (n)` agrees with expanded panel | 2026-10-08 |
