**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #698  
**QA Issue:** #738  
**Task:** #701  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** UAT  
**Status:** Complete — all 10 scenarios PASS (user-executed); group-header styling refined during QA per user feedback
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# UAT — #701 Sidenav grouped rendering + auth gating

Code review: `625-698-701-CODE-REVIEW-WORKFLOWS-trading-workflows.md` —
PASS (2 rounds, converged). This is the visible payoff of the Journey
Navigation thread: the sidenav renders `NAV_SECTIONS` as labeled groups
when signed in, and auth-actions only when signed out. Nav items are now
real `<button>`s (keyboard-focusable). Rides along with #740 (spec-only:
`SIGNED_OUT_SECTIONS` moved to `constants.ts`, unguarded-href invariant +
`CoreComponent.handleNavigation` wiring specs — no UI surface).

Dev server: `npm start` → `localhost:4200` (preview already running).

## Scenarios

| # | State | Steps | Expected | Result / Evidence |
|---|---|---|---|---|
| 1 | Signed in | Open sidenav (hamburger) | Group labels render in journey order, uppercase/dimmed: **Portfolio, Signals, Trading, Options, Analysis, Tools** — then Dashboard V3 at the bottom with **no label** | |
| 2 | Signed in | Read the item list | All 18 canonical items present under their groups, in PRD order | |
| 3 | Signed in | Click one item per group | Routes to canonical URL (`/portfolio`, `/signals/runs`, `/trading/live`, `/options/chain`, `/analysis/swings`, `/tools/account`); drawer closes on click | |
| 4 | Signed in | Tab through the sidenav, press Enter on an item | Items are keyboard-focusable (focus ring visible), Enter activates navigation | |
| 5 | Signed out | Open sidenav | Only **Log in** and **Sign up** render — no group labels, no feature items | |
| 6 | Signed out | Click each auth item | Log in → `/login`; Sign up → `/signup`; drawer closes | |
| 7 | Either | Open sidenav, click backdrop / press Escape / use X button | Drawer overlays content (`mode="over"`), dismisses normally | |
| 8 | Signed in, fullscreen page | Open sidenav from a fullscreen route, navigate | Drawer + items work while header hidden; reveal chevron still restores header | |
| 9 | Either | Watch console while exercising 1–7 | No console errors | |
| 10 | Either | Resize to narrow viewport | Grouped menu remains readable at mobile width | |

## Traceability

| AC | Scenario(s) |
|---|---|
| Groups render in journey order with labels | 1, 2 |
| Items route correctly | 3, 4 |
| Signed-out → auth items only | 5, 6 |
| Signed-in → all sections | 1, 2 |
| Drawer `mode="over"` unchanged | 7 |
| `navigate` emit contract unchanged | 3, 6 (routing + close work through the existing emit) |
| Refinement pass (keyboard, hierarchy, states) | 4, 10 |

## Regression smoke

- Header unchanged: brand, fullscreen toggle, auth block, no topnav row.
- `nav-sections.spec.ts` / `sidenav-menu.component.spec.ts` / `core.component.spec.ts` — all green (231 core tests).
