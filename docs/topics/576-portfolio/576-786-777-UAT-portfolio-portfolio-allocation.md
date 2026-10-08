# UAT — Task #777: Dashboard page shell

**Topic:** #576 Portfolio Allocation  
**Thread:** #751 Portfolio Visual Consistency  
**Blueprint:** #775 (FE)  
**Task:** #777 — FE: Dashboard page shell — header bar + 1100px column + tokenized states  
**QA Issue:** #786  
**Status:** Complete  
**Code Review:** PASS — 576-775-777-CODE-REVIEW-portfolio-portfolio-allocation.md  

## Automated gate (executed)

| Check | Command | Result |
|---|---|---|
| Focused suite | `npx jest --coverage=false src/app/features/portfolio-dashboard/portfolio-dashboard.component.spec.ts` | 37/37 PASS |
| SCSS compiles | `npx sass portfolio-dashboard.component.scss` | clean |
| Bundle build | `npm run build` | clean (~70s) |
| Token discipline | grep for `rgba(`/`#` hex literals in component SCSS | only `vl.$down` accent (sanctioned) |

## Round 2 — refinement pass (user feedback, 2026-10-04)

User rejected the round-1 layout in QA: summary bar wasted a row, account
tabs + stacked content meant scrolling and lost table headers. Refactored:

- Summary bar **moved into the header** as a signal-order-style scoreboard
  (`.sb-label` / monospace `.sb-value` / `|` separators).
- **Privacy default**: scoreboard dollar values masked as `•••` until the
  eye toggle is pressed; persists via `localStorage['pd-show-amounts']`.
  Holdings tables are unaffected.
- **Account tabs → pill row**: `mat-button-toggle-group` (the pattern #778
  converges the allocation page on).
- **Single section tab row**: Equities | Options | Orders | History |
  Account — each pane scrolls internally; `animationDuration="0ms"`.
- **Header nav**: `Allocations` stroked link → `/portfolio/allocation`;
  allocation page toolbar gained a `← Portfolio` back link (interim until
  #779 builds its header bar).

## Manual/visual checklist

Execute against a running dev server at `/portfolio`.

| # | Check | Expected |
|---|---|---|
| 1 | Header bar | Compact bar: icon + "Portfolio" + scoreboard + actions; `surface-container-high` bg + bottom hairline |
| 2 | Scoreboard | Value/Exposure/Cash/BP/PnL in one row, signal-order font treatment; fits without wrapping |
| 3 | Masked by default | All five values show `•••` on first visit; eye icon shows `visibility_off` |
| 4 | Reveal toggle | Eye icon → amounts appear; icon flips to `visibility`; reload keeps the choice (localStorage) |
| 5 | Allocations link | Stroked button → `/portfolio/allocation`; that page has `← Portfolio` back link |
| 6 | Account pills | Toggle row under header; switching accounts swaps all tab content |
| 7 | Section tabs | Equities/Options/Orders/History/Account; no slide animation |
| 8 | No outer scroll | Page doesn't scroll; each tab pane scrolls internally; tab bar stays put |
| 9 | Loading / error / empty | Tokenized states unchanged from round 1 |
| 10 | Dark theme | No hard-coded light-theme bleed |
| 11 | Narrow viewport | Scoreboard clips gracefully; pills wrap/scroll acceptably |

## Results

- [x] All manual checks executed — user walkthrough on dev server, 2026-10-04
- Round 1 layout rejected (summary row wasted space, stacked sections scrolled); round-2 redesign accepted
- **QA verdict:** PASS
