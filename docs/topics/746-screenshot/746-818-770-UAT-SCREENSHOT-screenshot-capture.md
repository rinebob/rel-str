**Topic:** On-demand Screenshot Capture  
**Topic Slug:** screenshot-capture  
**Thread:** Auto-Capture  
**Thread Slug:** auto-capture  
**Issue:** #818  
**Thread Parent:** #747  
**Topic Parent:** #746  
**Task:** #770  
**Domain:** SCREENSHOT  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# UAT — #770: Dev page /dev/screenshot MVP

## Scope

`/dev/screenshot` exploration page: lazy `authGuard`ed route, spec form
(symbol, event, interval checkboxes, width/height/visibleBars/refId
overrides, Store-to-GCS checkbox), `captureChartSnapshot` invocation, inline
SVG artifact cards with storage paths, and distinguishable typed error
messages. Playground variants/zoom are #771 scope — exercised incidentally.

## Prerequisites

- Dev server running: `npm start` → http://localhost:4200
- Signed in (page is `authGuard`ed; browser preview windows don't survive auth)
- Callable `captureChartSnapshot` deployed to project `rel-str`, `us-central1`
- Symbol with cached bars, e.g. `GOOG`

## Scenarios

### 1. Route + lazy load
- Navigate directly to `http://localhost:4200/dev/screenshot`.
- **Expected:** the Screenshot Capture page renders (h1 + spec form); no
  redirect to `/portfolio`. If it redirects, restart the dev server (stale
  bundle) — verified behavior earlier.

### 2. Default capture (Store checked)
- Defaults: Symbol `GOOG`, Event `manual`, Daily + Weekly checked, Store to
  GCS checked. Click **Capture**.
- **Expected:** button shows "Capturing…" then two artifact cards (daily,
  weekly), each with inline SVG and `st-trade-screenshots/GOOG/…` SVG + PNG
  paths beneath. Full-height renders; variant rows below each card are #771
  scope.

### 3. Spec overrides
- Set Symbol `AAPL`, Event `order-placed`, uncheck Weekly, Width `400`,
  Height `280`, Visible bars `15`, Ref id `uat`. Capture.
- **Expected:** one artifact card (daily), visibly narrower/shorter, ~15
  bars, path segment includes `order-placed-stock-uat-daily`.

### 4. Store unchecked (renderOnly)
- Uncheck **Store to GCS**, capture.
- **Expected:** artifact cards render with SVG but **no** path list — no
  objects written.

### 5. Typed error — invalid spec
- Clear Symbol (submit is client-blocked: "Symbol is required."). Restore
  symbol, then to force `invalid-argument`, set Visible bars to `0` (client
  drops it — skip) or instead verify `failed-precondition`: set Symbol
  `ZZZZ-NOT-A-SYMBOL`, Capture.
- **Expected:** `failed-precondition` message naming the symbol —
  distinguishable from a generic failure.

### 6. Scroll
- With D+W results rendered, scroll the page.
- **Expected:** page scrolls inside the drawer; weekly card reachable.

### 7. Regression — nearby routes
- Visit `/portfolio` and `/dev/flex-chart` — both still resolve.

## Negative/boundary coverage already in unit tests
- Empty symbol block, empty-intervals block, double-submit lockout,
  all four callable error codes, renderOnly spec emission, superseded-
  capture response drop.

## Traceability

| AC | Scenario |
|---|---|
| Route resolves behind authGuard, lazy | 1, 7 |
| Form submit → callable → inline SVG + paths | 2, 3 |
| Typed errors distinguishable | 5 (+ unit tests) |
| Page scrolls (refinement) | 6 |

## Results

| # | Result | Evidence |
|---|---|---|
| 1 | PASS | User-verified: /dev/screenshot resolves, form renders |
| 2 | PASS | User-verified: D+W artifact cards, inline SVG, paths shown |
| 3 | PASS | User-verified: override spec → narrow card, uat path segment |
| 4 | PASS | User-verified: SVG renders, no path list, no GCS writes |
| 5 | PASS | User-verified: typed error surfaced distinctly |
| 6 | PASS | User-verified: page scrolls inside drawer |
| 7 | PASS | User-verified: nearby routes unaffected |
