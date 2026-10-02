**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #725  
**Task:** #702  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete — all 11 scenarios PASS (user-executed)  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# UAT — #702 FE Header refactor (Savant Trader brand + global show/hide)

## Scope

Header rebranded to "Savant Trader" on a slim 48px dark bar; `rs-refresh-time`
and the symbols affordance removed; header contents reduced to menu button +
brand + fullscreen toggle + auth block. A global show/hide control flips
`UiStateService.fullscreen`; while the header is hidden a floating chevron
pinned top-edge restores it. Page-driven auto-hide unchanged. Bundled fix:
`order.component` + `triage-report.component` now reset fullscreen on destroy
(previously leaked hidden-header state to every subsequent route).

## Prerequisites

- Dev server running: `npm start` → http://localhost:4200
- A signed-out session for auth-block scenarios 7a; a signed-in account for 7b
  (standard app credentials — none stored here)
- No seed data required

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Brand + slim bar | Load any route (e.g. `/portfolio`) | Header reads "Savant Trader" on a slim (~48px) dark bar; no refresh-time widget; no symbols button; contents are exactly menu + brand + fullscreen toggle + auth | PASS — user |
| 2 | Global hide | Click the `fullscreen` icon button (right side of header) | Header disappears; a `fullscreen_exit` chevron appears pinned at top-center edge; page content expands to full height | PASS — user |
| 3 | Global restore | Click the chevron | Header returns; chevron disappears | PASS — user |
| 4 | Auto-fullscreen entry | Navigate to `/trading/live` (Signal Order) | Header auto-hides on entry; chevron is present (nav still reachable) | PASS — user |
| 5 | **Sticky-state regression** | From `/trading/live`, navigate to `/portfolio` via the browser URL bar or back button | Header **returns** on the new page — previously stayed hidden forever | PASS — user |
| 5b | Same regression, second page | Navigate to `/options/chain` (auto-fullscreen), then away | Header returns | PASS — user |
| 6 | In-page toggle coexistence | On `/signals/charts` (chart review), use the in-page fullscreen control | Works as before; chevron appears while hidden | PASS — user |
| 7a | Auth signed-out | Sign out if needed | Header shows Login + Sign up; Login → `/login`; Sign up → `/signup` | PASS — user |
| 7b | Auth signed-in | Sign in | Header shows user label + Logout; Logout signs out | PASS — user |
| 8 | Sidenav still works | Open menu → click any item → repeat after a fullscreen flip | Sidenav opens, routes correctly, closes | PASS — user |
| 9 | 48px sizing regression | Visit pages that previously hardcoded a 64px offset: `/signals` history, `dashboard-v3`, `rs-chart-view`, positions, trade journal | No 16px dead strip at the bottom; content reaches the viewport bottom | PASS — user |
| 10 | Chevron collision watch | On signal-review and order pages at ~1280–1600px width, check whether the centered chevron covers filter pills/scoreboard items | Reported as finding if it blocks a control | PASS — user |
| 11 | Console clean | Throughout | No console errors | PASS — user |

## Traceability

| Issue #702 AC | Scenario(s) |
|---|---|
| Savant Trader brand; no refresh-time or symbols affordance | 1 |
| Toggle hides header on any page; chevron restores (visible iff fullscreen) | 2, 3, 4 |
| Auto-fullscreen pages unchanged; in-page buttons work | 4, 6 |
| Auth block both states | 7a, 7b |
| Specs cover brand/legacy/toggle/reveal | automated — 163 suites/2354 tests green |
| Sticky-fullscreen fix (bundled) | 5, 5b |
| Review fallout: `--header-height` literal sweep | 9 |
| Review watch items (collision, overlays) | 10 |

## Regression smoke

- Sidenav open/close + navigation (8)
- Console errors (11)
