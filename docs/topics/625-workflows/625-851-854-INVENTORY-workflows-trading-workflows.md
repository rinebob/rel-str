**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #854  
**Thread Parent:** #823  
**Topic Parent:** #625  
**Task:** #854  
**Domain:** WORKFLOWS  
**Type:** INVENTORY  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-08  

# Page Inventory — Title-markup sweep (#854)

Sweep rule (IMPL Task 3 / PRD AC5): delete markup whose **only job is restating the page title** — the global `rs-header` identity zone (#853) now carries it. Keep control-bearing headers (filters, selectors, buttons), dynamic context (symbol/pair/status lines), descriptive subtitles, section labels, and form-card headings.

**Fullscreen model (revised at QA, user-directed):** no page auto-enters fullscreen. Every page renders the global `rs-header` by default; fullscreen is user-owned via the header ⛶ toggle (or in-page toggles that delegate to the same `UiStateService`). Entering fullscreen unmounts `rs-header`; the `.header-reveal` chip (top-center) then carries the resolved `PAGE_INFO` icon + title + exit affordance — identity is never lost. Leaving a page resets fullscreen (`ngOnDestroy`), so every navigation lands on the default header state. Route table marks pages that bind layout to `fullscreen()` / ship in-page toggles with † — UAT verifies the toggle + chip on each.

Verdicts: **DELETED** = title markup removed; **KEPT** = header exists but carries controls/context, not a title restatement; **NONE** = no page-title markup existed.

## Feature pages

| Route (`AppRoutes`) | Page | Verdict | Residual header content after sweep |
|---|---|---|---|
| `dashboard` | dashboard.component | KEPT | `header-container` context lines (List name, Baseline symbol) |
| `dashboard-v2` | dashboard-v2.component | KEPT | same context lines (v2 store) |
| `dashboard-v3` | dashboard-v3.component | KEPT | threshold input controls |
| `decision-board` | decision-board.view | NONE | grid column headers only |
| `sync-chart` | sync-chart-view.component | NONE | — |
| `rs-chart` | rs-chart-view.component | KEPT | dynamic subtitle chips (symbol/interval/date context) |
| `rs-table` | rs-table.component | NONE | — |
| `positions-view` | positions-view.component | KEPT | `h2` section titles ("Open positions"/"Closed positions") — label content sections, not the page |
| `portfolio` | portfolio-dashboard.component | **DELETED** | `.bar-left` icon + `h1` removed; kept account switcher, scoreboard, privacy/allocations/refresh actions |
| `portfolio/allocation` | allocation-page.component | NONE | toolbar = account switcher + back link + refresh |
| `trade-journal` | trade-journal.view | **DELETED** | `Trade Journal` toolbar span removed; kept New trade button + detail-panel toolbar titles |
| `heatmap-view` | heatmap-view.component | **DELETED** | `h2.heatmap-view__title` removed; kept status line + interval toggle |
| `heatmap-chart/:baseline/:symbol` | heatmap-chart-view.component | KEPT | `h2` shows dynamic pair `AAPL / MSFT` — context, not title restatement |
| `history` | history.component | NONE | — |
| `signals/runs` † | run-dashboard/dashboard.component | **DELETED** | icon + `h1` "Savant Trader" removed; kept action buttons (Review/Observation/sync/backfill) |
| `signals/charts` † | review-header.component | **DELETED** | fallback `h1` "Review" removed; kept back, symbol/status context, accept/watch/reject, list + stage controls |
| `signals/review` † | signal-review-header.component | **DELETED** | `h1.gr-title` removed; kept signal counts, filter pills, grouping/list controls |
| `trading/live` † | signal-order/order.component | **DELETED** | `h1.order-title` removed; kept back button + account scoreboard |
| `signal-action-report` † | triage-report.component | **DELETED** | `h1.tr-title` removed; kept back button + date-range/refresh controls |
| `tools/account` † | observation-dashboard.component | **DELETED** | `h1` removed; kept subtitle context ("Local-only tool explorer…") + back link |
| `options/strategy/backtest` † | backtest-dashboard.component | **DELETED** | `h1` removed; kept subtitle context + run-control card |
| `signal-history` | signal-history.component | **DELETED** | icon + `h1` removed; kept back button + symbol input |
| `options/chart` | option-chart.component | KEPT | `panel-title` section labels only |
| `options/spread-chart` | spread-chart-page.component | KEPT | controls toolbar (symbol/expiry/strike selectors) |
| `options/strategy-dashboard` | options-strategy-dashboard.component | **DELETED** | `h1` removed; kept open/closed stat cards + actions |
| `options/strategy/build` | strategy-builder.component | **DELETED** | `h1` removed; kept Create New Strategy button |
| `trading/paper` | paper-trading.component | **DELETED** | `h1` incl. PAPER badge removed; kept stat cards + actions |
| `options/pct-change` † | option-chain-pct-change.component | **DELETED** | `h2` removed; kept contrast picker + fullscreen toggle |
| `options/chain` † | option-chain.component | **DELETED** | `h1` removed; kept Symbol/Load/date controls |
| `analysis/swings` † | swing-analysis-page.component | **DELETED** | `h1` removed; kept subtitle context + company strip + controls |
| `dev/flex-chart` † | flex-chart-sandbox.component | **DELETED** | `h2` removed; kept data-mode + symbol fields |
| `dev/gallery` | gallery-header.component | **DELETED** | `h1.gallery-title` removed; kept run-date, card counts, filter pills, group/chart controls |
| `dev/screenshot` † | dev-screenshot.component | **DELETED** | `h1` removed; kept subtitle context + spec form |
| `tools/topic-viewer` | topic-viewer-page.component | **DELETED** | `h1` removed; kept repo picker, refresh, show-closed |

## Public pages

| Route | Page | Verdict | Notes |
|---|---|---|---|
| `login` | login.component | KEPT | `h1` "Sign in" is the form card's own heading — the page **is** the card; not a page banner |
| `signup` | signup.component | KEPT | `h1` "Create your account" — same reasoning |
| `contact` | contact.component | NONE | — |
| `documentation` | documentation.component | NONE | — |

## Redirect-only / unrouted members

`''`, `logout`, `chart`, `signals`, `options`, `**` — no page template; nothing to sweep. (Redirect leaves resolve their destination's identity via the registry.)

## Companion changes

- **Specs (4):** `portfolio-dashboard`, `paper-trading`, `topic-viewer-page`, `option-chain` — title assertions removed/replaced with structural ones (account switcher, header presence + controls). The 'page heading reads' test on topic-viewer was dropped — identity is now the global header's job.
- **Dead CSS (~20 rules):** removed alongside the markup — `.bar-left`/`.bar-icon`/`.bar-title` (pd mixin), `.gallery-title`, `.gr-title`, `.header-title`+`.paper-badge` (paper-trading), `.header-left`/`.header-icon`/`.header-title` (run-dashboard), `.header-title`+`.data-time`+`.signal-badge` (review-header — missed in first pass, removed in review remediation), `.tr-title`, `.order-title`, `h1` (observation, backtest, signal-history, option-chain), `.header-title` (options-strategy, strategy-builder), `h2` (flex-chart-sandbox, pct-change), `.page-header h1` (dev-screenshot), `.swing-analysis-header h1`, `.page-title` (topic-viewer).
- **Layout fixes (review remediation):** `space-between` → `flex-end` on single-child headers (run-dashboard `.dashboard-header`, pct-change `.page-header`, strategy-builder `.builder-header`); `.bar-actions { margin-left: auto }` in the pd `header-bar` mixin — right-anchors actions when the bar's title/left node is absent (also fixes the portfolio no-accounts edge and allocation page).
- **Fullscreen identity (review remediation):** `PageIdentityService` extracted from `HeaderComponent`; `CoreComponent`'s `.header-reveal` chip now renders icon + title + exit icon on fullscreen pages. `rs-header`'s `.page-title` promoted `span` → `h1` for heading-landmark a11y.
- **Fullscreen default flip (QA remediation):** `setFullscreen(true)` init calls removed from 13 pages + `signal-review.facade.enterPage`; `ngOnDestroy` resets kept so fullscreen never leaks across navigation. In-page toggles (header ⛶, chart-toolbar, pct-change, swing-analysis, signal-review-header) all delegate to `UiStateService.toggleFullscreen`.
- **Dev submenu (QA remediation):** `NavItem` gained `children?: NavItem[]`; a `Dev` trigger (last item under Tools) opens a `mat-menu` listing `dev/flex-chart`, `dev/gallery`, `dev/screenshot`. `NAV_MENU_ITEMS` flattens children; the trigger itself is not a destination.

## Navigation exposure surface (QA clarification)

The sidenav (`NAV_SECTIONS`) — not `AppRoutes` — is the authoritative user-facing surface. The route table above lists every *registered* route for sweep completeness; the following are **registered but intentionally unlisted** (retired/legacy): `dashboard`, `dashboard-v2`, `decision-board`, `sync-chart`, `rs-chart`, `rs-table`, `positions-view`, `trade-journal`, `heatmap-view`, `heatmap-chart`, `history`, `signal-history`, `signal-action-report`. They remain URL-reachable. Only `dashboard-v3` is exposed among the dashboards; `dev/*` surfaces are reachable via Tools ▸ Dev.

## Judgment calls worth reviewing at exit UAT

- **Subtitles kept** on observation, backtest, dev-screenshot, swing-analysis — descriptive context, not titles. If they read as redundant now, they go in a follow-up.
- **Auth card headings kept** on login/signup — they're the page's only content and its landmark heading; global "Log in"/"Sign up" coexists without a duplicate-banner effect.
- **heatmap-chart h2 kept** — `AAPL / MSFT` is dynamic view context, not the "Heatmap Chart" title.
- **PAPER badge removed with the title** — it qualified the deleted h1; global title "Paper Trading" carries the same signal. If live-vs-paper surfaces ever blur, restore a small qualifier chip (not a title).
- **`signal-list` panel fallback "Review"** (`signals/charts` sidebar) — renders literal "Review" when no symbol is loaded; it's a panel label, not a page banner. KEPT, but noted for UAT eyeballing.
- **Fullscreen chip is the identity in manual fullscreen (†)** — when the user toggles fullscreen the page's only "where am I" is the top-center reveal chip. Deliberate: fullscreen is a user-chosen maximize-chrome state; the chip keeps identity + exit affordance. On `options/chain` and `analysis/swings` the chip may overlap top-center page-bar content — cosmetic check at UAT.
- **Icon-ligature validity** — full visual check of every `PAGE_INFO` icon runs in this task's UAT (known-risk names: `lab_profile`, `screenshot_monitor`, `receipt_long`, `inventory_2`, `view_kanban`, `query_stats`, `manage_history`, `stacked_line_chart`, `candlestick_chart`).
