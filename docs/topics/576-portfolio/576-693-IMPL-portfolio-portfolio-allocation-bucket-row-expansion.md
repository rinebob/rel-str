# PRD/IMPL — #693 CHORE: Bucket-detail form factor → expandable rows

**Topic:** #576 Portfolio Allocation  
**Task:** #693  
**Type:** PRD + IMPL (chore — combined doc)  
**Status:** Design settled via grilling 2026-10-03  
**Origin:** Follow-on flagged during #591 UAT (QA #673) — the modal detail dialog works but the form factor is not loved.  

## Problem

The bucket-detail surface is a modal dialog (`AllocationBucketDetailDialogComponent`). Two concrete failings surfaced in UAT:

- **Modal blocks management** — assigning a position *out of* the viewed bucket requires closing the dialog and switching to the Positions tab. Detail view and management actions can't coexist.
- **Carousel hides the list** — positions render one card at a time; "what's in this bucket?" wants a list, not a slideshow.

## Decisions (grilled)

| Decision | Choice |
|---|---|
| Form factor | **Expandable row** in the buckets table — click the bucket name to toggle an inline panel beneath the row |
| Expanded content | **Stats strip + positions mini-table** — allocation view only |
| Position detail | None. This is an *allocation* view (which positions are in the bucket), not a position-detail surface. No fills, no chart, no per-position drill-down |
| Position symbol click | Reserved for a future position-detail dialog — **not implemented**; symbols render as plain text |
| Existing dialog | **Unwired** from this page — component + spec stay in the codebase for possible reuse on the portfolio page, but nothing on the Buckets tab opens it |
| Expand scope | Active buckets, **Unassigned** pseudo-row, and **retired** buckets. Cash row does not expand (no positions) |
| Multi-expand | Multiple rows may be expanded simultaneously |

## Acceptance criteria

- [ ] Clicking a bucket name toggles an inline expanded panel under its row (aria-expanded reflected; second click collapses)
- [ ] Expanded panel renders a stats strip (target, exposure, drift, realized/unrealized, open/closed) + positions mini-table: instrument, qty, market value, cost basis, unrealized P&L
- [ ] Unassigned row expands to list unattributed positions
- [ ] Retired rows (inside the collapsed retired section) expand to list historical positions
- [ ] Cash row has no expand affordance
- [ ] Multiple rows may be expanded at once; expansion state tracks per row id
- [ ] Empty bucket → expanded panel shows an empty state, not a blank panel
- [ ] Clicking a bucket name no longer opens `AllocationBucketDetailDialogComponent`; no trigger on this page opens it
- [ ] `openDetail` and the detail-dialog import removed from `allocation-buckets-table.component.ts`
- [ ] Dialog component files retained (unused) for possible portfolio-page reuse
- [ ] Existing behavior preserved: create/edit/retire/delete actions, ≥100% target warning, retired-section toggle, live re-derivation of expanded content when store state changes

## Implementation plan

All work is in `src/app/features/portfolio-dashboard/`.

### 1. `allocation-buckets-table.component.ts` — expansion mechanics

- Add `expandedIds = signal<Set<string>>()` — toggled by the name-link click (`toggleExpand(row)`); key = `rowKey(row)` (`bucket.id`, or `'unassigned'`).
- The shared `bucketRow` template renders a second `<tr>` after the data row when expanded, with a `<td colspan="10">` spanning the table. Retired rows reuse the same template → expansion works there for free.
- Name-link click changes from `openDetail(row)` → `toggleExpand(row)`; add `[attr.aria-expanded]` and a chevron affordance on the name (▸/▾, matching the retired-toggle convention already in this file).
- Cash row: no name-link render path anyway (kind-guarded), so it can't expand.
- Remove `openDetail`, the `AllocationBucketDetailDialogComponent` import, and `BucketDetailDialogData`.

### 2. Expanded panel content

- New private template or a small `allocation-bucket-expanded.component.ts`? — **inline template in the table component** keeps it simple; the panel is thin (~40 lines).
- Stats strip: reuse `fmtDollars`; show targetPct→targetDollars, exposure, drift, realized, unrealized, open/closed. For `unassigned` rows the stats already live on `row.stats` — same strip, no target line.
- Positions mini-table columns: Instrument | Qty | Market value | Cost basis | Unrealized. Instrument renders as plain text (future dialog hook — no affordance now).
- Data source per row kind:
  - `bucket` → `store.bucketDetail(accountNumber, bucketId)?.positions` — same selector the dialog uses, account captured from `selectedAccount()` at render (the table already reads it per write path).
  - `unassigned` → `store.positionsRows()` filtered to `bucketName === 'Unassigned'` (or `bucketId === null`) — the Positions tab uses the same derivation (`isUnassigned` predicate in `allocation-positions-table.component.ts`); mirror that predicate. Position fields: `row.position.{instrumentId,quantity,marketValue,costBasis,unrealizedPnl}` — verify field names against `PositionRow`.
- Negative P&L gets the existing `.neg` class convention; numbers use `fmt`.

### 3. `allocation-bucket-detail-dialog.component.ts` — unwired, retained

- No changes needed. Component + spec stay; the table stops importing it. Verify no other file opens it (grep for `AllocationBucketDetailDialogComponent`).

### 4. Styling

- Expanded `<td>` gets a light background + left border (visual containment), reusing the file's existing `data-kind`/`dim`/`neg` conventions.
- `.name-link` gains a chevron glyph state (`expanded` → `▾`, else `▸`).

## Test plan (TDD — spec-first)

In `allocation-buckets-table.component.spec.ts`:

- name click expands → panel row exists with stats strip + position rows for a bucket with positions
- second click collapses
- two rows can be expanded simultaneously
- Unassigned row expands → lists unassigned position(s)
- retired row expands (toggle retired section first)
- Cash row has no expand affordance
- empty bucket → empty-state text
- name click does NOT call `MatDialog.open` with `AllocationBucketDetailDialogComponent`
- store-state change re-derives the expanded panel (assign a position out → it disappears from the panel)

## Out of scope (explicitly)

- Per-position fills, trade chart, position-detail dialog (future task)
- Moving the dialog to the portfolio page (future reuse decision)
- Positions-tab changes — this is Buckets-tab only
