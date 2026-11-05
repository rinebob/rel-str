**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1417  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1363  
**Domain:** OPTIONS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-05  
**Last Updated:** 2026-11-05  

# UAT — Task #1363: Chunk stepper + timeline + mini-controls

Scope: the picker's new **Chunks** tab (◀ ▶ stepper that live-drives the
chart through the same emit path as Send, `chunk i/n · X days · Y unique`
readout, custom timeline strip with click-to-jump, "Add chunk to
selection", Size select `5/10/20/50`) and the page-level
**mini-controls** strip (`◀ chunk i/n ▶`, Size, `All`, `Picker`)
rendered only while a list session is active. Includes the review
remediations: store-owned emit protocol (`sendSteppedChunk`/
`sendChunkAt`/`sendAll`), no silent cursor moves, doc-end timeline
sliver fix.

## Prerequisites

- `npx ng serve` running; authenticated user; Firestore reachable.
- Seed doc (already in Firestore, id verbatim):
  `2026-11-01_sun_105552_manual_anjw5z_QQQ` — `csp-45-20`, QQQ,
  **204 picks / 4 misses**, first→last pick dates shown in the picker
  header. At the default chunk size 10 this partitions to **21 chunks**
  (last chunk = 4 days); at size 50 → **5 chunks**; 204 also exercises
  timeline density.
- A second symbol with no saved session (e.g. SPY if untouched) for the
  no-session negative check.

## Start

1. `npx ng serve` → navigate directly to
   `http://localhost:4200/options/chart?list=2026-11-01_sun_105552_manual_anjw5z_QQQ`
   — the list applies and the picker opens.
2. In the picker, click the **Chunks** tab (between Rows and Lines).
3. Keep the picker open for S1–S6 — live-drive means the chart behind
   the dialog updates on every step; drag the dialog or watch the
   plotted-chips readout change.

## Functional scenarios

### S1 — Chunks tab + info readout

- **Feature:** tab placement + `chunk i/n · days · unique`.
- **Steps:** Chunks tab on the 204-pick doc at default Size 10.
- **Expected:** tab order is Rows → **Chunks** → Lines. Readout shows
  `chunk 1/21 · 10 days · M unique` (M ≤ 10 — repeat contractIds dedupe
  within the chunk).
- **Result:** PASS — user-verified live 2026-11-05

### S2 — ◀ ▶ live-drive + clamped ends

- **Feature:** stepping replaces the plotted set behind the open dialog.
- **Steps:** on chunk 1, note the plotted chips/series. Press `▶`.
  Repeat to chunk 21, then once more.
- **Expected:** each step immediately re-plots — the textarea behind the
  dialog contains the new chunk's `date,id` lines and the chips/series
  **replace** (no merge). At chunk 1 `◀` is disabled; at 21 `▶` is
  disabled — no wrap; the extra press does nothing.
- **Result:** PASS — user-verified live 2026-11-05. **Finding F1:** the
  emit updates the chart but Rows checks / Lines preview keep showing
  the earlier `selection` — dialog state diverges from what's plotted.
  Routed to #1419 (sync-model decision).

### S3 — Timeline strip

- **Feature:** one tick per pick day, calendar-positioned, click jumps.
- **Steps:** Chunks tab; hover ticks; click a tick near the end of the
  track; then click one near the start.
- **Expected:** a horizontal strip with one tick per pick day (204 on
  this doc), bounded by the doc's first/last pick dates (labels under
  the track). The current chunk's span shows a highlighted band and its
  ticks render in accent. Clicking a tick jumps the readout to that
  tick's containing chunk AND emits it — the chart re-plots.
- **Result:** PASS — user-verified live 2026-11-05

### S4 — Add chunk to selection unions

- **Feature:** accumulate, don't replace.
- **Steps:** Rows tab → check one row far outside the current chunk
  (note its date). Chunks tab → **Add chunk to selection**. Return to
  Rows tab.
- **Expected:** the chunk's 10 days are now checked AND the far row is
  still checked — union, not replace. Readout reflects both.
- **Result:** PASS — user-verified live 2026-11-05. **Finding F2:**
  user wants selection shading on ticks + click-to-toggle a selected
  chunk/day — routed to #1420.

### S5 — Size select repartitions + clamps cursor

- **Feature:** `5/10/20/50` re-chunks the list.
- **Steps:** step to a high chunk (e.g. 21/21) → set Size to `50` →
  observe readout. Then set `5` → step a few; set `50` again.
- **Expected:** Size 50 → readout `5/5` (cursor clamped from 21 → last
  valid). Size 5 → `1/41` (cursor clamps back to 0 region — verify it
  lands on a valid chunk, not stale index). No emit on resize — the
  chart doesn't change when only Size changes.
- **Result:** PASS — user-verified live 2026-11-05

### S6 — Page mini-controls strip

- **Feature:** the strip above the plotted chips, session-gated.
- **Steps:** close the picker → observe the strip (`◀ chunk i/n ▶`,
  Size select, `All`, `Picker`). Press `▶` twice. Then switch the page
  symbol to one with no saved session (e.g. SPY) → strip disappears;
  switch back to QQQ → strip returns with the restored session.
- **Expected:** strip visible only while `activeList` exists; `◀ ▶`
  live-drive the chart the same way the dialog does; disabled at ends.
- **Result:** PASS — user-verified live 2026-11-05

### S7 — All on the mini-controls

- **Feature:** select-all + emit in one action.
- **Steps:** on the 204-pick doc, press **All** on the strip.
- **Expected:** the >50 large-list confirm appears (same as any big
  send); confirm → all 204 lines load; the plotted set is the full list.
  Rows tab (reopen picker) shows every pick row checked.
- **Result:** PASS — user-verified live 2026-11-05

### S8 — Picker button reopens; no stacked dialog

- **Feature:** `Picker` on the strip + dedupe.
- **Steps:** strip → **Picker** → dialog opens with cursor/selection
  preserved. With it open, press **Picker** again isn't reachable —
  instead, with the picker open, re-navigate the `?list=` URL.
- **Expected:** dialog reopens preserving state; the `?list=` nav while
  open does not stack a second dialog.
- **Result:** PASS — user-verified live 2026-11-05

### S9 — Persistence across close/reopen and reload

- **Feature:** `rs-optlist` blob — chunk size + cursor + selection.
- **Steps:** set Size `20`, step to chunk 3, apply some selection
  change → close picker → reload the page (F5) with the same symbol.
- **Expected:** after reload the mini strip shows Size 20 and the
  cursor position preserved (`chunk 3/…`); reopening the picker shows
  the same selection. (Blob: `localStorage["rs-optlist:QQQ"]`.)
- **Result:** PASS — user-verified live 2026-11-05

### S10 — Remainder + doc-end timeline edge

- **Feature:** last short chunk renders correctly.
- **Steps:** Size `50` on the 204-pick doc → step to chunk `5/5`
  (4 days). Look at the timeline's right edge.
- **Expected:** readout `5/5 · 4 days · M unique`; the highlighted span
  is visibly narrower; the span pill still renders (a sliver — not
  zero-width/invisible) even when the chunk ends at the last pick date.
- **Result:** PASS — user-verified live 2026-11-05

### S11 — Regression: everything untouched still works

- **Feature:** no change outside the new surfaces.
- **Steps:** Rows/Lines tabs, toolbar ops, Send + Copy, chooser load
  (`Lists…` drawer), `?list=` apply, no-selection markers, ↻ badges.
- **Expected:** identical to the #1362 UAT (see
  `1243-1399-1362-UAT-OPTIONS-option-contract-viewer.md` S1–S12).
- **Result:** PASS — user-verified live 2026-11-05

## Refinement pass (manual, live app)

- Timeline legibility on 204 ticks — density, tick hit targets (they're
  narrow; is click-to-jump usable?), span band + in-chunk tick contrast
  in dark AND light themes.
- Chunks toolbar + mini strip at narrow widths — wrap behavior; the
  `dse-select compact` selects look consistent with other toolbar
  selects (stride, template filter).
- Stepper feels live but not jumpy — the dialog doesn't steal focus
  back / re-render violently while stepping behind it.
- `chunk i/n · days · unique` copy reads cleanly; no overflow at `41/41`.

## Traceability

| AC / check | Scenario |
|---|---|
| Chunks tab between Rows/Lines; `i/n · days · unique` | S1 |
| ◀ ▶ live-drive via same emit path; replace; clamp/no-wrap | S2, S6 |
| Add chunk → selection unions, doesn't disturb existing | S4 |
| Timeline: domain, tick/day, span + tick highlight, click jump+emit, custom markup | S3, S10 |
| Size 5/10/20/50 repartitions, clamps cursor, persists | S5, S9 |
| Mini-controls: session-gated, ◀▶/i/n/size/All/Picker, dumb surface | S6, S7, S8 |
| Reopen preserves cursor/selection; reload persists | S8, S9 |
| Send/Lines/Rows/chooser/`?list=` unchanged | S11 |
| Underlying loading independent of contract series | implicit — all steps |

## Execution results log

- **Automated (2026-11-05):** `npx jest … contract-list* option-chart` —
  **6 suites / 129 tests PASS** (post-restyle re-run) — store partition/
  emit/clamp/sendAll, picker Chunks tab behaviors incl. literal emitted
  lines, rendered mini-controls spec (render-gate, bounds, outputs),
  page emit seam + close→reopen preservation.
- **AOT** `ngc -p tsconfig.app.json` (`strictTemplates`) — clean.
- **Dev server:** `http://localhost:4200` reachable (HTTP 200).
- **Manual scenarios S1–S11 + refinement pass:** all PASS — user-verified
  live 2026-11-05 on the 204-pick/4-miss QQQ doc. Five follow-on
  requirements surfaced during execution — routed (see Findings on
  QA #1417): #1419 (chunk-emit↔selection sync BUG), #1420 (timeline
  selection shading/toggle), #1421 (DOW + cadence filter), #1422
  (strike-line hover parity), #1423 (page layout — left selector /
  right chips column). Month-shading item already covered by #1402.

## Regression / smoke

- Pairs textarea paste + Load still plots (unchanged path).
- Generator drawer send still emits into the same textarea/load path.
- Large-list (>50) confirm fires for All-on-204 as well as manual paste.
- Chips strip, rejected-token notice, underlying bars unchanged.
