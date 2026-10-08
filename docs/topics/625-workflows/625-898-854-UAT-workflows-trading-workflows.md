**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #898  
**Thread Parent:** #823  
**Topic Parent:** #625  
**Task:** #854  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# UAT — title-markup sweep + nav exposure + fullscreen default flip (#854 / QA #898)

## Scope

Three things are under test:

1. **Title-markup sweep** — in-page title restatements deleted; identity comes from the global `rs-header` (icon+title via `PAGE_INFO`, #852/#853).
2. **Navigation exposure boundary** — the sidenav (`NAV_SECTIONS`) is the authoritative user-facing surface. Retired/legacy routes (`dashboard`, `dashboard-v2`, `positions-view`, `trade-journal`, `heatmap-view`, `heatmap-chart`, `rs-chart`, `sync-chart`, `rs-table`, `history`, `signal-history`, `signal-action-report`, `decision-board`) stay registered + URL-reachable but are **not** in the nav. `dev/*` surfaces are reachable via the new **Tools ▸ Dev** submenu.
3. **Fullscreen default flip** — no page auto-enters fullscreen. Every page lands with `rs-header` visible; fullscreen is user-owned via the header ⛶ toggle or in-page toggles (`UiStateService`). In fullscreen, the top-center reveal chip carries icon+title+exit.

Reference: `625-851-854-INVENTORY-workflows-trading-workflows.md` — per-page sweep verdicts + the exposure table.

## Prerequisites

- Dev server running (`ng serve`, verified at `http://localhost:4200`).
- Signed-in session for feature routes; signed-out state for the public check.

## Scenarios

### 1. Sidenav structure — the exposed surface

Open the sidenav (hamburger). Confirm, top to bottom:

- [ ] Section labels in order: **Portfolio, Signals, Trading, Options, Analysis, Tools**, then an unlabeled tail
- [ ] Portfolio: Portfolio Dashboard, Portfolio Allocation
- [ ] Signals: Runs, Signal Review, Chart Review
- [ ] Trading: Live, Paper
- [ ] Options: Chain, % Change, Chart, Spread Chart, Strategy Dashboard, Build, Backtest
- [ ] Analysis: Swing Analysis
- [ ] Tools: Account Inquiry, Topic Viewer, **Dev** (last item, submenu trigger — shows a ▸ caret)
- [ ] Tail: Dashboard V3
- [ ] **Absent everywhere in the sidenav:** Dashboard, Positions, Trade Journal, Heatmap, Heatmap Chart, RS Chart, Sync Chart, RS Table, History, Signal History, Signal Action Report / Triage, Decision Board — and no top-level dev routes

**Result:** PASS — user-verified 2026-10-08

### 2. Dev submenu

- [ ] Click **Dev** → a popup menu opens listing exactly: **Flex Chart Sandbox, Gallery (Dev), Screenshot (Dev)**
- [ ] Click **Flex Chart Sandbox** → navigates to `dev/flex-chart`, sidenav closes, header shows "Flex Chart Sandbox"
- [ ] Repeat for the other two items (`dev/gallery` → "Gallery (Dev)", `dev/screenshot` → "Screenshot (Dev)")
- [ ] Dev is the **last** item under Tools — below Topic Viewer, above the unlabeled tail

**Result:** PASS — user-verified 2026-10-08

### 3. Default header on every nav destination

Walk **every sidenav destination** (all items in scenario 1, plus the three Dev children). For each:

- [ ] `rs-header` is **visible** on arrival — icon + page title + controls; the page did NOT mount fullscreen
- [ ] Exactly **one** title per page — the header's; no in-page title banner
- [ ] Page controls/context intact underneath

Former auto-fullscreen pages are the regression risk — header must now appear by default on: `signals/runs`, `signals/review`, `signals/charts`, `trading/live`, `tools/account`, `options/strategy/backtest`, `options/pct-change`, `options/chain`, `options/chart`, `options/spread-chart`, `analysis/swings`, `dev/flex-chart`, `dev/screenshot`, `trading/paper`, `options/strategy/build`, `options/strategy-dashboard`, `signal-action-report` (if visited by URL), `portfolio`, `portfolio/allocation`, `tools/topic-viewer`, `dev/gallery`, `dashboard-v3`.

**Result:** PASS — user-verified 2026-10-08

### 4. Manual fullscreen round-trip

On two or three heavy pages (suggest `signals/review`, `options/chain`, `analysis/swings`):

- [ ] Click header ⛶ (or the page's own fullscreen button where present — pct-change, swing-analysis, chart toolbar) → header unmounts; top-center **chip** shows `icon + page title + fullscreen_exit`
- [ ] Click the chip → `rs-header` returns with the same title
- [ ] Enter fullscreen, then navigate to another route (e.g. via browser back or a page link) → **header visible** on arrival (fullscreen does not leak across navigation)

**Result:** PASS — user-verified 2026-10-08

### 5. Header title accuracy per nav destination

| Sidenav item | Route | Expected header title |
|---|---|---|
| Portfolio Dashboard | `portfolio` | Portfolio Dashboard |
| Portfolio Allocation | `portfolio/allocation` | Portfolio Allocation |
| Runs | `signals/runs` | Run Dashboard |
| Signal Review | `signals/review` | Signal Review |
| Chart Review | `signals/charts` | Chart Review |
| Live | `trading/live` | **Signal Order** ← money page, highest risk |
| Paper | `trading/paper` | Paper Trading |
| Chain | `options/chain` | Option Chain |
| % Change | `options/pct-change` | Option Chain % Change |
| Chart | `options/chart` | Option Chart |
| Spread Chart | `options/spread-chart` | Spread Chart |
| Strategy Dashboard | `options/strategy-dashboard` | Options Strategy Dashboard |
| Build | `options/strategy/build` | Strategy Builder |
| Backtest | `options/strategy/backtest` | Strategy Backtest |
| Swing Analysis | `analysis/swings` | Swing Analysis |
| Account Inquiry | `tools/account` | Account Inquiry |
| Topic Viewer | `tools/topic-viewer` | Topic Viewer |
| Dashboard V3 | `dashboard-v3` | Dashboard V3 |
| Dev ▸ Flex Chart Sandbox | `dev/flex-chart` | Flex Chart Sandbox |
| Dev ▸ Gallery (Dev) | `dev/gallery` | Gallery (Dev) |
| Dev ▸ Screenshot (Dev) | `dev/screenshot` | Screenshot (Dev) |

**Result:** PASS — user-verified 2026-10-08

### 6. Action-bar anchoring (review-remediated regressions)

- [ ] `signals/runs` — Review/Observation/sync/backfill buttons sit at the **right** edge (not left)
- [ ] `options/pct-change` — contrast picker + fullscreen button at the **right** edge
- [ ] `options/strategy/build` — Create button at right
- [ ] `portfolio` — privacy/allocations/refresh at right; repeat on an account-less state if reachable

**Result:** PASS — user-verified 2026-10-08

### 7. Preserved content sanity

- [ ] `signals/review` — signal counts + filter pills + pipeline actions present at top
- [ ] `signals/charts` — back button, symbol context, ACR buttons, list + stage controls present; sidebar `signal-list` panel still labels itself "Review" when no symbol loaded (accepted — panel label, not banner)
- [ ] `options/chain` — Symbol/Load/date controls; when fullscreened, chip doesn't badly overlap the page's own top bar (cosmetic)
- [ ] `analysis/swings` — subtitle + company strip; same overlap check
- [ ] `login` (signed out) — card h1 "Sign in" + header "Log in" coexist; no banner duplication
- [ ] `signup` — same

**Result:** PASS — user-verified 2026-10-08

### 8. Icon-ligature validity sweep

While walking scenarios 3–5, confirm every `PAGE_INFO` icon renders as a **glyph**, not literal text. Nav-exposed icons to check: `account_balance_wallet`, `pie_chart`, `view_list`, `rate_review`, `image_search`, `bolt`, `receipt_long`, `link`, `percent`, `stacked_line_chart`, `show_chart`, `analytics`, `build`, `science`, `query_stats`, `account_balance`, `account_tree`, `dashboard`, `lab_profile`, `photo_library`, `screenshot_monitor`.

**Result:** PASS — user-verified 2026-10-08

### 9. Regression smoke

- [ ] Sidenav opens/closes; every item navigates
- [ ] Browser tab title matches page on a few routes
- [ ] No layout overflow/scrollbar regressions on swept pages now that the header is always present
- [ ] Signed-out: sidenav shows only Log in / Sign up (no Dev submenu, no feature items)

**Result:** PASS — user-verified 2026-10-08

## Notes / out of scope

- Retired routes are still URL-reachable (e.g. typing `/trade-journal` directly loads the page) — that is intentional; this task governs the **nav surface**, not route removal. If a retired page renders oddly post-sweep (it may have lost title markup), that's acceptable by design — file a follow-up if any should be deleted outright.
- The reveal chip's exact overlap on `options/chain`/`analysis/swings` top bars is cosmetic-check only.

## Automated evidence (2026-10-08, post nav/fullscreen remediation)

- `npx jest` targeted suites — nav-sections, sidenav-menu, core, header, triage-report, signal-order, signal-review.facade, swing-analysis — **all pass** (incl. new Dev-submenu + no-auto-fullscreen specs)
- `npx ng build` — clean
- Earlier post-title-sweep evidence: features 2391/2391; core 265/266 (sole fail `robinhood-mcp-observation` — other thread's spec/impl mismatch); full-suite run pending re-verification at submission time

## Traceability

| AC / requirement | Scenario |
|---|---|
| Every routed page audited; title-restatement deleted | 3, 5 + inventory |
| Control-bearing headers untouched | 3, 7 |
| No page shows a double title | 3, 5, 7 (login/signup) |
| Per-page inventory covers every routed page | inventory doc (38/38) |
| `npx jest` green, no orphaned specs | automated evidence |
| Sidenav is the exposure surface; legacy routes unlisted | 1 |
| Dev routes reachable via Tools ▸ Dev popup | 1, 2 |
| Header default-visible; fullscreen is user-toggle only | 3, 4 |
| Fullscreen mode retains identity + exit (chip) | 4 |
