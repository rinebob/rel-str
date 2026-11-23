**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1684  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1307  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1307 FE-IMPL: chart popup infra (overlay + hover intent + states)

## Scope

The `show_chart` row action's overlay mechanics — the container only.
Per result row: a `cdkConnectedOverlay` popup anchored to the row's
chart button, opened on hover/focus/click, kept alive during pointer
travel via a 250ms close grace, one popup at a time, torn down on
recipe switch / filtered-out row / refresh. Chrome shows symbol + name
plus an `open_in_new` header affordance that deep-links chart-view
(`/trading/chart-view?symbol=…` **in a new tab** — peek stays transient;
drilling in leaves the scanner session untouched). The body carries
loading / error / auth state shells and a `data-mode` tracked|untracked
fork. **Chart
bodies are out of scope** — untracked candles land in #1308, tracked
gallery charts in #1309; in this build every healthy row shows the
loading shell by design.

## Prerequisites

- Dev server already running: `http://localhost:4200`.
- RH observation service running (scanner auto-runs against it) and an
  authenticated Robinhood session — if the page shows the
  re-authorize banner, run that flow first (it also feeds S8).
- Real data: any recipe that returns rows. **Daily Gainers** is the
  left-rail default and reliably returns rows mid-session; AAPL is a
  tracked symbol that appears in several recipes — use it for the
  tracked-mode checks; any `new`-badged row covers untracked.

## Getting to the feature

1. Open `http://localhost:4200/trading/scanner` (nav: **Scanner** in
   the trading nav strip).
2. Let the auto-run settle — recipe rows fill the left rail; click a
   recipe with results (e.g. **Daily Gainers**) to load its detail
   table.
3. Each result row's rightmost **actions cell** carries two icon
   buttons: `playlist_add` (list menu, #1306) and `show_chart` — the
   subject of this UAT.

## Automated evidence

- Scanner suites: `npx jest src/app/features/savant-trader/pages/scanner`
  — **100/100 green** (includes 8 specs added in review: Escape-stays-
  closed, relatedTarget cancel, focus guard, Enter→focus, reauth
  refocus, destroy-with-timer, a11y contract; plus the deep-link spec
  added at QA). Chart-view spec carries the `?symbol=` deep-link pins.
- Typecheck: `npx tsc --noEmit` — clean on all task files.
- Result: PASS

## Scenarios

### S1 — Chart button present per row

- **Confirms:** the actions cell carries the second action icon.
- **Steps:** in a populated detail table, inspect any row's actions
  cell.
- **Expected:** a `show_chart` icon button immediately right of
  `playlist_add`; tooltip "Chart"; same icon-button styling.
- **Result:** PASS

### S2 — Hover opens an anchored popup with symbol + name + loading

- **Confirms:** open-on-hover, anchored origin, chrome contents.
- **Steps:** hover the `show_chart` button on a row (e.g. AAPL).
- **Expected:** a popup card appears adjacent to that button (right/
  below first, flipping if near the viewport edge); header shows the
  row's **symbol** (and **name** when the wire row carries one) plus an
  `open_in_new` deep-link icon at the right; body shows a spinner +
  "Loading chart…".
- **Result:** PASS

### S3 — Pointer travel keeps it open; leaving the popup closes it

- **Confirms:** the 250ms close grace — the popup is meant to be
  entered.
- **Steps:** hover the button, then move the pointer directly into the
  popup and rest there ~1s. Then move the pointer out below.
- **Expected:** popup stays open while the pointer is inside; closes
  ~quarter-second after leaving. Moving the pointer off the button to
  anywhere *other* than the popup also closes it after the same beat.
- **Result:** PASS

### S4 — One popup at a time

- **Confirms:** single-active-popup invariant.
- **Steps:** hover row A's button → popup shows A's symbol; without
  pausing, move to row B's button.
- **Expected:** the same popup now shows row B's symbol — never two
  popups at once.
- **Result:** PASS

### S5 — Recipe switch tears the popup down

- **Confirms:** teardown on recipe switch.
- **Steps:** open a popup on any row, then click a different recipe in
  the left rail.
- **Expected:** popup disappears with the table — no orphan floating
  over the new recipe's rows.
- **Result:** PASS

### S6 — Filtering the row out tears the popup down

- **Confirms:** teardown when the row leaves the rendered set.
- **Steps:** in the page filter bar, set **Tracked** (or **New**) so
  the popup row's membership changes; open a popup on a row that the
  opposite filter would remove, then flip the filter.
- **Expected:** the popup closes the moment the row unmounts — no
  popup pinned to a vanished row. (Sorting the table does NOT close
  it — the row survives sort.)
- **Result:** PASS

### S7 — Keyboard paths: focus opens, Escape closes and refocuses

- **Confirms:** a11y open/close + the suppressFocusOpen guard (the
  review-critical fix — an unsuppressed refocus would reopen it).
- **Steps:** Tab through the table until a `show_chart` button takes
  focus (popup opens on focus). Press **Escape**.
- **Expected:** popup closes; focus returns to that same button and
  the popup **stays closed** (does not instantly re-open).
- **Result:** PASS

### S8 — Auth failure shows the Re-authorize affordance

- **Confirms:** `[chartAuth]` wiring → `'auth'` state → page's reauth
  flow.
- **Steps:** only applicable while the Robinhood session is
  unauthenticated (page banner visible). With the banner up, open a
  popup and click **Re-authorize**.
- **Expected:** popup body shows the key icon + "Robinhood session
  expired — re-authorize to load charts." + Re-authorize button;
  clicking it runs the same reauth flow as the banner and closes the
  popup. **If the session is authenticated this scenario is N/A** —
  the path is spec-pinned end-to-end (page spec asserts
  `authFailed → chartAuth → reauth → reauthenticate()`).
- **Result:** PASS

### S9 — data-mode fork distinguishes tracked vs untracked rows

- **Confirms:** the body-mode input #1308/#1309 branch on.
- **Steps:** open a popup on a **tracked**-badged row and on a
  **new**-badged row; in devtools inspect `.popup-body`.
- **Expected:** tracked row → `data-mode="tracked"`; new row →
  `data-mode="untracked"`.
- **Result:** PASS

### S10 — Popup header deep-links the symbol into chart-view (new tab)

- **Confirms:** the `open_in_new` affordance opens
  `/trading/chart-view?symbol=` **in a new browser tab** and the page
  loads it as a manual chart target (tracked or untracked alike).
- **Steps:** hover `show_chart` on a row (e.g. AAPL), move the pointer
  into the popup, click the `open_in_new` icon in its header.
- **Expected:** a **new tab** opens at
  `/trading/chart-view?symbol=AAPL` showing AAPL's chart via the
  manual-symbol path — it loads even when AAPL is absent from the
  active pane list. The **scanner tab is untouched** — recipe results,
  filters, and scroll position are all preserved because nothing
  navigated away.
- **Result:** PASS

## Manual UI/UX refinement pass

- **Chrome consistency:** header/layout/shadow matches the
  chain-cell-popup idiom (option-chain page for comparison).
- **Position fallbacks:** with the browser window narrowed, a popup on
  a right-edge row flips to the left side instead of clipping off-
  screen; a bottom-edge row flips above the button.
- **No dead visuals:** the loading shell is centered inside the body;
  symbol/name don't overflow the card on long names (ellipsis — the
  name gives way before the deep-link button does).
- **Deep-link affordance:** the `open_in_new` icon reads as secondary
  chrome (dim until hover), not a competing primary button.
- **Result:** PASS

## Findings

- **Every healthy row shows the loading shell — by design, not a
  defect.** The chart bodies are #1308 (untracked candles) / #1309
  (tracked gallery); the spinner is the honest shell until they land.
- **Deep-link added mid-gate (user request):** the `open_in_new`
  header affordance landed during QA, then switched from same-tab
  navigation to `window.open(_blank)` so the scanner session is never
  torn down — spec-pinned
  (`'/trading/chart-view?symbol=AAPL', '_blank'`).

## Traceability

| #1307 acceptance item | Scenario |
|---|---|
| cdkConnectedOverlay anchored to the row's chart button | S2 |
| Flip fallback positions + viewportMargin 8 | S2, refinement |
| Open on mouseenter / focus / click | S2, S7 (+ spec) |
| ~250ms delayed-close grace; pointer travel cancels | S3 |
| Popup mouseleave closes | S3 |
| One popup at a time | S4 |
| Teardown on recipe switch / filtered-out row / refresh | S5, S6 (+ spec) |
| Symbol + name header | S2 |
| Loading / error / auth state shells | S2 (+ spec for error) |
| Auth-shaped failure → page reauth affordance | S8 |
| tracked/untracked `data-mode` fork | S9 |
| Header deep-link → chart-view `?symbol=` | S10 (+ spec) |
| Escape closes + refocuses without reopening | S7 |
| Specs per TEST-FE §3 | Automated evidence |

## Regression / smoke

- `playlist_add` list menu still works beside the new button (S1 area).
- Row sorting and the page-level All/New/Tracked filter unaffected.
- Option-chain page cell popup (the #965 pattern source) unaffected —
  no shared code was modified.
- **Result:** PASS

## Verdict

PASS

## Results log

| Date | Scenario / check | Result | Evidence |
|---|---|---|---|
| 2026-11-23 | Automated — scanner + chart-view suites | PASS | 122/122 |
| 2026-11-23 | Automated — typecheck | PASS | tsc clean on task files |
| 2026-11-23 | S1–S10 + refinement + regression — live UAT | PASS | user-attested, prod dev server |
| 2026-11-23 | Mid-gate: deep-link → new tab | PASS | spec-pinned `window.open(_blank)` |
