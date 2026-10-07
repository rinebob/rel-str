**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #859  
**Task:** #852  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-07  

# UAT — PAGE_INFO registry + route wiring (#852)

## Scope — what the page-info registry is

This task builds the data foundation for the app-wide header, not the header itself. Three pieces:

- **`PAGE_INFO`** (`src/app/core/common/constants.ts`) — a table with one row per page in the app: `{ title: 'Signal Review', icon: 'rate_review' }`, keyed by the `AppRoutes` enum (which holds every route's URL path). It's the single place a page's identity is declared — the same source the sidenav-adjacent data lives in. The `Record<AppRoutes, PageInfo>` type makes the table complete *by construction*: add a route to the enum without a `PAGE_INFO` row and TypeScript refuses to compile.
- **`resolvePageInfo(joinedPath)`** — the lookup the header will use. Given a route's configured path it returns that page's `{title, icon}`; for a nested path with no own row it walks up to the nearest ancestor that has one (a future `trading/live/detail` would inherit Signal Order's identity rather than blanking); unkeyed paths return `undefined`.
- **Route wiring** (`core-routes.ts`) — every leaf route sets `title: PAGE_INFO[...].title`. Angular's default `TitleStrategy` turns `Route.title` into the browser tab title automatically, so **the only user-visible change this task ships is the tab text** — previously every tab just said the app name (or whatever the index.html `<title>` was); now each page names itself. The icon field and the in-header title render land in #853.

What to verify: the tab title follows the registry (scenarios 3–5), the registry/route-table invariants are pinned by specs (scenarios 1–2), and nothing else about the header or navigation changed (scenario 6).

## Prerequisites

- Repo: `C:\aa\projects\rel-str`, branch `prod`, dependencies installed.
- For UI scenarios: `npm start`, app on `http://localhost:4200`, a signed-in session for auth-gated routes (the account is the tester's own — no test fixture exists).

## Scenarios

### 1. Registry exhaustiveness (automated)

- **Steps:** `npx jest core-routes`
- **Expected:** all specs pass; the `PAGE_INFO registry + route titles (#852)` describe block asserts every `AppRoutes` member has a non-empty title+icon, every leaf title is registry-sourced and non-empty, and every leaf path is a direct registry key.
- **Result:** PASS — `npx jest core-routes` 70/70 (2026-10-06).

### 2. Resolver contract (automated)

- **Steps:** same run — `resolvePageInfo` spec covers exact match, param-template key (`heatmap-chart/:baseline/:symbol`), ancestor inheritance (`trading/live/detail` → Signal Order), empty-segment normalization (`/signals/review`), unkeyed paths → `undefined`, prototype keys (`constructor`, `toString`) → `undefined`.
- **Expected:** pass.
- **Result:** PASS — same run; resolver spec covers all listed edges.

### 3. Tab title — public routes (manual)

- **Steps:** `npm start`; open `http://localhost:4200/login` signed out.
- **Expected:** browser tab reads "Log in". Navigate to `documentation`, `contact`, `signup` — tabs read "Documentation", "Contact", "Sign up".
- **Result:** PASS — user-verified on dev server (2026-10-07).

### 4. Tab title — feature routes (manual, signed in)

- **Steps:** sign in; visit `portfolio`, `signals/runs`, `signals/review`, `trading/live`, `trading/paper`, `options/chain`.
- **Expected:** tab shows "Portfolio Dashboard", "Run Dashboard", "Signal Review", "Signal Order", "Paper Trading", "Option Chain" respectively.
- **Result:** PASS — user-verified on dev server (2026-10-07).

### 5. Tab title — param + redirect routes (manual, signed in)

- **Steps:** visit `heatmap-chart/AAPL/MSFT` (param route); then `signals` and `options` (group-root redirects).
- **Expected:** tab reads "Heatmap Chart"; redirects land on "Run Dashboard" / "Option Chain" — never a blank or stale title.
- **Result:** PASS — user-verified (2026-10-07); redirect chains resolve destination titles.

### 6. Regression smoke

- **Steps:** during scenario 4, confirm sidenav opens, fullscreen toggle works, auth buttons correct for session state — header untouched by this task.
- **Expected:** unchanged behavior.
- **Result:** PASS — no header/nav changes observed; header code untouched this task.

## Traceability

| AC | Scenario |
|---|---|
| PAGE_INFO covers every AppRoutes member, non-empty fields | 1 |
| Every leaf title from registry; redirects/parents untouched | 1, 4, 5 |
| Longest-prefix resolution + param routes + unkeyed → empty | 2, 5 |
| Tab titles follow the registry (TitleStrategy) | 3, 4, 5 |
| Existing header behavior preserved | 6 |
