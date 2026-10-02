**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #679  
**Thread Parent:** #660  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** TEST  
**Status:** Approved  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

# TEST (FE) — Journey Navigation

## E2E Journeys (manual QA)

1. **Daily loop via nav alone:** land on `/portfolio` → sidenav → Runs → Signal Review → Chart Review → Live order. Every hop one nav click; no pills required to *discover* the surface.
2. **Grouped sidenav:** sections render in order Portfolio / Signals / Trading / Options / Analysis / Tools + dashboard-v3 tail; every item routes to its canonical path.
3. **Legacy absence:** none of the 13 removed items appear in header or sidenav; direct URL to a removed item's route still loads (routes retained).
4. **Route rename:** old path `/signal-review` → falls through `**` → `/` → `/portfolio` (no alias by design); canonical `/signals/review` loads the component.
5. **Header:** brand reads "Savant Trader"; only menu + fullscreen toggle + auth present; no refresh-time, no symbols button.
6. **Show/hide:** toggle hides header on any page; floating chevron appears top-edge; clicking restores; chart pages still auto-hide on entry and their in-page fullscreen buttons still work both directions.
7. **Auth states:** signed-out → header shows login/signup, sidenav shows auth items only; signed-in → logout + full groups.

## Integration boundaries

- `UiStateService.fullscreen` — toggle/reveal must use the same signal the ~12 opt-in pages drive; no second source of truth.
- `core.component` drawer — `mode="over"` unchanged; nav emission contract `navigate(navItem)` unchanged.
- `AuthStore.isAuthenticated` — gating reads the existing signal; no new auth plumbing.
- Wildcard `**` → `/` — renamed old paths intentionally rely on this; confirm no surfaced error state.

## Unit test targets

- `NAV_SECTIONS` shape: every group non-empty; every item href resolves to a registered route path (iterate `core-routes` children — this catches enum/path drift).
- Canonical path set: assert the full tree (landing redirect, `/signals` + `/options` redirects, all leaf paths, `topic-viewer`).
- Sidenav render: groups render labels + items; unauthenticated filter shows auth-only.
- Header: brand text; absent refresh-time/symbols; toggle calls `uiState.toggleFullscreen`; reveal button visible iff `fullscreen()`.
- Existing specs that assert old paths or NAV_MENU_ITEMS contents — update to the new model (spec sweep is part of P1/P2).

## Test seams

- `UiStateService` — injectable, signal-based; trivially stubbed (`{ provide: UiStateService, useValue: { fullscreen: signal(false), toggleFullscreen: jest.fn() } }` — existing specs already do this).
- `AuthStore` — `isAuthenticated` signal stub.
- Route table assertions need no rendering — import `CORE_ROUTES` and `NAV_SECTIONS` in specs (precedent: `lifecycle-page.component.spec.ts` route/nav test for #644).

## Edge cases

- Hidden header + route change → fullscreen state persists (global signal; pages that don't opt in keep header hidden — intended) but any page's `setFullscreen(false)` on destroy restores.
- Symbol `$index`-based or position-based nav assumptions — none expected (nav is name-keyed).
- `heatmap-chart/:b/:s` param route — stays registered; nav removal only.
- `topic-viewer` — if the in-flight dev-lifecycle route lands as `dev-lifecycle` first, nav must still resolve (reconcile at impl time; spec asserts the canonical `topic-viewer` path exists OR the alias reconciled — decide in impl, assert final state).
