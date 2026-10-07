**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #868  
**Task:** #853  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# UAT — rs-header page-identity zone (#853)

## Scope — what the identity zone is

The global header (`rs-header`, the top bar on every page) now shows **which page you're on**: an icon + title rendered next to the "Savant Trader" wordmark, e.g. `rate_review Signal Review`.

How it works: on every navigation, the header resolves the current route's configured path against `PAGE_INFO` (the registry shipped in #852) by longest-prefix match — the same rule the browser tab title uses, so tab and header agree. A nested route with no own registry row inherits its parent's identity; a route with no matching row renders nothing (no stale title from the previous page).

What to verify: the icon+title appear and follow navigation (scenarios 1–4), the zone is absent where there's no identity (scenario 5), the narrow-viewport collapse keeps identity while dropping the wordmark (scenario 6), icons render as glyphs not raw text (scenario 7), and nothing else about the header changed (scenario 8).

## Prerequisites

- Repo: `C:\aa\projects\rel-str`, branch `prod`, dependencies installed.
- `npm start`, app on `http://localhost:4200`, signed-in session for auth-gated routes.

## Scenarios

### 1. Identity specs (automated)

- **Steps:** `npx jest header.component.spec core.component.spec`
- **Expected:** all specs pass — the `#853` describe covers navigation tracking, param route, redirect chain, nested inheritance, unkeyed→empty zone, public-route identity; legacy specs (menu emit, fullscreen, auth buttons) pass unmodified.
- **Result:** PASS — 22/22 header + 7/7 core-component specs green (2026-10-07).

### 2. Identity on feature routes (manual, signed in)

- **Steps:** sign in; visit `portfolio`, `signals/runs`, `signals/review`, `trading/live`, `options/chain`.
- **Expected:** header shows icon + "Portfolio Dashboard" / "Run Dashboard" / "Signal Review" / "Signal Order" / "Option Chain" — icon + title change on each navigation; tab title matches.
- **Result:** PASS — user-verified on dev server (2026-10-07); icon+title track each route, tab title agrees

### 3. Param + redirect routes (manual)

- **Steps:** visit `heatmap-chart/AAPL/MSFT`; then `signals` and `options` (group-root redirects).
- **Expected:** "Heatmap Chart" icon+title on the param route; redirects land on "Run Dashboard" / "Option Chain" — never blank or stale.
- **Result:** PASS — user-verified; Heatmap Chart on param route, redirects land on destination identity

### 4. Public route signed out (manual)

- **Steps:** sign out (or incognito); open `/login`.
- **Expected:** header shows icon + "Log in" next to the brand while Login/Sign up buttons show — identity is not auth-gated.
- **Result:** PASS — user-verified; Log in identity + auth buttons while signed out

### 5. No stale identity (manual)

- **Steps:** navigate between several feature pages, then to `documentation` or a route group root; watch the header during the transition.
- **Expected:** identity updates on arrival; never shows the previous page's title after landing.
- **Result:** PASS — user-verified; identity updates on arrival, no stale title

### 6. Narrow viewport (manual)

- **Steps:** shrink the browser below ~720px wide (or devtools device toolbar at 390px); visit `signals/review`.
- **Expected:** "Savant Trader" wordmark hides; menu button + icon + "Signal Review" + auth controls still fit — no clipped/overlapping buttons; long titles truncate with ellipsis if needed.
- **Result:** PASS — user-verified; wordmark hides, icon+title+auth fit, no clipping

### 7. Icon glyph spot-check (manual)

- **Steps:** on the routes from scenario 2, confirm each icon renders as a glyph (not the literal text name like `rate_review` or `bolt`). Known-risk names for the full sweep in #854: `lab_profile` (dev/flex-chart), `screenshot_monitor` (dev/screenshot), `receipt_long`, `inventory_2`, `view_kanban`, `query_stats`, `manage_history`, `stacked_line_chart`, `candlestick_chart`.
- **Expected:** all icons visited render as glyphs; flag any that show raw text — those get corrected in #854's visual pass.
- **Result:** PASS — user-verified; icons render as glyphs on visited routes (full sweep remains #854's)

### 8. Existing header behavior (manual)

- **Steps:** during scenarios 2–4, confirm sidenav opens via the menu button, fullscreen toggle works (header hides, reveal chevron restores), auth buttons correct for session state.
- **Expected:** unchanged behavior.
- **Result:** PASS — sidenav/fullscreen/auth unchanged

## Traceability

| AC | Scenario |
|---|---|
| Icon + title after brand, resolved on NavigationEnd via pathFromRoot + longest-prefix | 1, 2 |
| Param route + redirect chain resolve | 1, 3 |
| Nested inherit; unkeyed → empty zone, no stale identity | 1, 5 |
| Wordmark collapses <720px, identity persists | 6 |
| Menu/fullscreen/auth unchanged | 1, 8 |
| Identity not auth-gated | 1, 4 |
| Icons render in legacy Material Icons font | 7 |
