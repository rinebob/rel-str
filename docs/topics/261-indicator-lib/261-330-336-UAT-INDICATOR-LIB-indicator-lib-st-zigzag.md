**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST ZigZag Indicator  
**Issue:** #330  
**Task:** #336  
**QA:** #363  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** UAT  
**Status:** Draft  
**Created:** 2026-09-15  
**Last Updated:** 2026-09-15  

---

# UAT: Swing Table Component (Task #336)

## Prerequisites

The swing table is a child component of the swing-analysis page
(separate task in Thread #322). Until that page lands, the table can
only be exercised through its unit tests or by hosting it in a
throwaway harness.

**When the swing-analysis page exists**, the user flow is:

1. Navigate to `/savant-trader/swing-analysis`
2. Enter a symbol (e.g., `AAPL`)
3. Adjust ZigZag params if desired (devThreshold, leftDepth, rightDepth)
4. Swings compute and flow into the table

Until then, this doc describes **what to expect** when the table is
rendered with swings, and how to verify it.

---

## What renders in the UI

### 1. Filters bar

Above the table, a row of filter controls:

| Control | Type | Values |
|---|---|---|
| Direction | dropdown | All / Up / Down |
| Date From | date picker | any date |
| Date To | date picker | any date |
| Duration Min | number input | ≥ 0 |
| Duration Max | number input | ≥ 0 |
| Magnitude $ Min | number input | ≥ 0, step 0.01 |
| Magnitude $ Max | number input | ≥ 0, step 0.01 |

**Expected behavior:**
- Changing any filter immediately updates the table rows.
- "Direction = Up" shows only up-swings; "Down" shows only down-swings; "All" shows both.
- "Date From" filters out swings that start before the selected date.
- "Date To" filters out swings that end after the selected day (inclusive — a swing ending at 12:00 on the selected day is still shown).
- "Duration Min/Max" filter swings whose bar-count duration is outside the range.
- "Magnitude $ Min/Max" filter swings whose absolute price change is outside the range.
- Invalid numeric input (e.g., non-numeric characters) is ignored — no rows are silently removed.
- Empty numeric input clears that filter bound (treated as "no limit").

### 2. Table header — 10 sortable columns

| # | Column | Sorts by |
|---|---|---|
| 1 | `#` | Row index (1-based) |
| 2 | Direction | `up` / `down` alphabetically |
| 3 | Start Date | Swing start timestamp |
| 4 | End Date | Swing end timestamp |
| 5 | Duration | Bar count between pivots |
| 6 | Magnitude % | Percentage price change |
| 7 | Magnitude $ | Absolute price change |
| 8 | Start Price | Price at swing start |
| 9 | End Price | Price at swing end |
| 10 | Volume | Cumulative volume across swing bars |

**Expected behavior:**
- Click any header to sort ascending (▲ icon appears).
- Click the same header again to sort descending (▼ icon appears).
- Click a different header to switch sort column (resets to ascending).
- Default sort is `#` ascending (chronological order).

### 3. Table rows

Each row shows:
- `#` — 1-based row number
- Direction — `▲ up` (green) or `▼ down` (red) badge
- Start Date — formatted as `Mon DD, YYYY` (e.g., `Jan 01, 2023`)
- End Date — same format
- Duration — integer bar count
- Magnitude % — signed percentage, e.g., `+10.00%` (green) or `-5.00%` (red)
- Magnitude $ — absolute price change, e.g., `10.00`
- Start Price — 2 decimal places
- End Price — 2 decimal places
- Volume — comma-separated, e.g., `50,000`

### 4. Projected (current) swing — last row

The last row represents the developing/unconfirmed swing
(`confirmed: false`). It has distinct styling:
- Italic text
- Muted color
- Dashed left border (3px)

**Note:** This styling is applied based on `confirmed: false`, not
strictly "last row position." Under the default `#` sort, the projected
swing is the last row. If you sort by another column, the projected
swing keeps its styling wherever it lands in the sorted order.

### 5. Empty states

Three distinct empty states:

| Condition | What shows |
|---|---|
| No swings computed (no symbol entered) | Chart icon + "No swings — enter a symbol to compute pivots" |
| Swings exist but filters remove all rows | Filter icon + "No swings match the current filters" |
| Loading in progress | Spinner + "Loading swings…" |
| Error occurred | Error icon + the error message |

The table and filters are hidden during loading, error, and no-data
states. The filters are hidden during filtered-to-empty (only the
"no matches" message shows).

---

## UAT Test Cases

### TC-1: Table renders with swings

**Steps:**
1. Enter a symbol with enough price history (e.g., `AAPL`)
2. Wait for swings to compute

**Expected:**
- Table appears with all 10 columns
- One row per swing
- Last row has projected styling (italic, dashed border)

### TC-2: Sort by each column

**Steps:**
1. Click each column header
2. Click again to toggle direction

**Expected:**
- Rows reorder by the clicked column
- ▲ icon on ascending, ▼ on descending
- Clicking a new column resets to ascending

### TC-3: Filter by direction

**Steps:**
1. Set Direction dropdown to "Up"
2. Verify only up-swings show
3. Set to "Down"
4. Verify only down-swings show
5. Set to "All"
6. Verify all swings show

### TC-4: Filter by date range

**Steps:**
1. Set Date From to a date in the middle of the swing range
2. Verify swings starting before that date disappear
3. Set Date To to a later date
4. Verify swings ending after that day disappear
5. Set Date To to a date where a swing ends at noon that day
6. Verify that swing is still shown (end-of-day inclusive)

### TC-5: Filter by duration range

**Steps:**
1. Set Duration Min to 10
2. Verify swings shorter than 10 bars disappear
3. Set Duration Max to 30
4. Verify swings longer than 30 bars disappear

### TC-6: Filter by magnitude range

**Steps:**
1. Set Magnitude $ Min to 5.00
2. Verify swings with absolute magnitude below 5 disappear
3. Set Magnitude $ Max to 20.00
4. Verify swings with absolute magnitude above 20 disappear

### TC-7: Invalid filter input

**Steps:**
1. Type non-numeric characters into Duration Min (if the browser allows it)
2. Verify no rows disappear — the invalid input is ignored

### TC-8: Filtered to empty

**Steps:**
1. Set Duration Min to a value higher than any swing's duration
2. Verify all rows disappear
3. Verify "No swings match the current filters" message appears (not "enter a symbol")

### TC-9: Clear filters

**Steps:**
1. Apply several filters
2. Clear each filter input (set to empty / "All")
3. Verify all swings reappear

### TC-10: Loading state

**Steps:**
1. Enter a new symbol while data is loading

**Expected:**
- Spinner + "Loading swings…" appears
- Table and filters hidden

### TC-11: Error state

**Steps:**
1. Trigger an error (e.g., invalid symbol, network failure)

**Expected:**
- Error icon + error message appears
- Table and filters hidden

---

## Known limitations (current task scope)

- The swing-analysis host page is a separate task — the table cannot
  be exercised end-to-end until that page lands.
- The table does not persist filter state across page reloads.
- There is no "clear all filters" button — each filter must be
  cleared individually.
- The Magnitude % column has no filter (only Magnitude $).
- Date display uses the browser's local timezone; filter comparisons
  use UTC midnight. A swing near a day boundary may display in a
  different day than the filter expects in non-UTC timezones.
