**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1292  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1264  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-28  

## Scope

Task #1264 wired the multi-symbol input into `/options/chart`:

- The OCC input is a multiline textarea — bare IDs and `YYYY-MM-DD,<OCCID>` pairs (comma/space/tab), one per line.
- A single bare ID still loads the existing single-contract view; anything else goes through `loadPlotted`.
- Rejected tokens show a notice under the input (raw text + reason); valid entries still load.
- A chips strip above the chart lists every plotted contract — color swatch matching its series, readable label, open date, × to remove, hover/click to highlight its line (no refetch — all series stay rendered).
- `Loaded X / Y` progress shows while fetches are in flight.
- More than 50 valid entries triggers a confirmation before loading.
- The `Clip to entry` / `Full series` header button (from #1263) becomes live-exercisable — it appears when a displayed contract carries an open date. Default stays `lifetime`.

This UAT also closes out the live checks deferred from #1263's UAT (`1243-1287-1263-UAT-…`): span markers, multi-mode rendering, and the clip button — all now reachable through the paste input.

## Prerequisites

- Dev server running: `npm start` → http://localhost:4210
- Page calls production Firebase callables (dev env `useEmulators: false`) — network access required.
- Symbol left at `QQQ` for every scenario (the parser rejects other underlyings).
- Contract IDs below were verified against `queryContractCatalog` (QQQ, 1yr bucket) — all real, ~251 observations, first `2025-04-01`, last `2026-03-31`.

## Start

1. `npm start` at the repo root (if not already running).
2. Navigate to **http://localhost:4210/options/chart** (sidebar: Options → Chart).
3. Paste input = the "OCC Contract ID(s)" textarea in the left panel; **Load** button below it.

## Automated evidence (executed during implementation)

| Check | Command | Result |
|---|---|---|
| Page specs — pair-input dispatch (single bare → `loadContract`; pairs/multi → `loadPlotted`; rejection surfacing; all-rejected no-fetch; >50 confirm/decline), chip color/focus/remove | `npx jest src/app/features/savant-trader/pages/option-chart` | **PASS** — 18/18 tests |
| Focused area (chart component, stores, utils, page) | `npx jest src/app/features/savant-trader/pages/option-chart src/app/features/savant-trader/components/options-contract-chart src/app/features/savant-trader/stores src/app/features/savant-trader/utils` | **PASS** — 46/46 suites, 842 tests |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | **PASS** |
| Dev build (template check) | `npx ng build --configuration development` | **PASS** |

## Manual scenarios

### S1 — Single bare ID preserves the single-contract view

**Feature:** regression — one bare OCC ID loads the existing full-pane view.
1. Paste:

   ```text
   QQQ260331C00450000
   ```

2. **Expected:** one mark line + underlying overlay; IV/Greeks/Volume-OI panes render; **no chips strip**; no rejection notice; no clip button (no open date).
3. **Evidence:** **PASS** (2026-10-28, user-verified) — single bare ID loads the full single-contract view with all panes; no chips, no rejection notice.

### S2 — Pair list → chips strip + span markers

**Feature:** multi-line dated pairs load the plotted set (closes deferred #1263 checks S2/S4/S6/S7).
1. Paste:

   ```text
   2025-07-01,QQQ260331C00440000
   2025-09-15,QQQ260331C00450000
   QQQ260331P00455000
   ```

2. **Expected:** three mark lines on the union axis over the underlying; chips strip shows 3 chips with color swatches matching their series, labels `440C 2026-03-31` / `450C 2026-03-31` / `455P 2026-03-31`, open dates on the dated chips; the two dated contracts show strike-span markers with left dots at `2025-07-01` and `2025-09-15` ending at `2026-03-31`; the bare put has **no** marker; lower panes hidden (multi mode).
3. `Loaded X / Y` progress appears in the chips row while fetches run (fast with 3 — S7 makes it obvious).
4. **Evidence:** **PASS** (2026-10-28, user-verified) — 3-series set over the underlying, chips with matching swatches and labels, span markers on the two dated contracts, no marker on the bare put, lower panes hidden.

### S3 — Rejection notice; valid entries still load

**Feature:** bad tokens surface with reasons without blocking valid lines.
1. Paste:

   ```text
   2025-07-01,QQQ260331C00440000
   bogus
   06/15/2025,QQQ260331C00450000
   2025-09-15,SPY260331P00450000
   QQQ260331P00455000
   ```

2. **Expected:** notice under the input lists 3 skipped entries — `bogus` (invalid contract ID), `06/15/2025,…` (invalid date), `SPY…` (not a QQQ contract); the two valid lines load as chips; chart renders.
3. Load a clean input next — the notice clears.
4. **Evidence:** **PASS** (2026-10-28, user-verified) — 3 rejections listed with reasons (invalid ID, invalid date, wrong underlying); the 2 valid QQQ entries load as chips; notice clears on next load.

### S4 — All-rejected input

**Feature:** nothing fetches when every line is bad.
1. Paste only: `bogus` + `also-garbage` (one per line).
2. **Expected:** rejection notice lists both; no chips; no chart change; no loading indicator.
3. **Evidence:** **PASS** (2026-10-28, user-verified) — both tokens rejected with reasons; no chips, no fetch, chart unchanged.

### S5 — Chip hover / line highlight

**Feature:** hovering a chip highlights its line in the set — no drill-down, no refetch.
1. With the S2 set loaded, hover (or focus/click) the `440C` chip.
2. **Expected:** the 440C mark line thickens while the other series and markers dim; **all** series stay on the chart; the chip shows the highlighted border; no network request fires.
3. Move the pointer off the chip → every series returns to full weight.
4. **Evidence:** **PASS** (2026-10-28, user-verified) — chip hover/click thickens its line, other series and markers dim, all series stay rendered, no fetch; leaving the chip restores full weight. Replaces the original drill-down semantics per user direction during QA — `focusPlotted` is no longer invoked from chips (it remains for the `loadContract` single-view path).

### S6 — Chip remove

**Feature:** × drops a contract from the set.
1. Click × on one chip.
2. **Expected:** chip disappears; its series and marker leave the chart; remaining contracts unchanged. Removing the highlighted contract clears the highlight.
3. **Evidence:** **PASS** (2026-10-28, user-verified) — × removes the chip, its series and marker leave the chart, remaining contracts intact.

### S7 — Progress + >50 soft warning (closes deferred #1263 clip visibility at scale)

**Feature:** confirmation before a large load; `loaded / total` visible during fetch.
1. Paste the 51-ID block below and click **Load**:

   ```text
   QQQ260331C00440000
   QQQ260331C00445000
   QQQ260331C00450000
   QQQ260331C00455000
   QQQ260331C00460000
   QQQ260331C00465000
   QQQ260331C00470000
   QQQ260331C00475000
   QQQ260331C00480000
   QQQ260331C00485000
   QQQ260331C00490000
   QQQ260331P00440000
   QQQ260331P00445000
   QQQ260331P00450000
   QQQ260331P00455000
   QQQ260331P00460000
   QQQ260331P00465000
   QQQ260331P00470000
   QQQ260331P00475000
   QQQ260331P00480000
   QQQ260331P00485000
   QQQ260331P00490000
   QQQ260630C00400000
   QQQ260630C00405000
   QQQ260630C00410000
   QQQ260630C00415000
   QQQ260630C00420000
   QQQ260630C00425000
   QQQ260630C00430000
   QQQ260630C00435000
   QQQ260630C00440000
   QQQ260630C00445000
   QQQ260630C00450000
   QQQ260630C00455000
   QQQ260630C00460000
   QQQ260630C00465000
   QQQ260630C00470000
   QQQ260630C00475000
   QQQ260630C00480000
   QQQ260630C00485000
   QQQ260630C00490000
   QQQ260630C00495000
   QQQ260630C00500000
   QQQ260630C00505000
   QQQ260630C00510000
   QQQ260630C00515000
   QQQ260630C00520000
   QQQ260331C00400000
   QQQ260331C00405000
   QQQ260331C00410000
   QQQ260331C00415000
   ```

2. **Expected:** a dialog warns that 51 contracts may be slow — **Cancel** aborts (no chips, no fetch); re-**Load** → confirm → 51 chips appear, `Loaded X / 51` counts up during fetch, chart shows the set.
3. **Evidence:** **PASS** (2026-10-28, user-verified) — >50 warning fires; cancel aborts; confirm loads the batch with live `Loaded X / 51` progress.

### S8 — Clip to entry (closes deferred #1263 check S8)

**Feature:** display-window toggle in the contract header bar.
1. With the S2 set loaded, a **Clip to entry** button shows in the header bar (only when a displayed contract has an open date).
2. Click → the dated 440C/450C series clip at `2025-07-01`/`2025-09-15`; the bare 455P is unchanged; span markers unchanged; button reads **Full series**.
3. Click again → full series restored.
4. **Evidence:** **PASS** (2026-10-28, user-verified) — Clip to entry clips dated series at their open dates, bare contract unaffected; Full series restores.

### S9 — Input regressions

**Feature:** existing entry points unchanged.
1. Click a catalog result row → its ID fills the textarea and loads via the single-contract path (chips strip not involved unless the set is still populated).
2. Paste an ID that doesn't exist (e.g. `QQQ999999C00000000`) → backend error chip; not a parser rejection.
3. **Evidence:** **PASS** (2026-10-28, user-verified) — catalog row click loads single contract; unknown ID surfaces a backend error, not a parse rejection.

### S10 — Crosshair + panel collapse (QA refinement)

**Feature:** fixes applied during QA — crosshair floats free; panel toggle no longer overlaps the chips.
1. Move the pointer over the chart → the crosshair follows the pointer freely (no snapping to data values); the horizontal crosshair's price shows as a label on the right-edge (underlying) axis.
2. Collapse the left panel via the chevron inside the panel header → panel closes; reopen via the `chevron_right` button in the contract header → neither button overlaps the chips strip.
3. **Evidence:** **PASS** (2026-10-28, user-verified) — crosshair follows the pointer freely (`snapToData: false`); horizontal-crosshair underlying price renders on the right-edge axis (`crosshairTooltip` on the opposed `underlyingAxis`); collapse/reopen buttons live inside their containers and no longer cover the first chip.

## Negative / boundary cases (spec-verified)

- Dedupe: pasting the same ID twice keeps the earliest open date — parser spec.
- Mixed separators (comma/space/tab) all parse — parser spec.
- `openDate` after expiration: marker skipped — builder spec.
- Whitespace/case normalization — parser spec.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Textarea accepts multi-line pairs and bare IDs; single ID preserves existing view | S1, S2 |
| Rejected tokens display with reasons; valid entries still load | S3, S4 |
| Chips strip: swatch, readable label, × remove, hover-to-highlight | S2, S5, S6 |
| Display-window toggle shows in multi mode (with open dates) | S8 |
| `loaded / total` progress during fetch | S2, S7 |
| >50 contracts → soft warning, loads on confirmation | S7 |
| Deferred #1263 live checks (markers, multi-mode, clip) | S2, S8 |

## Regression / smoke checklist

- [x] Single bare ID → existing single view, no chips — S1
- [x] Catalog row click still loads single contract — S9
- [x] Rejection notice clears on next load — S3
- [x] Hovered chip highlights its line; leaving restores the set — S5
- [x] Clip button only appears with dated contracts — S8
- [x] No console errors during multi-load / focus / remove — S2–S7
