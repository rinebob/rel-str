**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #679  
**Thread Parent:** #660  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** IMPL  
**Status:** Approved  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

# IMPL (FE) — Journey Navigation

Single area: **FE**. No BE or SHARED work — `AppRoutes`/`NavItem`/`NAV_MENU_ITEMS` are FE-internal.

## 1. Route tree restructure

**`src/app/core/common/interfaces.ts` — `AppRoutes` enum.** Rename values to canonical paths (multi-segment values are precedented: `OPTION_CHAIN = 'savant-trader/option-chain'`). Old enum KEYS keep their names where the surface survives (`SIGNAL_REVIEW = 'signals/review'`), so ~20 existing references follow automatically.

| Enum key | New value |
|---|---|
| PORTFOLIO_DASHBOARD | `portfolio` |
| PORTFOLIO_ALLOCATION | `portfolio/allocation` |
| RUN_DASHBOARD | `signals/runs` |
| SIGNAL_REVIEW | `signals/review` |
| CHART_REVIEW | `signals/charts` |
| SIGNAL_ORDER | `trading/live` |
| PAPER_TRADING | `trading/paper` |
| OPTION_CHAIN | `options/chain` |
| OPTION_CHAIN_PCT_CHANGE | `options/pct-change` |
| OPTION_CHART | `options/chart` |
| SPREAD_CHART | `options/spread-chart` |
| OPTIONS_STRATEGY_DASHBOARD | `options/strategy-dashboard` |
| STRATEGY_BUILDER | `options/strategy/build` |
| STRATEGY_BACKTEST | `options/strategy/backtest` |
| SWING_ANALYSIS | `analysis/swings` |
| RH_ACCOUNT_INQUIRY | `tools/account` |
| FLEX_CHART_SANDBOX | `dev/flex-chart` |
| TOPIC_VIEWER (new key) | `topic-viewer` — the in-flight dev-lifecycle route; rename its `DEV_LIFECYCLE` value or add the key — reconcile at impl time |
| SIGNAL_HISTORY | unchanged (`signal-history`) — future scope |
| SIGNAL_ACTION_REPORT | unchanged (`signal-action-report`) — future scope |
| DASHBOARD_V3 | unchanged (`dashboard-v3`) |
| LOGIN / SIGNUP | unchanged |
| PROTOTYPE_TODAY | unchanged (throwaway — deleted at cleanup) |

Removed-from-nav routes keep current paths (no renames — they die with their code): `dashboard`, `dashboard-v2`, `decision-board`, `positions-view`, `heatmap-view`, `heatmap-chart/:b/:s`, `rs-chart`, `rs-table`, `sync-chart`, `history`, `trade-journal`, `documentation`, `contact`.

**`src/app/core/core-routes.ts`** — apply canonical paths; add:
- `''` → `redirectTo: '/portfolio'` (replace `PORTFOLIO_DASHBOARD` redirect — same effect, explicit)
- `/signals` → `redirectTo: '/signals/runs'`
- `/options` → `redirectTo: '/options/chain'`

**No `redirectTo` aliases for renamed paths.** Stale literals would fall through `**` → `/` — so the sweep below is mandatory.

**Literal sweep (required):** ~8 sites — `signal-review.facade.ts` (×4: `/run-dashboard`, `/chart-review`, `/signal-order`, `/signal-action-report`), `order.component.ts` (`/signal-review`), `triage-report.component.ts` (`/signal-review`), `signal-history.component.ts` (`/run-dashboard`), plus `[routerLink]` literals in HTML (`swingAnalysisLink`, pill links already use `appRoutes.*`). Sweep all literals to `AppRoutes.*` where the key exists.

## 2. Grouped nav model

**`interfaces.ts`:**

```ts
export interface NavSection { label: string; items: NavItem[] }
```

**`constants.ts`:** replace `NAV_MENU_ITEMS: NavItem[]` with:

```ts
export const NAV_SECTIONS: NavSection[] = [
  { label: 'Portfolio', items: [dashboard, allocation] },
  { label: 'Signals',   items: [runs, signalReview, chartReview] },
  { label: 'Trading',   items: [live (signal-order), paperTrading] },
  { label: 'Options',   items: [chain, pctChange, chart, spreadChart, strategyDashboard, build, backtest] },
  { label: 'Analysis',  items: [swingAnalysis] },
  { label: 'Tools',     items: [accountInquiry, topicViewer] },
  { label: '',          items: [dashboardV3] },   // tail — unlabeled or 'Misc'
];
```

Keep `NAV_MENU_ITEMS` as a derived flat export (`NAV_SECTIONS.flatMap(s => s.items)`) for any consumer expecting it — or delete and fix consumers (impl choice; grep first).

## 3. Sidenav grouped rendering

`sidenav-menu.component` — iterate `NAV_SECTIONS`: group label header row (uppercase, dimmed) + items. Overlay `mat-drawer mode="over"` unchanged in `core.component`. Item click behavior unchanged (emits `navigate` → `core.component` routes by `navItem.href`).

## 4. Header refactor

`header.component` + `core.component.html`:

- Brand: "Savant Trader" (replaces "Relative Strength Heatmap"), updated styling (slim bar, app-dark palette consistent with existing surfaces).
- Contents: `☰` menu button (opens sidenav — unchanged), brand text, fullscreen toggle button, auth block (see §5). **Remove** `rs-refresh-time` and the symbols button and their `external`-item rendering loop entirely — header no longer iterates `NAV_MENU_ITEMS`.
- **Show/hide:** toggle button calls `uiState.toggleFullscreen()` — the existing signal that already gates `<rs-header>` in `core.component`. When `fullscreen()`, render a floating chevron button pinned top-edge (fixed position, `fullscreen_exit` icon, z-index above content) that calls `toggleFullscreen()`. Page-driven auto-hide (`setFullscreen(true)` on init in ~12 pages) is unchanged; per-page toggle buttons keep working (same signal).
- Verify `--header-height` CSS var path keeps working (core.component already swaps it to `0px` on fullscreen).

## 5. Auth flow + nav gating

- Unauthenticated: header shows Login + Sign up; sidenav renders auth-only items (login/signup) — feature routes are `authGuard`-gated already, nav just shouldn't advertise them.
- Authenticated: header shows user label + Logout; sidenav renders full `NAV_SECTIONS`.
- Implementation: `isAuthenticated` from `AuthStore` already injected in header; apply the same signal in sidenav-menu to filter sections/items (sidenav currently renders unconditionally — add the gate).

## 6. Topic Viewer

New Tools item routes to `topic-viewer`. In-flight work registered `dev-lifecycle`; reconcile — either the other session's route gets renamed to `topic-viewer`, or we add `TOPIC_VIEWER = 'topic-viewer'` with an updated `path`. Nav label: "Topic Viewer".

## Phases

- **P1 — Route tree:** §1 (enum rename, route table, literal sweep). Everything compiles; nothing else changes visibly.
- **P2 — Nav data + sidenav:** §2–3 (+ auth gating from §5).
- **P3 — Header:** §4–5 header part (brand, strip legacy, global toggle + reveal chevron).

## Non-goals

- No new surfaces; no page-internal changes beyond nav/literal updates; no `redirectTo` legacy aliases; sidenav stays overlay.
