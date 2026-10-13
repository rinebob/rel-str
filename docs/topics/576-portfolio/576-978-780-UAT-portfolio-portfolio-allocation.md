# UAT — Task #780: Tables → dense-table convention

**Topic:** Portfolio Allocation  
**Topic Slug:** portfolio-allocation  
**Thread:** Portfolio Visual Consistency  
**Issue:** #978  
**Thread Parent:** #751  
**Topic Parent:** #576  
**Task:** #780  
**Domain:** PORTFOLIO  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-13  

## Scope

Presentation-only migration of six portfolio/allocation table surfaces to the shared `dense-table()` SCSS mixin (`src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`). No behavioral or data changes. Review fixes also landed: two previously-undefined `--mat-sys-*` tokens added to `src/styles.scss` (hairlines/hover/tints now actually render), `thead` z-index → 2, `.pd-totals td` z-index → 1, warn-banner → warning tokens, `.expand-row > td` child combinator, dead `--mdc-*` button vars renamed to live `--mat-*` names.

Task acceptance criteria:
- `allocation-buckets-table` (incl. expando mini-table + totals row) — dense-table spec
- `allocation-positions-table` — dense-table spec
- `equity-positions-table`, `option-positions-table`, `open-orders-table`, `order-history-table` — dense-table spec
- Right-aligned numeric columns, expando mechanics, column sets preserved
- All colors tokenized — no hard-coded greys/reds; P&L accents via the partial's up/down tokens
- Specs green

## Prerequisites

- Dev server running (`npx ng serve`, typically http://localhost:4210)
- Logged in with at least one Robinhood account that has positions and order history
- At least one allocation bucket configured (for the expando and, ideally, an over-100% target for the warn banner)

## Start instructions

1. `npx ng serve` → http://localhost:4210
2. Navigate to `/portfolio` (dashboard) and `/portfolio-allocation` (allocation page)

## Scenarios

### 1. Equity positions table (`/portfolio`, Equity tab)
- **Confirms:** dense-table spec + `.num` alignment + pinned totals + sticky chrome
- **Steps:** Open `/portfolio`, ensure a Robinhood account with equity positions is selected via the header pills. Scroll the table rows.
- **Expected:** 12px dense cells; 11px uppercase bold header pinned at top with `surface-container` background; hairline row borders visible; row hover shows a subtle tint; numeric columns (Entry, Price, Chg%, PnL, PnL%, Qty, Value) right-aligned with tabular numerals; totals row pinned at the bottom of the table wrap while rows scroll under it; Close/Add Stop action buttons scroll **under** the header and totals — no button/icon painting over the sticky chrome.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 2. Option positions table (`/portfolio`, Options tab)
- Same checks as scenario 1 on the Options table (8 numeric columns, totals row pinned bottom).
- **Result:** PASS (visually verified by user, 2026-10-13)

### 3. Open orders table (`/portfolio`)
- Numeric columns (Limit, Qty, Filled) right-aligned; sort headers clickable with arrows; Cancel buttons functional; dense spec applied.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 4. Order history table (`/portfolio`)
- Numeric columns (Limit, Qty, Avg Fill) right-aligned; sort works; dense spec applied.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 5. Allocation buckets table + expando (`/portfolio-allocation`, Buckets tab)
- **Steps:** Open `/portfolio-allocation`. Click the expand chevron on a bucket row (and on Unassigned).
- **Expected:** Dense spec on the main table; numeric columns right-aligned; expando opens showing the stats strip + positions mini-table + its totals row; the expando cell has the tinted background + 3px left accent bar + 8px padding (reads as one open row); the mini-table's cells are dense 5px/10px (not 8px) and it has **no** second sticky header; empty positions shows the empty state; Cash row is italic + tinted; Unassigned row is dimmed; P&L/Drift columns show green/red accents.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 6. Warn banner (`/portfolio-allocation`)
- If bucket targets total >100%: amber banner (`warning-container` tokens — light orange background, dark orange text) renders above the table and stays put while rows scroll.
- If targets ≤100%, note N/A.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 7. Allocation positions tab (`/portfolio-allocation`, Positions tab)
- Filter pills work; select-all and row checkboxes work; bulk selection bar + Assign/Move actions render; Assign/Move open their flows; the link icon on linked positions renders; empty state (`@empty`) shows a centered 32px-padded row.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 8. P&L accent colors — all surfaces
- **Confirms:** review fix — mixin `td` color no longer defeats accent classes.
- **Expected:** Green/red appears on PnL **and** PnL% cells, equity/options totals P&L, bucket Drift/Realized/Unrealized, and mini-table Unrealized. No accent cell renders plain black.
- **Result:** PASS (visually verified by user, 2026-10-13)

### 9. Table states
- Loading → centered spinner; zero positions → empty blocks; error → error block + Retry (simulate by toggling network offline in DevTools and refreshing a tab, or accept code-verified if data is present).
- **Result:** PASS (visually verified by user, 2026-10-13)

### 10. Refinement / regression eyeball
- Density consistent across `/portfolio` and `/portfolio-allocation`; no table looks looser than neighbors; sort icons align in right-aligned numeric headers; no layout break at ~800px width; icon buttons in rows render 16px icons (post-AM20 token rename — compare against an un-migrated icon button if unsure).
- **Result:** PASS (visually verified by user, 2026-10-13)

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Buckets table + expando mini-table + totals — dense spec | 5 |
| Allocation positions table — dense spec | 7 |
| Equity / options / open orders / order history — dense spec | 1, 2, 3, 4 |
| Right-aligned numerics, expando mechanics, column sets preserved | 1–5, 7 |
| Colors tokenized; P&L accents via up/down tokens | 1, 5, 6, 8 (+ code review) |
| Specs green | Automated evidence below |

## Automated evidence

| Check | Command | Result |
|---|---|---|
| Six table suites | `npx jest src/app/features/portfolio-dashboard --coverage=false` | 516/516 pass (2026-10-12) |
| Focused table specs post-remediation | `npx jest` on the 6 table spec files | 86/86 pass (2026-10-12) |
| Build / SCSS compile | `npx ng build` | clean (2026-10-12) |

## Findings

1. **Multiple loading spinners on `/portfolio`** (reported mid-QA, resolved in-cycle): the tab group mounted as soon as accounts resolved while sections still loaded, so the global spinner + up to 4 per-table spinners showed simultaneously. Fix: tab group gated on `!globalLoading()` — one global "Loading…" until all responses settle, then all tables mount together (per-table spinners retained for section retries). Spec: `suppresses section tabs while global loading…`. **User re-verification:** refresh `/portfolio` → single loading block → full page at once.
