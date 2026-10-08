**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** Portfolio Visual Consistency  
**Thread Slug:** portfolio-visual-consistency  
**Issue:** #897  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #779  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-07  
**Last Updated:** 2026-10-08  

# UAT — Allocation page shell: header bar, account strip, single subtab row

## Scope

Task #779 migrated `allocation-page.component` (`/portfolio/allocation`)
onto the dashboard's reference shell (`_pd-visual-language`). The page
now renders a header bar (account-switcher pills left; **Portfolio**
link + refresh icon button in header actions — no toolbar row, no local
title since the page title lives in the global `rs-header` per #853), a
compact account strip (Value | Allocated | Cash | Unassigned, `as of`
pinned right, `surface-container` + hairline tokens) inline below the
header, and a single **Buckets | Positions** `mat-tab-group` with
`animationDuration="0ms"`. The page shell bounds the tab chain
(`flex:1`/`min-height:0` + a `::ng-deep` `.mat-mdc-tab-body-wrapper`
rule via the shared `bounded-tab-group` mixin) so tall content — all
bucket expandos open — scrolls inside the pane instead of clipping
(QA #839 finding). Retired-section + expando chrome moved onto Material
system tokens; loading/error/empty states use the shared
`state-block`/`error-banner` mixins, and a genuine zero-accounts state
(`accountsLoaded` flag) replaces perpetual "Loading…".

Automated coverage (green at review): `allocation-page.component.spec.ts`
pins header-bar composition, the single instant tab group, the bounded
shell chain (including the injected wrapper rule), and the empty state;
371/371 portfolio-dashboard tests + `ng build` clean. This UAT covers
the live-data and visual checks the specs can't see.

## Prerequisites

- Dev server running: `npm start` (Observation API `:3456` + `ng serve`
  on `:4210`).
- Signed-in user with at least one Robinhood account. For the account
  toggle scenarios: ≥2 accounts (mark N/A if only one).
- For the scroll scenario: enough buckets that expanding all rows
  overflows the viewport — or shrink the browser window until it does.
- Chrome/Edge devtools for the scroll-container and token checks.

## Start

1. Navigate to `http://localhost:4210/portfolio` (sign in if prompted).
2. Click **Allocations** in the dashboard header bar to reach
   `/portfolio/allocation`.

## Scenarios

### 1. Header bar composition

- **Steps:** Inspect the top of the allocation page.
- **Expected:** A single `56px`-class header bar (`page-header`
  testid): account-switcher pill group left; right-side actions are a
  stroked **Portfolio** link (`back-to-portfolio`, navigates back to
  `/portfolio`) and an icon-button refresh (`refresh-btn`, tooltip
  "Refresh"). No old toolbar row; no page title in the bar — the global
  app header carries the title.
- **Result:**

### 2. Account pill switch

- **Start:** ≥2 accounts.
- **Steps:** Click a different account pill (`acct-toggle-*` group).
- **Expected:** Account strip re-scopes (values change); Buckets and
  Positions subtabs reload against the newly selected account; the
  selected pill shows the selected treatment. A non-agentic account
  pill renders its flag/tooltip.
- **Result:**

### 3. Account strip — data, not navigation

- **Steps:** Inspect the strip (`account-header`) directly under the
  header bar.
- **Expected:** Label-above-value pairs `Value | Allocated | Cash |
  Unassigned` separated by `|` hairlines on a `surface-container`
  tinted strip inside the centered content column; `as of …` timestamp
  (`as-of`) pinned right. No tabs or buttons inside it.
- **Result:**

### 4. Cash-divergence warning

- **Start:** Only observable when broker-reported cash diverges from
  derived cash for the selected account.
- **Steps:** If `cash-diverged` renders, hover the ⚠.
- **Expected:** Tooltip explains the divergence. If no divergence
  exists in live data, mark N/A (rendering covered by specs).
- **Result:**

### 5. Single tab row — instant switch

- **Steps:** Click **Positions** (`subtab-positions`), then **Buckets**
  (`subtab-buckets`).
- **Expected:** Exactly one tab row; switching is instant — no
  content-slide animation. Buckets table shows buckets/unassigned/cash;
  Positions tab shows the positions table with its filter + bulk
  actions.
- **Result:**

### 6. All expandos open → pane scrolls (QA #839 finding)

- **Steps:** On Buckets, expand every expandable row — each bucket name
  (`expand-*`), **Unassigned** (`expand-unassigned`), and the retired
  section's rows (expand the `Retired` group first) — until content
  exceeds the viewport height. Also switch to **Positions** and scroll
  to the last row.
- **Expected:** The scroll region is the **table's own wrap** — the pane
  toolbar (filter/New bucket) stays pinned and the sticky `thead` stays
  visible while rows scroll; every expanded panel AND the positions
  table's last row are fully reachable — nothing sits below the
  viewport edge.
- **Result:** FAIL (first pass) → fixed in-loop. Root cause: the routed
  `:host` used `height:100%`, but `mat-drawer-content` is a block
  container stacking `rs-header` (~56px) above the page — the page's
  bottom ~56px clipped below the viewport, hiding the tail of any tall
  pane. Fixed via `vl.page-host` (`calc(100vh - var(--header-height))`,
  the convention other pages already use); applied to allocation AND
  dashboard hosts (same latent bug). Re-run this scenario on both tabs.

### 7. Loading / error / empty states

- **Steps:**
  - a. Loading: hard-refresh the page (or switch accounts) and watch
    for the centered state block (`accounts-loading`, "Loading
    accounts…"), then per-tab `buckets-loading`/`positions-loading`
    blocks during their loads.
  - b. Error: not safely triggerable live — rendering is covered by
    spec (`load-error` / `account-error` banner, tokenized). Mark N/A.
  - c. Empty: only with zero accounts — mark N/A live; spec covers
    `accounts-empty` ("No Robinhood accounts available.") vs
    `accounts-loading` via the new `accountsLoaded` flag.
- **Expected:** Centered state block on the shared `state-block`
  convention; no perpetual spinner after a successful load.
- **Result:**

### 8. Retired-section chrome

- **Start:** An account with ≥1 retired bucket (or retire a scratch
  bucket).
- **Steps:** Expand the `Retired` collapsible.
- **Expected:** Toggle + retired rows render on token chrome
  (muted/secondary token colors, no hardcoded greys). Retired rows
  still expand/collapse their panels.
- **Result:**

### 9. Expando panel reads as inset, not a card

- **Steps:** Expand any bucket row and inspect the panel.
- **Expected:** Panel sits flush inside the row — `surface-container-low`
  tint + `outline-variant` left hairline, not a bordered card floating
  in a second wrapper. (This was the "tables inside two wrappers"
  complaint from QA #839.)
- **Result:**

### 10. Existing behavior regression

- **Steps:** Spot-check: create/edit/retire/delete on a scratch bucket;
  ≥100% total-target warning banner if applicable; Positions-tab
  `Unassigned (n)` count equals the expanded Unassigned panel rows;
  positions filter + bulk move.
- **Expected:** All unchanged from pre-#779 behavior.
- **Result:**

### 11. Dashboard regression (shared mixins)

- **Steps:** Return to `/portfolio` and compare the dashboard visually.
- **Expected:** Identical to before — its `.pd-tabs` tab chain,
  `.pd-tab-content` scroll pane, and `.pd-scoreboard` strip now emit
  CSS through the same shared mixins (`bounded-tab-group`,
  `tab-scroll-pane`, `stat-strip`); the dashboard's tall tab content
  still scrolls.
- **Result:**

### 12. Refinement pass

- **Steps:** Judge against the dashboard: (a) does the allocation page
  now read like the same product — header bar, centered column, no
  nested-card look? (b) dark theme — strip/table hairlines, banners,
  and state blocks legible with no hardcoded surfaces? (c) narrow
  viewport (~900px) — strip + tabs + tables hold up? (d) account strip
  reads as data, not a nav control?
- **Expected:** All pass or produce specific follow-up findings.
- **Result:**

## Traceability

| Task #779 AC | Scenario(s) |
|---|---|
| Header bar with account toggle + refresh in header actions, toolbar row removed | 1, 2 |
| Account-header strip inline below header — compact tokenized strip, data not nav | 3, 4 |
| Single `mat-tab-group`, `animationDuration="0"` | 5 |
| Retired-buckets section on token chrome | 8 |
| Loading/error/empty → shared mixins | 7 |
| Page shell bounds tab chain; expandos scroll (QA #839) | 6, 9 |
| Specs green | recorded below (automated evidence) |

## Regression / smoke checklist

- [ ] Dashboard page unaffected (scenario 11)
- [ ] Bucket CRUD + retired lifecycle (scenario 10)
- [ ] Positions tab: filter, bulk move, Unassigned count agreement (scenario 10)

## Results log

| Date | Run by | Result | Notes |
|---|---|---|---|
| 2026-10-07 | agent (automated) | PASS | `allocation-page.component.spec.ts` 19/19 green — exercises real DOM for scenarios 1–5, 7 (header bar composition, pill switch re-scoping, strip fields, divergence warning, single instant tab group, loading/error/empty states); `ng build` clean at review; compiled CSS verified to contain the live `.alloc-tabs .mat-mdc-tab-body-wrapper { flex:1; min-height:0 }` bound |
| 2026-10-08 | user | **PASS** | Scenarios 1–6, 8–12 confirmed ("thats good"→"all good"); two in-loop fixes landed during the pass — page-host `--header-height` clip fix and the row-level `.table-wrap` scroll + dense controls refinement |
