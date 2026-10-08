**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #851  
**Thread Parent:** #823  
**Topic Parent:** #625  
**Task:** #854  
**Domain:** WORKFLOWS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-07  

# Code Review — title-markup sweep + page inventory (#854)

## Verdict: **PASS** (2 rounds)

Round 1: Standards **FAIL** · Spec **FAIL** · Adversarial **FAIL** — 1 structural MAJOR, 2 layout MAJORs, doc-integrity MAJOR + minors, all remediated in-loop.
Round 2: remediation verification — all r1 findings closed; new code (PageIdentityService, reveal chip) independently re-checked.

## Round 1 — axes

### Standards — FAIL → remediated

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | MAJOR | `.dashboard-header` `space-between` + single child → run-dashboard action cluster jumped right→left | **FIXED** — `justify-content: flex-end` |
| 2 | MAJOR | Same defect, pct-change `.page-header` (contrast picker + fullscreen btn) | **FIXED** — `flex-end` |
| 3 | MAJOR | Dead `.header-title`/`.data-time`/`.signal-badge` block survived in `review-header.component.scss` (sweep removed its markup) | **FIXED** — block deleted |
| 4 | MINOR | `.pd-header` no-accounts edge: `.bar-actions` drops left under `space-between` (also latent on allocation) | **FIXED** — `margin-left: auto` on `.bar-actions` in `header-bar` mixin (fixes both consumers) |
| 5 | MINOR | `strategy-builder` `.builder-header` `space-between` no-op (single child) | **FIXED** — `flex-end` (create-btn already had `margin-left: auto`) |
| 6 | MINOR | Stale comments referencing deleted title (`review-header.component.ts`) | **FIXED** |
| 7 | MINOR | Single-child wrapper residue (`.header-left` stats wrappers, `.header-text`, `.heatmap-view__header-left`) | Accepted — harmless structure; noted |
| 8 | MINOR | Pre-existing dead selectors unrelated to sweep (review-header `.header-filter`/`.header-decisions`/`.badge`; signal-review `.gr-count`/`.active-toggle`) | Out of scope — predates #854; flagged, left |
| 9 | INFO | Doc header missing `**Task:**` line | **FIXED** in inventory |

### Spec — FAIL → remediated

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | MAJOR | Inventory `Route` column wrong in 17/34 rows — stale pre-#660 paths, not `AppRoutes` values; UAT route-walk would hit `**` redirect → false "broken page" | **FIXED** — column rewritten to `AppRoutes` enum values |
| 2 | MINOR | Residual cells under-described (allocation account switcher, spread-chart toolbar); `''` redirect omitted | **FIXED** — cells amended, `''` added |
| 3 | MINOR | `signal-list` sidebar panel shows literal "Review" when no symbol loaded — not recorded | **FIXED** — noted in inventory judgment calls for UAT |
| — | — | Coverage verified: 38/38 leaf `loadComponent` routes inventoried; no missed restatements; no over-deletion; no double titles; no orphaned specs | Verified clean |

### Adversarial — FAIL → remediated

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | MAJOR | **Premise violation:** 12 swept pages call `setFullscreen(true)` → `core.component` unmounts `rs-header` entirely → deleted h1s left those pages with ZERO identity (worst: `trading/live` order ticket). No `Title.setTitle` fallback exists. | **FIXED** — `PageIdentityService` extracted from `HeaderComponent`; `.header-reveal` chip now renders `PAGE_INFO` icon+title+exit on fullscreen pages. 2 new spec tests. |
| 2 | MINOR | space-between regressions (same as Standards 1–2) | FIXED (above) |
| 3 | MINOR | Dead `.header-title` CSS (same as Standards 3) | FIXED (above) |
| 4 | MINOR | PAPER badge removal loses live-vs-paper qualifier signal | Noted in inventory for UAT — restore as chip only if confusion emerges |
| 5 | MINOR | No page-level `h1` anywhere post-sweep — heading-landmark a11y regression | **FIXED** — `.page-title` span→`h1`. Note: #853 r1 had demoted h1→span *because* pages then kept their own h1s; the sweep inverted that premise — header h1 is now the only one per page (auth cards remain the only two-h1 routes, acceptable) |

Adversarial non-findings verified: no `querySelector`/`data-testid`/`aria-*` referenced deleted nodes; no broken sibling/structural selectors; flex spacers intact elsewhere; gallery does not fullscreen (its title removal covered by rs-header).

## Round 2 — verification

- `npx jest src/app/features/` — **2391/2391 pass** (158 suites).
- `npx jest src/app/core/` — 265/266; sole failure `robinhood-mcp-observation.service.spec.ts` ("Invalid batch response" vs "session failed") is **another thread's uncommitted MCP batch work** — spec/impl mismatch in that work-in-progress, not #854.
- `npx ng build` — clean.
- New-code check: injection context (`toSignal`/`computed` in service field initializers — exercised live by header identity tests), chip a11y (`aria-label`, `matTooltip` retained), spec stub shape, no other rs-header consumers broken — verified.

## Residual notes for QA/UAT

- signal-order (`trading/live`) is the highest-risk page: confirm header/chip reads "Signal Order".
- Chip is fixed top-center — `option-chain` and `swing-analysis` keep top-center content in their own bars; check for cosmetic overlap (only in manual fullscreen now).
- Two h1s coexist on `login`/`signup` (header + card) — accepted; promote card→h2 later if heading audit demands.
- Working tree carries other threads' changes in shared files (`portfolio-dashboard.component.html`, `gallery-header.*`, MCP service, `flex-chart/indicators/*`) — ship must hunk-stage only #854 edits.

## QA-phase scope addendum (2026-10-08, user-directed)

During `#898` UAT walkthrough the user flagged two corrections that supersede review-era assumptions:

1. **UAT must scope to the sidenav, not `AppRoutes`.** The first UAT draft walked every registered route — including retired/legacy routes deliberately removed from nav in #700 (`dashboard`, `positions-view`, `trade-journal`, `heatmap-*`, `signal-history`, `signal-action-report`, …). The route registry is a superset; `NAV_SECTIONS` is the exposure surface. UAT rewritten accordingly.
2. **Fullscreen default flip.** "Now that we have a global header we don't need default full-screen — default header with toggle fullscreen." All 14 `setFullscreen(true)` init calls removed (13 pages + `signal-review.facade.enterPage`); `ngOnDestroy` resets kept so fullscreen never leaks across navigation. The reveal chip (r1 remediation) is retained — it's the identity + exit affordance for user-initiated fullscreen.
3. **Dev submenu.** `NavItem.children` added; Tools' last item `Dev` opens a `mat-menu` with `dev/flex-chart`, `dev/gallery`, `dev/screenshot`. `NAV_MENU_ITEMS` flattens children (trigger is not a destination). Specs updated (nav-sections + sidenav-menu).

Post-addendum verification: targeted jest suites pass (incl. new Dev-submenu and no-auto-fullscreen specs); `ng build` clean.
