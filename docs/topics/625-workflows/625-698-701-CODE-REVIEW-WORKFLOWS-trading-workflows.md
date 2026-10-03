**Topic:** Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #698  
**Task:** #701  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** CODE-REVIEW  
**Status:** Complete — PASS (2 rounds; converged — round 2 produced only low findings, all fixed or accepted)  
**Created:** 2026-10-01  
**Last Updated:** 2026-10-01  

# Code Review — #701 FE Sidenav grouped rendering + auth gating

Three-axis review (Standards / Spec / Thermo-nuclear). Scope:
`sidenav-menu.component.{ts,html,scss,spec.ts}` — the component now renders
`NAV_SECTIONS` as labeled groups when `AuthStore.isAuthenticated()` is true,
otherwise a private `SIGNED_OUT_SECTIONS` list (Log in / Sign up) routed
through the same `navigate` emit. Dead code removed: unused `Router` inject,
`RouterModule` import, empty `ngOnInit`, `handleTestNavigation`, commented
logs.

## Findings and disposition

### Fixed in-place

| Severity | Finding | Fix |
|---|---|---|
| major | `var(--indra-main-font)` / `var(--mobile-nav-menu-item-color)` never defined → font/color rules silently no-op (`scss:33,53-54`) | Added fallbacks on all three `font`/color usages: `var(--indra-main-font, Arial, sans-serif)`, `var(--mobile-nav-menu-item-color, inherit)` |
| major | Nav items were clickable `<div>`s — no keyboard focus, role, or Enter/Space activation (`html` loop) | Items are now `<button type="button">` with resets and `:focus-visible` outline |
| minor | Dead SCSS selectors `.logo`, `.menu-text`, `.link-text` | Deleted |
| minor | Auth-state `computed` swap untested | New spec: `swaps sections when auth state changes` |
| minor | `signup` emitted payload unpinned | Auth-emit spec now clicks both items and pins both `NavItem`s |
| nit | Unnecessary `provideNoopAnimations()` in spec | Removed |

### Verified pre-existing / out of scope — deferred

| Severity | Finding | Disposition |
|---|---|---|
| minor | `mat-icon-button` inert — `MatButtonModule` never imported | Pre-existing (old imports were `[MatIconModule, RouterModule]`); close button styling is custom SCSS. Adding the module now would change appearance — deferred. |
| minor | Auth-resolution flicker: `isAuthenticated` is boolean while Firebase `onAuthStateChanged` resolves — signed-in users can briefly see the signed-out menu | Pre-existing `AuthStore` gap shared by the header (header.component.html:18 has identical exposure). Real fix is an `authResolved` signal in `AuthStore` — out of scope for #701. |
| nit | `as User` fixture cast in spec | Consistent with sibling `header.component.spec.ts`; only truthiness is consumed. |
| nit | Pass-through `handle*` emit wrappers | Matches codebase convention (`header.component.ts` `handleMenuOpen`). |
| nit | Hardcoded `lightgrey` hover | Pre-existing; theme-var migration is cosmetic and out of scope. |
| nit | Raw `'login'`/`'signup'` href strings vs `AppRoutes` enum | `NAV_SECTIONS` itself uses raw strings — consistent. |
| nit | `.logo-container` mysterious name (holds only close button) | Pre-existing; renaming is cosmetic. |
| nit | `outline: none` on `.menu-button` | Pre-existing close-button style. |

## Round 2

All three axes re-reviewed the post-fix state. Round-1 fixes verified
correct by all three axes. New findings — all low — and disposition:

| Finding | Fix |
|---|---|
| `<div>` inside `<button>` is invalid HTML (phrasing-content model) | Inner `.nav-menu-item` div merged into the button — `{{item.text}}` renders directly; one element deleted per item |
| Button reset incomplete (`appearance`, `color`) | Added `appearance: none` + `color: inherit` |
| `--indra-main-font`/`--mobile-nav-menu-item-color` indirection dead even with fallbacks; Arial fallback diverged from app's Roboto body font | Dropped the vars — literal `Roboto, Arial, sans-serif` (matches `styles.scss:63`) + `color: inherit` |
| Vestigial `text-decoration: none` (anchor-era leftover) | Removed with the div merge |
| Close button missing `type="button"` (nav buttons had it) | Added |
| Div→button a11y fix unpinned in spec | Click queries now select `button.nav-menu-item` — reverting to a div fails the spec |

### Accepted (not fixed — judged out of proportion for this task)

- Section groups lack landmark/list semantics (`role="group"`, `aria-labelledby`) — structural a11y polish; labels are visually grouped and items are now real buttons.
- "Signed-out hrefs ⊆ unguarded routes" is a cross-file invariant; partially covered by the emitted-literal pins + `core-routes.spec.ts` asserting `login`/`signup` exist.
- Label↔item grouping association asserted indirectly via order — accepted as thin but adequate.
- `CoreComponent.handleNavigation` has no direct spec — pre-existing gap, out of scope.

## Per-AC verdict

| Acceptance criterion | Verdict | Evidence |
|---|---|---|
| Groups render in journey order with labels; items route correctly | MET | Template iterates `NAV_SECTIONS` in order; `@if (section.label)` skips the unlabeled tail. All 18 hrefs verified against `core-routes.ts` (`nav-sections.spec.ts:48-57`). |
| Signed-out users see auth items only | MET | `SIGNED_OUT_SECTIONS` (component const, unlabeled); spec asserts `['Log in','Sign up']` + zero labels. `login`/`signup` are the two unguarded routes — nothing advertised that a signed-out user can't reach. |
| Signed-in users see all sections | MET | `computed(() => isAuthenticated() ? NAV_SECTIONS : SIGNED_OUT_SECTIONS)` |
| Drawer remains `mode="over"` | MET | `core.component.html` untouched. |
| `navigate` emit contract unchanged | MET | `output<NavItem>()`; parent routes `router.navigate([navItem.href])` — auth items ride the same emit. |
| Specs cover grouped render and auth filtering | MET | 8 specs: create, full item render, label order, click→emit (both states), auth-only render, auth transition, closeSidenav. |

## Test results

- Focused: `npx jest src/app/core/comps/sidenav-menu/sidenav-menu.component.spec.ts` — 8/8 pass.
- Full suite: `npx jest --coverage=false` — 165/165 suites, 2416 tests, all pass.

## Verdict

**PASS** — no critical findings; both majors fixed and re-verified green.
The code-judo shape is right: signed-out content reuses the `NavSection`
machinery (`label: ''` exploits the documented unlabeled-tail convention)
instead of a second template branch; the component is 49 lines and purely
presentational.
