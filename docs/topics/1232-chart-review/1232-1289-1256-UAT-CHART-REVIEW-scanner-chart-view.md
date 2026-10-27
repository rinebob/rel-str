**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1289  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1256  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

# UAT — #1256 ChartView page + merged toolbar + route/nav

## Scope

Phase 1 (F2) of the Chart View page: a generic symbol-list chart viewer at
`/trading/chart-view`.

Delivered by this task:

- Merged toolbar
  - Scan dropdown (disabled placeholder)
  - Live list dropdown (All / My lists / Not triaged)
  - Indicators menu, symbol + company name
  - Zoom, nav, D/W/M pills, range pills, layout, fullscreen, log scale
  - Filing chips (tracked symbols only)
  - Trade / Order / Add actions, "New only" (disabled), manual input + Load
- `SignalListComponent` symbol pane (left)
- `SignalDetailComponent` detail with `showToolbar=false`
- Page-scoped `ChartToolbarStateService`
- Session-local viewed-symbol dimming
- Route + nav entry (`Signals → Chart View`)

Deferred to later tasks: scan sources (#1258), untracked RH charts
(#1259). Tracked symbols only this phase.

## Prerequisites

- Repo: `rel-str`, current work branch
- Dev server: `npm start`
- Authenticated app session with at least one populated symbol list and a
  tracked symbol that has `symbol-data`
- No seed data needed — real lists/symbols exercise every path

## Start instructions

```powershell
npm start
# open http://localhost:4200/trading/chart-view
# or navigate: Signals → Chart View
```

## Test scenarios

### S1 — Route, nav, and shell render

- **Feature:** `AppRoutes.CHART_VIEW` route + renamed nav entry
- **Start:** logged in, dev server running
- **Steps:** nav drawer → **Signals → Chart View**; confirm URL is
  `/trading/chart-view`; confirm the page renders merged toolbar (top),
  symbol pane (left), chart detail (right) — and the detail has **no**
  inner toolbar (`showToolbar=false`)
- **Expected:** page loads; title "Chart View"; no console errors
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S2 — Toolbar order

- **Feature:** merged toolbar replaces review-header + detail toolbar
- **Steps:** read the toolbar left→right
- **Expected:** Scan dropdown (disabled, "—") | List dropdown | Indicators
  menu | symbol + company name | zoom toggle | `‹ n/N ›` nav | D/W/M pills |
  range pills | layout | fullscreen | log-scale pill | filing chips
  (tracked symbols only) | Trade | Order pill | Add | "New only"
  (disabled) | symbol input + Load. **Absent:** back, history, observation,
  reason text, run-metrics strip
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S3 — List dropdown drives the pane

- **Feature:** `ChartViewViewportService` list sources
- **Steps:** List dropdown → pick **PRIMARY** (or any populated list) →
  pane shows that list's members and the first symbol auto-selects.
  Switch to **All** → pane shows the union of all lists. Switch to
  **Not triaged** → pane shows tracked symbols with no exclusive
  membership
- **Expected:** pane contents follow the selected source; selection resets
  and auto-selects the first symbol on each switch
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S4 — Tracked symbol charts with full indicators

- **Feature:** detail renders D/W/M for a tracked symbol
- **Steps:** with a list source active, select a tracked symbol
- **Expected:** three D/W/M charts render with the full indicator display
  (zones, trend-rider dots); D/W/M pills, range pills, zoom, layout,
  fullscreen, log scale all drive the charts
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S5 — Trade and Order

- **Feature:** ungated Trade + count-gated Order pill
- **Steps:** (a) select a symbol → **Trade** → manual order dialog opens
  seeded with the symbol. (b) stage or have a non-terminal ticket →
  **Order {n}** pill enables with the count → click → navigates to the
  order page (`/trading/live`). With no tickets, the pill is disabled
- **Expected:** no run required; count reflects non-terminal tickets only
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S6 — Add-to-tracked stub

- **Feature:** placeholder for the SA endpoint
- **Steps:** select a symbol → click **Add**
- **Expected:** snackbar "Add to tracked — coming soon"; no writes, no
  network call
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S7 — Manual symbol input

- **Feature:** arbitrary-symbol chart loading
- **Steps:** type `spy` (lowercase) in the symbol input → press Enter →
  SPY charts load (untracked symbols may show a chart-error or empty
  state this phase — RH bars land in #1259; the key check is no crash and
  no filing chips). Click **Load** with another symbol. Confirm the input
  clears after each load
- **Expected:** input normalizes to uppercase; untracked symbols show
  **no** filing chips; ticker-only (no company name) if no symbol doc
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S8 — Viewed dimming

- **Feature:** session-local `viewedSymbols` set
- **Steps:** in a list source, click through 3–4 symbols → previously
  viewed rows render dimmed. Refresh the page → dimming resets
- **Expected:** `.viewed` rows are visibly dimmer; refresh clears
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S9 — Filing chips + queue advance

- **Feature:** membership toggles + advance-on-removal
- **Steps:** in a list source (e.g. PRIMARY with ≥2 members), select the
  first symbol → click a different exclusive list chip (e.g. SECONDARY)
- **Expected:** the symbol moves lists; selection advances to the next
  pane symbol (not blank, not stuck)
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S10 — Manual → nav transition (round-2 fix)

- **Feature:** `select()` funnel clearing stale manual state
- **Steps:** type + load a manual symbol (e.g. `XYZ`); then click `›`
  (Next) in the toolbar
- **Expected:** selection jumps to the first pane symbol, pane returns to
  list mode (not history rows for the manual symbol); the manual symbol
  does not reappear afterward
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S11 — Disabled Phase-1 placeholders

- **Feature:** scan dropdown + New-only pill are inert until #1258
- **Steps:** click the Scan dropdown and the "New only" pill
- **Expected:** both visibly disabled; nothing happens; no errors
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S12 — Page-scoped toolbar state

- **Feature:** `ChartToolbarStateService` dies with the page
- **Steps:** change interval to W, range to 5Y, toggle an indicator off →
  navigate away → return to `/trading/chart-view`
- **Expected:** toolbar prefs reset to defaults (D / Recent / default
  indicators); layout and fullscreen persist (root `UiStateService`)
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S13 — Legacy route intact

- **Feature:** `signals/charts` still serves the old page (retirement is
  #1260)
- **Steps:** navigate to `/signals/charts`
- **Expected:** old chart-review page renders and works unchanged
- **Result:** ☑ PASS — user confirmed (2026-10-26)

### S14 — Narrow-viewport toolbar (round-2 fix)

- **Feature:** flex-shrink guards — controls never compress, symbol block
  shrinks via company-name ellipsis
- **Steps:** narrow the browser window until the toolbar runs out of room
- **Expected:** the company name truncates with ellipsis first; fixed
  controls (indicator menu label, pills, buttons) keep their borders and
  never clip or spill; the rightmost controls remain reachable as long as
  the window reasonably allows
- **Result:** ☑ PASS — user confirmed (2026-10-26)

## Automated verification (executed by agent)

| Check | Command | Result |
|---|---|---|
| Page + toolbar + viewport + signal-list + select-menu + routes/nav specs | `npx jest` targeted paths | ✅ PASS — 25 + supporting suites |
| `createList` `:`-collision pin | `npx jest symbol-list.service` | ✅ PASS |
| Full suite | `npx jest --coverage=false` | ✅ PASS — 268 suites / 4,610 tests |
| Typecheck | `npx tsc --noEmit` (app + spec) | ✅ PASS — clean |

## Traceability

| Task AC | Scenario(s) |
|---|---|
| Route renders toolbar + pane + detail `showToolbar=false` | S1 |
| Toolbar DOM order; no review-header elements | S2 |
| List dropdown drives pane (ALL/lists/NO_MEMBERSHIP) | S3 |
| Trade ungated → `manualOrderService.open` | S5 |
| Session dimming; refresh resets | S8 |
| Company-name lookup (ticker-only for untracked) | S4, S7 |
| Component spec coverage per FE test plan | Automated |
| Page-scoped toolbar state | S12 |
| Stale-manual / queue-advance correctness | S9, S10 |
| Legacy route untouched | S13 |

## Regression / smoke checklist

- [x] Indicator menu opens, toggles apply to in-scope charts (D/W/M)
- [x] Sidebar collapse/expand still works
- [x] Order pill count matches staged/non-terminal tickets elsewhere in app
- [x] No `NullInjectorError` or console errors through S1–S14
- [x] Chart loading spinner appears during symbol switch
