**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #837  
**Thread Parent:** #823  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** Test Plan  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-07  

# Test Plan — App-wide Header Unification (FE)

Companion implementation plan: `625-823-837-IMPL-WORKFLOWS-FE-trading-workflows-header-unification.md`.
PRD: `625-823-824-PRD-WORKFLOWS-trading-workflows-header-unification.md`.

All coverage is Jest (`npx jest`) — no Playwright/E2E harness exists in this repo; the end-to-end acceptance surface is the manual exit UAT described in the PRD.

## Test seams

| Seam | Spec file | What it pins |
|---|---|---|
| Registry ↔ route table | `src/app/core/core-routes.spec.ts` | Contract-level invariants that cannot silently rot |
| Route → header identity | `src/app/core/comps/header/header.component.spec.ts` | Behavior across real `Router` navigation (existing spec file already boots the component) |
| Page templates | existing per-page specs | Sweep must not break them — run the full suite |

## Cases

### Registry + route wiring (Task 1) — `core-routes.spec.ts`

| # | Case | Assertion |
|---|---|---|
| 1 | Registry exhaustiveness | Every `AppRoutes` member has a `PAGE_INFO` entry with non-empty `title` and `icon` — iterating the enum, not a hardcoded list, so a new member fails the spec |
| 2 | Leaf titles sourced from registry | Every leaf route's `title` equals `PAGE_INFO[path].title` — no hand-typed title strings in the route table |
| 3 | Prefix-resolvable paths | Every leaf `routeConfig.path` resolves a `PAGE_INFO` key either directly or via ancestor prefix — guards the lookup contract if nesting is introduced |

### Header identity zone (Task 2) — `header.component.spec.ts`

| # | Case | Assertion |
|---|---|---|
| 4 | Identity renders after navigation | Navigate to `signals/review` → header shows the `PAGE_INFO` icon + "Signal Review"; navigate to `trading/live` → updates to "Signal Order" |
| 5 | Parameterized route | `heatmap-chart/AAPL/MSFT` resolves the `heatmap-chart/:baseline/:symbol` entry |
| 6 | Redirect chain | Navigate to `signals` → header shows the Run Dashboard identity (redirect target's leaf wins) |
| 7 | Nested-path inheritance | Synthetic child `{path:'detail'}` under a known path → header shows the ancestor's identity (longest-prefix behavior) |
| 8 | Unkeyed path | A path with no `PAGE_INFO` match (wildcard/anonymous) renders an empty identity zone — no stale title from the previous page |
| 9 | Public route | `login` renders its identity while the auth buttons show Login/Sign up — identity is not auth-gated |
| 10 | Existing behavior preserved | Menu emit, fullscreen toggle, auth section unchanged — existing specs continue to pass unmodified |

### Sweep (Task 3) — full suite + inventory

| # | Case | Assertion |
|---|---|---|
| 11 | No regressions | `npx jest` green end-to-end — deleted title markup must not orphan per-page specs |
| 12 | Inventory completeness | Every routed page appears in the UAT inventory table with a deleted/kept/none verdict |

## Edge cases deferred explicitly

- Long-title overflow / very narrow viewports: CSS-only, verified visually in the exit UAT, not spec'd.
- Icon validity (does `mat-icon` resolve the symbol name): visual check during sweep; not unit-testable meaningfully.
