**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1399  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1362  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — Task #1362: Picker dialog — rows tab + lines preview

Scope: the full contract-list picker dialog — provenance header, Rows tab
(per-row checkboxes, toolbar selection ops, disabled no-selection markers,
↻ repeat badges), live `N rows → M unique` readout, Lines preview + Copy,
loading/error/empty states, and the stay-open Send → pairs textarea →
`loadPlotted` handoff (dialog remains open; `onSend` callback via
`DS_DIALOG_DATA`). Includes the pass-2 review fixes: picker dedupe,
destroy-time `closeAll`, check-before-write emit guard.

## Prerequisites

- `npx ng serve` running (or prod on another port); authenticated user.
- Firestore reachable — the picker reads the saved list docs.
- Seed docs (already in Firestore, ids verbatim):
  - `2026-11-01_sun_105552_manual_anjw5z_QQQ` — `csp-45-20`, QQQ, **204 picks / 4 misses** (primary doc).
  - `2026-11-01_sun_102702_manual_0mgcz0_QQQ` — `failed` status doc (error path).
- Any bogus id (e.g. `zzz-bogus`) exercises the not-found path.

## Start

1. `npx ng serve` → open `http://localhost:4200/options/chart` (symbol defaults to QQQ).
2. Fastest entry: navigate to
   `http://localhost:4200/options/chart?list=2026-11-01_sun_105552_manual_anjw5z_QQQ`
   — the picker opens directly. Alternative: open the right drawer → **Lists…** → pick the `csp-45-20 · QQQ` row → picker opens; an **Open picker** button appears in the drawer's Contract list section once a session is active.

## Functional scenarios

### S1 — Picker opens populated; first-10 checked

- **Feature:** provenance header + default selection.
- **Steps:** use the `?list=` deep link above.
- **Expected:** dialog ~85vw×85vh centered on a dark backdrop. Header line
  reads `csp-45-20 · QQQ · 2026-11-01 · 204 picks · 4 misses ·
  {firstDate} → {lastDate} · grid v{n}`. Readout: `10 rows selected →
  M unique contracts` (M ≤ 10 — repeat contractIds dedupe). The first
  10 *pick* rows are checked; the 4 greyed `no-selection` rows are not.
- **Result:** PASS — user-verified live 2026-11-05

### S2 — Toolbar ops

- **Feature:** every op replaces the selection observably.
- **Steps** (after each, note the readout + checked rows):
  1. **All** → `204 rows selected`.
  2. **None** → `0 rows selected`, Send disabled, footer reads `Send 0 rows`.
  3. **Invert** → `204 rows selected` (was 0).
  4. **None**, then stride k=`5` → **Select** → every 5th pick row checked (~41 rows).
  5. **None**, then random N=`10` → **Pick** → exactly 10 rows checked.
  6. **None**, then range from `{firstDate}` to `{firstDate+7d}` → **Range** → only rows in that span checked.
  7. **None**, then filter text `P00` (or a strike substring visible in the table) → **Filter** → only matching contractIds checked.
- **Expected:** each op's readout matches the rule; counts match visible checkmarks.
- **Result:** PASS — user-verified live 2026-11-05

### S3 — Ops compose with manual toggles

- **Feature:** toolbar ops and checkbox clicks share one selection.
- **Steps:** Random N=10 → Pick; uncheck 2 rows by hand → readout drops
  to `8 rows selected`; **Invert** → `196 rows selected`.
- **Result:** PASS — user-verified live 2026-11-05

### S4 — no-selection rows

- **Feature:** markers are visible, disabled, unselectable, never emitted.
- **Steps:** scroll to a `No pick —` row (4 in the doc). Its checkbox is
  disabled; the row is greyed; the reason text shows `(miss)` etc. Click
  **All**, switch to the Lines tab → no line exists for a marker date.
- **Result:** PASS — user-verified live 2026-11-05

### S5 — ↻ repeat badge + unique dedupe

- **Feature:** repeated contractIds show a badge and count once.
- **Steps:** find a row whose contractId equals the previous day's (the
  `↻ repeat` badge marks it). Check only that row and its predecessor →
  readout `2 rows selected → 1 unique contracts`.
- **Result:** PASS — user-verified live 2026-11-05

### S6 — Lines tab === emit output + Copy

- **Feature:** preview is the exact payload.
- **Steps:** select a contiguous range spanning a repeat pair (e.g.
  Range over 3 days that include a `↻ repeat` row) → Lines tab: one
  `YYYY-MM-DD,CONTRACTID` line per checked row, **including the
  duplicate contractId on its second date**. Click **Copy** → button
  flashes "Copied"; paste into a text editor → identical lines.
  Select **None** → Lines tab shows `No rows selected — check rows on
  the Rows tab.` and Copy is disabled.
- **Result:** PASS — user-verified live 2026-11-05

### S7 — Send stays open and loads behind it

- **Feature:** the core handoff.
- **Steps:** pick ~10 rows → **Send 10 rows to chart**.
- **Expected:** the dialog **stays open**; behind it the pairs textarea
  contains the emitted lines and the chart loads one series per unique
  contract (progress indicator may flash). Send again after changing the
  selection → the plotted set **replaces** (no merge).
- **Result:** PASS — user-verified live 2026-11-05

### S8 — Reopen preserves selection

- **Feature:** session persistence across close→open.
- **Steps:** apply Invert (or any non-default selection) → **Close** →
  drawer → **Open picker** → same selection and chunk cursor restored;
  no reload spinner.
- **Result:** PASS — user-verified live 2026-11-05

### S9 — `?list=` while picker open does not stack

- **Feature:** pass-2 dedupe.
- **Steps:** with the picker open, navigate to
  `http://localhost:4200/options/chart?list=2026-11-01_sun_105552_manual_anjw5z_QQQ`
  (same tab — edit the URL).
- **Expected:** still exactly one picker dialog (no stacked overlay /
  double-dark backdrop); its contents refresh to the newly applied doc.
- **Result:** PASS — user-verified live 2026-11-05

### S10 — >50 send confirm on top of picker

- **Feature:** the large-list confirm layers correctly.
- **Steps:** select **All** (204 rows) → **Send** → a confirm dialog
  appears **on top of** the picker. Press **Escape** → only the confirm
  closes; the picker stays open and nothing loads. Re-open Send →
  confirm → **Load** → plotted set loads while both dialogs were open;
  picker remains.
- **Result:** PASS — user-verified live 2026-11-05

### S11 — Navigation with picker open leaves no zombie

- **Feature:** pass-2 destroy fix.
- **Steps:** with the picker open, press the browser **Back** button.
- **Expected:** the overlay closes with the route; the destination page
  has no floating dialog. Navigate back to `/options/chart` — page is
  clean (no dead picker, textarea state is fresh).
- **Result:** PASS — user-verified live 2026-11-05

### S12 — Loading / error / empty states

- **Feature:** distinct store-state renders.
- **Steps:**
  1. With the picker open, switch the page symbol to one with no saved
     session (e.g. SPY if untouched) → picker shows `No active list —
     pick one from Lists… in the drawer.` (empty state).
  2. While picker is open, fire a `?list=` nav → `Loading list…` renders
     during the read (fast — may need DevTools throttling to observe).
  3. A doc that fails session validation (cross-symbol or failed status,
     e.g. `?list=2026-11-01_sun_102702_manual_0mgcz0_QQQ` — note: the
     page rejects this **before** opening the picker, so the error shows
     as the page's flag-chip `Contract list "…" has status "failed": …`
     with the picker untouched/not opened).
- **Expected:** each state renders distinctly; error state names the reason.
- **Result:** PASS — user-verified live 2026-11-05

## Refinement pass (manual, live app)

- 85vw×85vh sizing on a desktop viewport; table scrolls with the sticky
  header; toolbar wraps acceptably as the window narrows; Rows/Lines
  tabs read in the `dse-tabs` style; arrow-key tab nav works
  (Left/Right/Home/End).
- Light + dark themes: selected-row tint, greyed marker rows, `↻
  repeat` badge contrast (accent-container pair), lines-preview
  background.
- Repeat Sends replace the plotted set (no stacking/merge); a >50 send
  shows the confirm on top; copy button feedback reads correctly.

## Traceability

| AC / check | Scenario |
|---|---|
| Opens populated; first-10 checked | S1 |
| Every toolbar op; ops compose w/ manual | S2, S3 |
| no-selection greyed/disabled/reason/never emitted | S4 |
| Readout live; M = distinct contractIds | S1–S3, S5 |
| Lines === emit (duplicates); Copy | S6 |
| Send → textarea + load; stays open; reopen preserves | S7, S8, S10 |
| loading/error/empty distinct | S12 |
| Pass-2 fixes: picker dedupe, zombie-dialog close | S9, S11 |
| Review findings (FE-4 `onSend`-only emit; #1392 extraction) | noted — no runtime check |

## Execution results log

- **Automated (2026-11-05):** `npx jest --coverage=false option-chart contract-list` —
  **10 suites / 137 tests PASS** — covers every AC at spec level incl.
  send-while-picker-open, picker dedupe, destroy-closeAll, NaN guards,
  `lastEmitted` reset.
- **Dev server:** `http://localhost:4200/options/chart` reachable (HTTP 200).
- **Manual scenarios S1–S12 + refinement pass:** **PASS** — user-driven live 2026-11-05; all scenarios verified on the real 204-pick/4-miss QQQ doc. One UX refinement raised during S2 (range-selection ergonomics) routed to a follow-on task — see Findings.

## Regression / smoke

- Paste `date,id` lines into the pairs textarea + Load → still plots
  (unchanged path).
- Generator drawer send still emits into the same textarea/load path.
- A >50-line paste triggers the same confirm dialog.
- Chips strip and rejected-token notice behave as before.
