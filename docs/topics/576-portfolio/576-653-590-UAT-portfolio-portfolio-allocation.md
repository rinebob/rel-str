# UAT — #590 FE Positions tab + assign-bucket dialog

**Status:** Complete  
**Task:** #590  
**QA issue:** #653  
**Topic:** Portfolio Allocation (#576)  
**Blueprint:** #582  
**Date:** 2026-09-28

## Navigation

Dev server → **Allocation Manager** in the nav (same page as #588/#589)
→ pick an account tab → **Positions** subtab (second tab, next to
Buckets).

## What to confirm

### 1. Every position shows its bucket

- Each open position row shows instrument id, market value, and its
  bucket name — `Unassigned` (dimmed) when it has no attribution.
- Multi-leg positions (e.g. spreads placed as one order) show a small
  **link icon** next to the bucket name.

### 2. Unassigned filter

- Toggle `All | Unassigned (N)` — the count matches the header's
  Unassigned total, and the filtered view shows **exactly** the
  unattributed positions.

### 3. Assign — the main flow

- `Assign` on an unassigned row → picker lists your **ACTIVE buckets
  only** (retired ones never appear) plus an Unassigned option.
- Pick a bucket → Assign → dialog closes, the row updates in place to
  show the bucket name. Check the Buckets tab — that bucket's exposure /
  open count went up, Unassigned's went down.

### 4. Move

- `Move` on an already-assigned row → the current bucket is preselected
  in the picker; picking a different bucket → Move → row shows the new
  bucket. Re-picking the same bucket is disabled (no write).
- Linked positions show a "every leg moves together" note — confirm
  sibling legs moved too (same bucket, both rows).

### 5. Unassign

- Pick `Unassigned` on an assigned row → row returns to Unassigned;
  both subtabs' counts update.

### 6. Failure stays in the dialog

- Same convention as #589 — if a write fails the dialog stays open with
  the error inline; it only closes on success or Cancel.

### 6b. Bulk assign

- Check a few positions (checkbox column, left of Instrument) → a
  "N selected + Actions" bar appears top-right. Header checkbox selects
  only what's visible — try it under the Unassigned filter.
- **Actions → Assign to bucket…** → picker opens titled "Assign N
  positions" (no preselected bucket — selection is mixed). Pick a bucket
  → all checked rows show it, and the selection clears.
- **Actions → Unassign** → checked rows return to Unassigned, no dialog.
- A checked spread still carries its link icon — bulk-assigning one leg
  of a linked order moves the legs together.

### 7. Non-agentic account

- Repeat assign/move on an account marked non-agentic — identical
  behavior (manual-only path, nothing gated).

## Known non-issues

- 'Unknown bucket' row (dangling attribution after out-of-band bucket
  deletion) counts under Unassigned and is reachable via the filter.
