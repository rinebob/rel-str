**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Blueprint:** #635  
**Task:** #644  
**Domain:** DEV-TOOLS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-09-29  

# Code Review — FE `/tools/topic-viewer` route + nav entry

## Files changed

- `src/app/core/common/interfaces.ts` — `AppRoutes.TOPIC_VIEWER`
- `src/app/core/core-routes.ts` — lazy route, `canActivate: [authGuard]`
- `src/app/core/common/constants.ts` — `NAV_MENU_ITEMS` "Topic Viewer" entry
- `src/app/features/topic-viewer/topic-viewer-page.component.spec.ts` — route + nav spec block

## Review axes

**Standards + spec (combined — 3-line surface):** PASS. Route matches sibling convention exactly (lazy `loadComponent`, `authGuard`, enum-driven path); nav item shape matches `NavItem`; no regressions possible — pure additions.

## Iterations and fixes

**Round 1** — one gap found and fixed:

- **Spec gap** — AC "nav entry renders and routes" had no test; added `DevLifecycle route + nav` describe block asserting: route exists under `AppRoutes.TOPIC_VIEWER` with a non-empty `canActivate`, `loadComponent` actually resolves the module, nav entry exists with correct text/`external:false` (same convention as the allocation-page spec).

**Iteration 2** — CLEAN.

## Evidence

| Check | Result |
|---|---|
| `jest src/app/features/topic-viewer` | 30/30 pass |
| `ng build` | clean (one pre-existing DecimalPipe warning in user's allocation-page WIP) |

## Verdict

**PASS**
