**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1701  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1308  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1308 FE-IMPL: untracked candle chart + on-demand bars store

## Scope

The chart body for `data-mode="untracked"` rows — the content the #1307
popup was built to host. For a `new`-badged (untracked) result row,
hovering `show_chart` now renders a real candle chart inside the peek
popup: ~60 daily candles + SMA(10/20/50) overlay lines, fetched on
demand through `ScannerChartStore` → `get_equity_historicals` (the
canonical #1259 client path) and session-cached per symbol. Settled
errors are terminal (no refetch loop); auth failures show the
Re-authorize shell and the click clears + retries so the view can heal.
**Tracked rows keep the loading shell** — their gallery-card body is
#1309 and out of scope here.

## Prerequisites

- Dev server already running: `http://localhost:4200`.
- RH observation service running and an authenticated Robinhood
  session — if the page shows the re-authorize banner, run that flow
  first (it also feeds S5).
- Real data: **Daily Gainers** reliably returns rows mid-session. You
  need at least one `new`-badged row (symbol chip absent / `new`
  membership badge) for the untracked path and one tracked row (e.g.
  AAPL when present) for the fork check. Scan results are live — pick
  the first `new`-badged row in the selected recipe's detail table and
  record the symbol used in the Result line.

## Getting to the feature

1. Open `http://localhost:4200/trading/scanner` (nav: **Scanner** in
   the trading nav strip).
2. Let the auto-run settle; click **Daily Gainers** in the left rail to
   load its detail table.
3. In the result rows, find a **`new`-badged symbol** (untracked —
   the membership chip shows `new` rather than a list name). Hover the
   row's rightmost `show_chart` icon button.

## Automated evidence

- New/changed specs — `npx jest src/app/features/savant-trader` —
  **3636/3636 green (181 suites)**; full suite **6312/6312 (332)**.
  Pins: store dedupe/cache/settled-error/AUTH/clearError re-arm,
  wire→PriceBar malformed-drop, SMA warmup heads, popup candle+3-line
  config, tracked-fork untouched, reauth clear+retry.
- Typecheck: `npx tsc --noEmit` — clean on all task files.
- Result: PASS

## Scenarios

### S1 — Untracked row: loading → candle chart + SMA lines

- **Confirms:** the untracked body renders a real chart, not a
  permanent spinner.
- **Steps:** hover `show_chart` on a `new`-badged row; keep the pointer
  on the button (or travel into the popup).
- **Expected:** spinner + "Loading chart…" briefly, then a candle chart
  appears inside the popup (~60 daily bars) with three distinct
  colored SMA lines over the price pane.
- **Result:** PASS — `new` row: spinner → candle chart + 3 SMA lines.

### S2 — Chart contents: no chrome, no dots, ~60 candles

- **Confirms:** the chart is a read-only peek — no toolbar, scrollbar,
  crosshair labels, or signal dots.
- **Steps:** inspect the rendered chart.
- **Expected:** candles in up/down colors; three MA lines visibly
  distinct (blue/orange→yellow/red on dark); no zoom toolbar, no
  scrollbar, no dot markers, no crosshair readout; roughly a
  screenful of candles, not the whole year.
- **Result:** PASS — no toolbar/dots/scrollbar/crosshair; ~60 candles; up/down colors; 3 distinguishable MA lines.

### S3 — Session cache: re-hover is instant; different symbols fetch independently

- **Confirms:** `ensureBars` dedupe + per-symbol cache.
- **Steps:** leave the popup (it closes), re-hover the same row's
  button; then hover a *different* `new`-badged row.
- **Expected:** same row → chart renders immediately (no spinner, no
  refetch flicker). Different symbol → its own brief loading then its
  own chart (candles are that symbol's, not the first's).
- **Result:** PASS — re-hover instant (cached); different `new` row fetched independently.

### S4 — Tracked row: fork intact, still the loading shell

- **Confirms:** the tracked path is untouched for #1309 — it must not
  show the untracked chart or error.
- **Steps:** hover `show_chart` on a tracked row (list-name chip).
- **Expected:** header symbol + `open_in_new` button; body stays
  "Loading chart…" (the gallery body arrives in #1309 — the shell
  itself is the expected state for this task).
- **Result:** PASS — tracked row still renders the loading shell (fork intact for #1309).

### S5 — Auth failure → Re-authorize → chart heals on retry

- **Confirms:** the `clearError` seam — reauth actually fixes the
  popup, not just the session.
- **Steps:** with an expired RH session (re-authorize banner visible),
  hover a `new` row → popup shows the auth shell. Click **Re-authorize**
  and complete the flow; re-hover the row.
- **Expected:** the auth shell shows the "Robinhood session expired…"
  copy + Re-authorize button; after reauth, the same row's popup loads
  the chart (no stale auth state).
- **Result:** SKIP — session healthy; seam is spec-pinned (clearError + retry + reauth emit).
  spec-pinned; note as such)

### S6 — `open_in_new` still deep-links chart-view in a new tab

- **Confirms:** the header affordance survived the body change.
- **Steps:** open an untracked chart, click the header's `open_in_new`
  icon.
- **Expected:** a **new tab** opens `/trading/chart-view?symbol=…` with
  the symbol charting; the scanner tab is untouched (results intact).
- **Result:** PASS — `open_in_new` opens chart-view in a new tab; scanner session untouched.

### S7 — Peek stays peek: popup still tears down

- **Confirms:** regression — the body change didn't alter the
  transient model.
- **Steps:** open the chart, move the pointer out (not into the popup);
  also check hover on a second row.
- **Expected:** popup closes ~250ms after leave; a second row's hover
  swaps the single popup to that row (chart or loading per its own
  store state).
- **Result:** PASS — teardown on leave; second row swaps the popup.

### S8 — Empty/no-data symbol (conditional)

- **Confirms:** a symbol whose historicals come back empty shows an
  honest note, not a blank frame.
- **Steps:** only runnable if a `new` row's symbol has no RH daily bars
  (rare — delisted/illiquid). If encountered: hover its chart button.
- **Expected:** "No daily bars for {SYMBOL}" note.
- **Result:** N/A — no empty-bars row exercised in this pass.

## Manual UI/UX refinement pass

- [x] Chart is legible at the popup's fixed size (660×400) — candles
      and MA lines resolvable, not mush.
- [x] Three MA lines are visually distinguishable on the dark surface.
- [x] Loading/error/auth/empty shells read cleanly at popup scale;
      Re-authorize button reachable and styled like the banner's.
- [x] Popup doesn't flicker or re-layout as the chart mounts.
- [x] `data-mode="untracked"` attribute still present (DevTools spot
      check optional).

## Findings

- **F1 — Popup clipped at viewport bottom (fixed, awaiting re-verify):**
  the #1307 overlay anchored the popup's top-left at the icon button
  (`end/bottom → start/top` + flips), fine for the ~40px shell but the
  ~340×260 chart body overflows the viewport on bottom-half rows.
  `cdkConnectedOverlayPush` alone did not rescue it. Resolution per
  tester direction: the popup is now **viewport-centered** — the
  overlay anchors to a zero-size `Point` at the window center captured
  at open (`overlayOrigin` on `ChartPopupTarget`, center/center
  position pair, push input dropped). Anchor element is retained only
  for Escape→focus-restore. Side effect: `HIDE_DELAY_MS` 250 → 600 —
  pointer travel from the row's icon to mid-viewport exceeds the old
  chain-grid grace. Also updated the scroll-strategy comment (popup no
  longer follows the row; it stays centered).
- **F1b — Chart overflowed the panel (fixed, awaiting re-verify):** on
  re-verify the centered placement landed but `.popup-chart`'s 340×180
  box was smaller than `.flex-chart-wrapper`'s `min-height: 300px` —
  the chart rendered ~120px below the panel border, which is what made
  the centered overlay read as "top-left at mid-screen". `.popup-chart`
  is now `min(720px, 100vw−32px) × min(440px, 100vh−140px)` — small-dialog
  size, viewport-clamped.
- **F1c — First-hover misplacement (fixed, awaiting re-verify):** the
  centered position applied at attach while the body was the small
  *loading* shell; the pane then grew 720×440 on the loading→chart flip
  and CDK never re-applies position on pane resize (only viewport
  resize) → the chart grew right-and-down from the stale top-left.
  Second hover centered correctly because the session cache renders
  'chart' immediately. Fix: `.popup-body` is a FIXED size in every
  state — `min(720px, 100vw−32px) × clamp(300px, 100vh−140px, 440px)`
  with shell content centered — so the pane is final-sized at attach;
  `.popup-chart` fills it; dead `min-width: 240px` removed.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| ensureBars dedupes in-flight; session cache | S3 |
| Error slot settles, no refetch loop | S3 (re-hover), S5 |
| AUTH failure → reauth affordance that heals | S5 |
| historicalsToBars — real bars rendered | S1, S2 |
| smaOverlays [10,20,50] three line series | S1, S2 |
| Candle + 3 MA lines, ~40–60 bars, no toolbar/dots | S2 |
| Theme-token bull/bear (palette) | S2 |
| Tracked fork preserved for #1309 | S4 |
| Peek-only model + deep-link intact | S6, S7 |
| Malformed/empty wire → honest empty state | S8 |
| TEST-FE §4 spec coverage | Automated evidence |

## Regression / smoke

- [x] List-menu action (`playlist_add`) still works on the same rows.
- [x] Tracked/new/all page filter unaffected by chart fetches.
- [x] Recipe switch / row filter while a popup is open still tears it
      down (#1307 S5/S6 paths).
- [x] Scanner run itself unaffected — charts are read-only MCP calls.

## Verdict

**PASS** — all exercised scenarios green; three placement findings
(F1/F1b/F1c) remediated and re-verified in-app: viewport-centered
overlay, fixed 660×400 body across all states (first-hover clip resolved),
size tuned so the actions column stays reachable. S5 skipped (healthy
session — spec-pinned); S8 not exercised (no empty-bars row).

## Results log

- 2026-11-24 — Execution: all exercised scenarios PASS; **S5** skipped
  (healthy session, spec-pinned), **S8** N/A. Placement findings
  F1→F1c remediated in-gate and re-verified (viewport-centered overlay;
  fixed-size body kills the first-hover clip; 660×400 final). Verdict PASS.
- 2026-11-24 — First execution: all scenarios PASS except **F1**
  (popup clipped below viewport on bottom-half rows). Fixed: overlay
  re-anchored to a viewport-center `Point` (single center/center
  position, `HIDE_DELAY_MS` 250→600 for the longer pointer travel);
  scanner suite 107/107. Awaiting re-verify of the centered placement.
- 2026-11-23 — Draft created; awaiting manual execution (scenarios
  need the live RH session + real scan rows).
