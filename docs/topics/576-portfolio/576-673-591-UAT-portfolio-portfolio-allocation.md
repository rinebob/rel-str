# UAT — #591 FE Bucket detail dialog

**Status:** Complete
**Task:** #591
**QA issue:** #673
**Topic:** Portfolio Allocation (#576)
**Date:** 2026-09-28

## Scope

Bucket detail dialog: opened by clicking a bucket name on the Buckets tab;
view-switcher dropdown; position carousel; per-position stats + recent
fills; bucket-level fills fallback when no open positions; trade-chart
stub; selector-driven live updates.

## Prerequisites

- `npm start` dev server; signed in; RH MCP local API up (127.0.0.1:3456).
- An account with at least one bucket; ideally ≥2 buckets and ≥2 positions
  attributed to a bucket (use Positions tab bulk-assign to seed).

## Scenarios

### 1. Open the dialog

Buckets tab → click a bucket **name**. Dialog opens (~560px): header
shows the bucket name in a dropdown + `target % · status` meta; stats
strip (exposure, target $, drift, realized, unrealized, open/closed).
Result:

### 2. Carousel

With ≥2 attributed positions: pager "1 of N", first instrument shown
with qty / market value / cost basis / unrealized. Click `›` → next
position, pager advances; `‹` at first position is disabled, `›` at last
is disabled. Result:

### 3. Per-position fills

Under a position that has traded: "recent fills" lines
(`side qty @ price · date`, newest first, max 5). Result:

### 4. View switcher

Pick a different bucket in the header dropdown — dialog stays open,
content swaps, carousel resets to position 1. Result:

### 5. Selector-driven live update

With the dialog open on bucket A: assign a position OUT of bucket A
(from another surface — e.g. a second dialog, or Positions tab before
opening) and re-open/observe — the carousel reflects current attribution.
**Quick check variant:** assign a position to bucket A on the Positions
tab, THEN open the dialog — the new member appears. (Modal backdrop
blocks in-app reassign while open; live-update is proven by spec +
open-observe.) Result:

### 6. Empty / retired / deleted

- Bucket with no positions: "No positions in this bucket" + any
  recent fills for flat-but-attributed instruments.
- Retired bucket row: name click works, "(retired)" suffix in dropdown.
- Delete the viewed bucket (from the table, dialog closed) then re-open
  attempts are gone; if deleted programmatically while open →
  "This bucket no longer exists" message.
Result:

### 7. Negative / boundary

- Bucket with 1 position: both carousel buttons disabled.
- Position with no fills: fills section hidden, chart stub still shows.
- Chart stub reads "Trade chart — spec TBD" — no fabricated content.
Result:

## Traceability

| AC | Scenario |
|---|---|
| Dialog opens per bucket | 1 |
| Carousel iterates all positions | 2, 7 |
| Dropdown switches without closing | 4 |
| Attribution changes reflect (selector-driven) | 5 |
| Trade-chart placeholder only | 7 |
| Positions AND orders listed (PRD) | 3, 6 |

## Result`n`nPASS � user-confirmed 2026-09-28. Follow-on noted: #693 (dialog form-factor refactor, design TBD � grill at pickup).
