# UAT — #589 FE Buckets tab — unified table + dialogs

**Status:** Complete  
**Task:** #589  
**QA issue:** #631  
**Topic:** Portfolio Allocation (#576)  
**Thread:** #577  
**Blueprint:** #582 (FE)  
**Files:** `allocation-buckets-table.component.ts`, `allocation-bucket-dialog.component.ts`,
`allocation-page.component.ts` (Buckets subtab wiring)

## How to get there

`npm start` → log in → left nav → **Portfolio Allocation** → any account
tab → **Buckets** subtab.

## What to confirm

### 1. Table renders the merged rows

- One row per configured bucket: name, Target %, Target $, Exposure,
  Drift (signed, red/green), Realized, Unrealized, Open/Closed, Status.
- **Unassigned** row (no actions).
- **Cash** row pinned last — italic, dollar figure under the Exposure
  column; "diverge" note only if broker vs derived disagree.

### 2. Create bucket

- **New bucket** button (top-right of the pane) → dialog with name +
  Target % fields; Create disabled until name non-empty and 0–100.
- Save → row appears in the table.

### 3. Edit (rename + retarget in one dialog)

- Pencil icon on an ACTIVE bucket row → fields prefilled; changing only
  the name (or only the %) still saves; Save → row updates.

### 4. Retire

- Archive icon on an ACTIVE bucket → confirm dialog naming the bucket
  and saying retired buckets reject new attributions.
- Confirm → the row **leaves the main table** and lands in a collapsed
  **"Retired (N)"** section below it. Expand the toggle → stats still
  render (target %, exposure, P&L, counts) dimmed, no action buttons.
  Cancel → nothing changes.

### 4b. Delete

- Trash icon on ACTIVE rows (and on rows inside the expanded Retired
  section) → confirm dialog names the bucket and says positions/fills
  return to Unassigned, no history remains.
- Confirm → the bucket row is gone entirely; anything it owned shows up
  under **Unassigned** (check the Positions subtab too — instruments
  flip back to Unassigned).
- **Note:** unlike retire, delete is destructive — the bucket's history
  row is gone for good.

### 5. Over-100% warn

- Create/edit buckets so active targets sum > 100% → amber banner
  "Targets sum to N% … over 100%." It warns but never blocks anything.
  Retired buckets don't count toward the sum.
- Bring targets back ≤ 100% → banner clears.

### 6. Write-failure surface (dialog stays open)

- Try to create a bucket with a name that already exists → the dialog
  **stays open**, shows a red inline error ("Bucket name conflict…"),
  Save re-enables. Fix the name → Create succeeds → dialog closes.
- Dialog only closes on success or Cancel — a spinner shows on the
  button while the write is in flight.

### 7. Per-account scoping

- Buckets you create belong to the selected account — switch account
  tabs and they're absent there (each account independent).

### 8. Look & feel (refinement)

- Column alignment, signed drift colors, warn banner readability.
  Judged as functional UI — real polish lands with #590/#591.
