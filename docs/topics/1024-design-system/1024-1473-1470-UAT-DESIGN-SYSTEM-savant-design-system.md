**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1473  
**Task:** #1470  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-12  

# UAT — Sidenav visual hierarchy + DS-sweep fixes (#1470)

## Scope

Task #1470 restyles the sidenav menu panel (accent section headers and
separators, muted routes with hover pills, accent active-route state with
`aria-current`, rotating submenu chevron) and bundles DS-sweep fixes:
`dse-select` element-form chrome + `compact` variant, `dse-check`/`dse-radio`
conversions in open-orders-table and rs-chart-view, `ds-toast` dark restyle,
and the `ds-input-chrome` placeholder color correction.

Code review: `1024-1163-1470-CODE-REVIEW-DESIGN-SYSTEM-savant-design-system.md`
— PASS (2 rounds).

## Prerequisites / getting to the feature

- Repo at `C:\aa\projects\rel-str`, deps installed.
- Dev server: `npm start`, browse to `{origin}` — sign in (nav is
  auth-gated; signed-out shows only auth items).
- **Surface:** the left sidenav drawer. **Entry point:** the hamburger
  button in the app header (any route). The Dev submenu lives under
  Tools → Dev.
- The bundled fixes' surfaces: backtest filter bars
  (`/trading/backtest` family pages, strategy-build selects),
  open-orders-table checkboxes (`/portfolio` → Orders tab),
  rs-chart-view MA-type radios (dev page), any toast (e.g.
  `/options/strategy/backtest` → New Replay).

## Automated scenarios (executed by QA agent)

| # | Scenario | Command | Expected | Result |
|---|---|---|---|---|
| A1 | Sidenav unit coverage — rendering, hover-open flyout + deferred close, navigation, emissions, signed-in/out swap, active-route exact match, submenu-child active + aria-current | `npx jest src/app/core/comps/sidenav-menu --coverage=false` | 13/13 pass | **PASS** |
| A2 | Shell regression — core component + header consumers of `PageIdentityService` | `npx jest src/app/core --coverage=false` | all pass | **PASS** — 366/366 |
| A3 | Regression — full suite | `npx jest --coverage=false` | all pass | **PASS** — 5466/5466 tests, 307/309 suites (2 suites fail to compile on missing `plotted-entry-narrow` files — in-flight #1471 work, outside this diff) |
| A4 | Typecheck | `npx tsc -p tsconfig.app.json` | clean | recorded below |

## Manual scenarios (browser — user executes or confirms)

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| M1 | Accent headers + separators | Open sidenav (dark theme) | PORTFOLIO / SIGNALS / TRADING / OPTIONS / ANALYSIS / TOOLS labels render accent cyan with accent separator lines; first label flush against top | |
| M2 | Same in light theme | Toggle theme, reopen sidenav | Labels/separators render the light-theme accent (teal) | |
| M3 | Route muted + hover pill | Hover each route | Routes muted gray at rest; hover brightens text + shows hover pill | |
| M4 | Active route | Navigate `/portfolio/allocation` | "Portfolio Allocation" shows accent pill + accent text + `aria-current`; "Portfolio Dashboard" is NOT lit (exact match) | |
| M5 | Submenu active | Navigate `/dev/flex-chart`, open Tools → Dev | "Dev" trigger tinted; "Flex Chart Sandbox" child shows accent + `aria-current="page"` | |
| M6 | Hover submenu + chevron | Hover the Dev trigger, then move the cursor into the menu; leave the region | Menu opens on hover (no click needed) as a flyout anchored to the Dev item, right of the drawer edge and viewport-clamped — out of layout flow, no page scroll growth; ▸ rotates 90° while open; closes on leaving the region (deferred close bridges the gap to the menu) | |
| M7 | Signed-out | Sign out, open sidenav | Only auth items — no feature nav, no section labels | |
| M8 | Compact selects | `/options/strategy/backtest` filter bars (both run-control toolbars; also `/dev/screenshot`) | Selects are 24px DS-chrome controls with drawn chevron, aligned with adjacent buttons | |
| M9 | Checkbox/radio | `/portfolio` Orders tab (needs open orders to render); rs-chart-view MA types | Drawn `dse-check`/`dse-radio` controls, not native boxes | |
| M10 | Toast | `/options/strategy/backtest` → New Replay | Toast renders dark surface + accent border + accent "Dismiss" text action — not the old white card | |
| M11 | Placeholder | `/dev/screenshot` empty RefId field | Placeholder text muted gray — not teal, not confusable with a typed value | |

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| Accent section headers + separator lines, theme-aware | M1, M2 |
| Muted routes + hover pill | M3 |
| Active route accent pill + `aria-current`, exact match | A1, M4, M5 |
| Submenu child active state + chevron rotation | A1, M5, M6 |
| Signed-in/signed-out nav unchanged | A1, M7 |
| `dse-select`/`compact` element-form chrome app-wide | M8 |
| `dse-check`/`dse-radio` conversions | M9 |
| `ds-toast` dark restyle | M10 |
| Placeholder color fix | M11 |

## Regression checklist

- [x] Full jest suite — 5466/5466 green (A3)
- [x] Core shell specs — 366/366 (A2)
- [x] Build compiles after style changes (verified during implementation)

## Findings

(none)

## Results log

**2026-11-11 (automated):** A1–A3 PASS (sidenav 13/13, core 366/366,
full suite 5466/5466 — 2 unrelated compile failures in the missing
`plotted-entry-narrow` spec dir, in-flight #1471). A4 typecheck clean.

**2026-11-12 (manual):** M1–M5, M7, M10, M11 user-confirmed PASS.
M6 reworked during QA to a viewport-anchored flyout (absolute inside the
`position: relative` submenu host — `mat-drawer`'s transform defeats
`position: fixed`; 250ms deferred close bridges the gap from trigger to
menu) — user-confirmed PASS: "ok yes thats the correct one".
M8 route corrected to `/options/strategy/backtest` during QA — PASS.
M9 partially user-verifiable (no open orders to render the checkboxes;
rs-chart-view is legacy) — confirmed at spec level by the dse-check/
dse-radio markup and component specs; no visual regression observed
where controls do render.
