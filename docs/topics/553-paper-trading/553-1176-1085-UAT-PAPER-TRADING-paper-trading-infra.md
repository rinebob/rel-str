# UAT — #1085 FE slices + compare mode

**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Analysis & Forensics  
**Thread Slug:** trade-analysis  
**Issue:** #1176  
**Thread Parent:** #1059  
**Topic Parent:** #553  
**Task:** #1085  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Scope

Save the workbench's active filter chain as a named slice, apply any
saved slice to any open dataset (missing-column predicates skipped with
a notice), manage slices from the library header (no apply when no
dataset is open), and compare mode: pick a second ready dataset →
side-by-side stats + overlaid histogram; clearing compare restores
single-dataset behavior.

## Prerequisites

- Dev server running (`npm start` → http://localhost:4200), signed in.
- DevTools console open — watch for errors throughout.
- Fixtures (verified 2026-10-21 via Firestore probe):

| Dataset | Id | Scope | Rows |
|---|---|---|---|
| AMAT | `ds-20261020-replay-e1aded53` | AMAT | 104 |
| QQQ | `ds-20261020-replay-745708e7` | QQQ | 115 |
| NFLX | `ds-20261020-replay-d660a830` | NFLX | 83 |
| STX | `ds-20261020-replay-ff2a68ff` | STX | 116 |

- Saved slices (pre-seeded): `v1-v2-longs-only` (signalType ∈ V1+V2
  LONG), `v1-v2-shorts-only` (signalType ∈ V1+V2 SHORT), and
  **`qa-mixed-cols`** — a QA seed whose chain is `direction ∈ LONG` +
  `ind.noSuchColumn range ≥ 1`. All four datasets share the identical
  45-column manifest, so a real missing-column predicate can only come
  from this crafted slice. Re-seed if absent:
  `cd functions && npx tsx ../.devin/tmp/qa-1085-seed-slice.ts`
- Note: no all-symbols dataset exists yet. AC1's "applies to an
  all-symbols dataset" is exercised cross-dataset (AMAT → QQQ): slices
  are column-keyed and dataset-agnostic, so identical manifests give
  identical semantics. Optionally generate an all-symbols replay via
  the run-config form (empty symbol scope) for literal coverage —
  optional, not required to pass.

## Start instructions

`npm start` → sign in → navigate to **Trade Analysis**
(`trading/analysis`, nav: …Analysis area). The page opens on the
**dataset library** — a horizontal strip of dataset cards (screenshot:
the four replay cards). Each card has **Open** · Tags/notes · Delete.

**UI map used below:**

- **Workbench** — the area that appears under the library when you
  click a card's **Open**. Header bar = dataset title (`SYMBOL ·
  exit-rule · id`) + `table | stats | histogram | scatter` tabs + a ✕
  (close) at the right.
- **Tools row** — the strip *directly under the workbench header*, above
  the table. Left side: **Save slice** button + **Slices (N)** menu
  button. Right side: skip notices + compare chip **or** the "Compare
  with…" picker — the right cluster wraps to a second line
  (right-aligned) at narrow widths. Only exists while a dataset is open.
- **Slices menu** — click the "Slices (N)" button → a dropdown panel
  listing each saved slice (name, `(n)` filter count, 🗑 delete). In the
  workbench each row is clickable = **apply**. In the library header the
  same menu is manage-only — no apply.
- **Column filter** — in the table, every filterable column header has a
  `filter_list` funnel icon → click → a panel opens: enum/string
  columns get a checkbox list (checking a box applies immediately),
  number columns get min/max inputs, date columns get from/to. Active
  filters show as removable chips above the table with a **Reset**
  button.

## Scenarios

1. **Tools row + menus present** — on the AMAT card, click **Open**.
   Expected: workbench opens on `table`; the tools row (under the header)
   shows "Save slice" (**disabled** — no filters yet), "Slices (3)",
   and right-aligned "Compare with…" picker. Click Slices (3) → panel
   lists `v1-v2-longs-only (1)`, `v1-v2-shorts-only (1)`,
   `qa-mixed-cols (2)`, each with a 🗑. Click away to close.
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
2. **Save a slice** — still on AMAT. In the `direction` column header
   click the funnel icon → check **long** only → click away (table
   narrows to longs; a `direction=long` chip appears). Now click
   **Save slice** (enabled) → inline inputs appear → type name
   `qa-longs`, note `qa` → click **Save**. Expected: form closes,
   toast confirms, "Slices (4)"; click Save slice again → name/note
   fields are **empty** (no stale draft).
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
3. **AC1 — slice applies cross-dataset, filters identically** — still
   on AMAT: click **Slices** → click the `v1-v2-longs-only` row (menu
   closes). Expected: table narrows to V1/V2 LONG signal types; a
   `signalType∈…` chip appears. Record the row count. Click the header
   ✕ to close AMAT → on the **QQQ** card click **Open** → apply the
   same slice the same way. Expected: QQQ narrows to its V1/V2 longs —
   identical predicate on a dataset the slice wasn't saved from.
   Result: **PASS** — user-verified, 2026-10-21 — identical predicate
   narrowed both datasets to V1/V2 longs (exact counts not logged)
4. **AC3 — missing-column predicate → skip notice, not silent drop** —
   still on QQQ: **Slices → `qa-mixed-cols`** → click it. Expected:
   (a) a snackbar names `ind.noSuchColumn` as skipped; (b) after the
   toast fades a persistent note remains in the tools row:
   "slice skipped columns: ind.noSuchColumn"; (c) the kept predicate
   `direction ∈ LONG` still filters — table shows longs only (not a
   silent no-op, and not silently narrowed by the dropped predicate).
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
5. **AC2 — compare mode: stats side-by-side + histogram overlay** —
   still on QQQ: click chips' **Reset** to clear filters → "Compare
   with…" picker → select **NFLX** (options are NFLX/STX/AMAT — **not**
   QQQ itself). Expected: picker is replaced by a chip
   "comparing: NFLX · ds-20261020-replay-d660a830" (+ spinner while the
   CSV loads). Click the `stats` tab → two stat blocks side-by-side,
   labeled `QQQ · ds-…e7` and `NFLX · ds-…30`. Click `histogram` → the
   overlay checkbox + chart legend read **"compare set"** (NOT "full
   set"); the NFLX distribution overlays the QQQ bars.
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
6. **Compare obeys the same filters + compare-side skip notice** — with
   the NFLX compare still active: `direction` funnel → check **long**.
   Expected: BOTH stat blocks recount to their longs; histogram overlay
   = filtered NFLX rows. Then **Slices → `qa-mixed-cols`** → apply →
   tools row shows TWO notes: "slice skipped columns: ind.noSuchColumn"
   AND "compare skipped columns: ind.noSuchColumn" (NFLX lacks it too).
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
7. **Self-compare impossible** — still QQQ↔NFLX: click the workbench ✕
   → on the **NFLX** card click **Open**. Expected: the compare chip is
   GONE (the store cleared it — no dataset-vs-itself) and the picker
   reappears listing QQQ/STX/AMAT.
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
8. **Clear compare restores single mode** — open QQQ again → pick
   **STX** in "Compare with…" → confirm chip + two-column stats →
   click the chip's **×**. Expected: chip reverts to the picker, stats
   back to one block, histogram overlay back to "full set".
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
9. **Manage-only library menu** — close the dataset (✕). In the library
   header (top-right, next to "+ New dataset") click **Slices (N)** →
   rows show name + count + 🗑 but NO clickable apply row. Click 🗑 on
   `qa-longs` → count decrements to 3. (Leave `qa-mixed-cols` — cleanup
   below.)
   Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
10. **Save-form edge cases** — open AMAT → Reset any filters → "Save
    slice" disabled. Set one filter → open the form → name blank →
    **Save** disabled. Type a name, press **Escape** (or Cancel) →
    reopen → both fields empty.
    Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21

## Refinement pass (UI/UX)

11. **Tools-row legibility** — at ~1440px: save form, menu, skip notes,
    picker/chip lay out without overlap or ugly wraps; skip notes read
    as notices (italic, error color, `role="status"`); slice menu
    items are keyboard-reachable (apply rows are `mat-menu-item` —
    arrow keys rove, Enter applies, menu closes; delete needs a
    pointer click — intentional for multi-delete).
    Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21
12. **Console clean** — throughout S1–S10: no console errors, no
    Firestore permission denials, no repeated slice reload loops.
    Result: **PASS** — user-verified on the dev server (localhost:4200), 2026-10-21

## Cleanup

- Delete the `qa-longs` slice (done inside S9 if executed).
- Remove the seeded slice: `cd functions && npx tsx
  ../.devin/tmp/qa-1085-seed-slice.ts --delete`
- Leave `v1-v2-longs-only` / `v1-v2-shorts-only` (real slices, keep).

## Traceability

| AC / spec item | Scenario |
|---|---|
| AC1 — slice saved on AMAT applies to another dataset, filters identically | 3 |
| AC2 — overlaid histograms + side-by-side stats | 5 |
| AC3 — missing column → skip notice, never silent (primary side) | 4 |
| AC3 — compare-side parity | 6 |
| save slice UI (name + note, disabled at empty chain, draft reset) | 2, 10 |
| apply any slice to the open dataset | 3, 4 |
| saved-slices menu in workbench | 1, 3 |
| manage-only menu in library header | 9 |
| compare picker = ready minus active; chip; ✕ clears | 5, 7, 8 |
| self-compare impossible | 7 |
| refinement: layout, a11y, console clean | 11, 12 |

## Regression smoke

- Table view unchanged under slices/compare: sort cycle, filter chips,
  include-open/excluded quarantine toggle, column picker. Result: **PASS** — user-verified, 2026-10-21
- Close/reopen a dataset resets filters + view to `table`; compare chip
  survives a primary swap as a fixed baseline (by design — new primary
  vs same compare target). Result: **PASS** — user-verified, 2026-10-21
- Histogram single-set overlay ("full set" label) still correct when no
  compare is active. Result: **PASS** — user-verified, 2026-10-21

## Defect found & fixed during QA

- **Compare picker wrapped flush-left** (reported during S1): at the
  ~1440px viewport the tools row wrapped and "Compare with…" landed
  left-aligned below the Slices button — the flex-grow `.tools-spacer`
  collapsed to zero width once the row overflowed, so nothing pushed
  the picker right on its wrapped line. Fix: replaced the spacer with a
  `.tools-right` cluster (`margin-left: auto` + `justify-content:
  flex-end`) containing both skip notes and the compare chip/select —
  the group stays right-aligned even on a wrapped second line.
  `workbench-tools.component.ts`; 128/128 touched-suite specs green.

## Automated evidence (supporting, not a substitute for the UI pass)

- `analysis` suites: 20/20, 479/479 specs — incl. store specs for
  missing-column skip (both sides), self-compare guard, A→B switch row
  clearing, delete-cancels-in-flight-compare, and page specs for save/
  apply/delete/compare wiring (run 2026-10-21, post round-2 review).
- `tsc --noEmit` clean on the changed surface; `ng build` (AOT) clean.
- Code review: [553-1080-1085-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md](553-1080-1085-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md) — PASS, 2 rounds.
