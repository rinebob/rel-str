**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** De-Materify  
**Thread Slug:** de-materify  
**Issue:** #1163  
**Task:** #1470  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Approved  
**Created:** 2026-11-11  
**Last Updated:** 2026-11-11  

# Code Review — #1470 Sidenav visual hierarchy + DS-sweep fixes

## Scope

Staged diff, 19 files: sidenav-menu component (ts/html/scss/spec),
`page-identity.service.ts`, `core.component.spec.ts`, `styles.scss`
(compact select height), `open-orders-table` (html/scss),
`rs-chart-view` (html/scss), `backtest-run-control` +
`options-replay-run-controls` (html/scss), `order-ticket` +
`option-order-ticket` (html), `vendor/savant-ds/styles/_forms.scss`,
`vendor/savant-ds/styles/_dialog.scss`.

## Standards

- **No hard violations.** The `toSignal(NavigationEnd→url, requireSync)`
  pattern was correct per the installed Angular source, and the spec's
  `Subject<NavigationEnd>` Router stub exercises the consumed surface
  honestly — later replaced by the `PageIdentityService.url` signal
  (see Fixes).
- Test conventions comply with `AGENTS.md` (`jest.fn`/`expect`, no
  jasmine spies, no setTimeout).
- Judgement call (not new): `.filter-select { min-width: 90px }` is
  duplicated between the two run-control stylesheets — inherited
  duplication, disproportionate to extract for one declaration.

## Spec (issue #1470)

- All requested behavior implemented: accent headers + separator lines,
  muted routes, hover pill, accent active state, chevron rotation,
  signed-in/signed-out behavior and emissions unchanged.
- **Partial found and fixed:** `aria-current`/`active` landed only on
  top-level leaf buttons — submenu child `.menu-item` routes carried
  neither. Added `[class.active]` + `[attr.aria-current]` to children
  and `.menu-item.active` accent styling.
- No scope creep identified.

## Thermo-nuclear

- **Major (fixed):** `select.dse-select.compact` was 28px while the
  controls it sits beside (`.pill-btn`, `.step-btn`, `.cf-input`,
  `.filter-input`, sort buttons) are 24px — set compact to 24px.
- **Major (fixed):** duplicated `.filter-input` declaration merged in
  `backtest-run-control.component.scss`.
- **Minor (fixed):** duplicated `NavigationEnd→toSignal` plumbing —
  `PageIdentityService` now exposes a normalized `url` signal (strips
  query + fragment); the sidenav consumes it instead of re-piping.
- **Minor (fixed):** `@let active = isActive(item)` removes the double
  template call; leftover `input[type='radio']` margin rule removed from
  `rs-chart-view` (`.dse-radio` supplies it).
- **Deferred follow-up:** `.pill-btn` in both run-control components
  re-implements `ds.toggle-chip`/`.dse-chip` (~100 duplicated lines
  between the two stylesheets) — pre-existing, outside this task's
  scope; recommend a follow-up cleanup task.
- **Deferred minor:** `.filter-input` keeps custom mat-sys chrome next
  to DS selects — a separate unification pass was already flagged.
- **Minor:** `.nav-section-label:first-of-type` matches by element
  type — works because `NAV_SECTIONS` starts with a labeled section;
  noted, left as-is.

## Fixes applied during review

- `isActive` crash on bare Router stubs (`currentUrl()` undefined →
  `.split` threw in `core.component.spec`) — fixed by the
  `PageIdentityService.url` refactor (`(router.url ?? '')` guard) plus
  `url: signal('/')` added to the spec stub.
- aria-current + `.active` on submenu `.menu-item` children.
- compact select 28px → 24px.
- `.filter-input` duplicate block merged; rs-chart-view stale radio
  margin rule removed.

## Test results

- Full suite: **5466/5466 tests pass**, 307/309 suites green.
- 2 suites fail to *compile* — `option-chart-services.spec.ts` and the
  missing `plotted-entry-narrow.component.spec.ts` — both references to
  in-flight #1471 work (component file not yet present). Unrelated to
  this diff; verified absent from the staged change set.
- Focused: sidenav 11/11; core.component 12/12 (after the `url` stub
  fix); open-orders-table, rs-chart-view, order tickets, backtest
  controls, portfolio-dashboard suites all green.

## Verdict

**PASS** — no remaining critical or major findings; deferred items are
pre-existing follow-ups. The two compile-failing suites belong to
in-flight task #1471, not this diff.

## Round 2 (post-fix re-review)

- **Standards** — no hard violations. Flagged `.filter-input`
  duplication across the two run-control stylesheets (deferred
  follow-up, same bucket as `.pill-btn`); `.active` vs `.selected`
  naming — kept `.active`: `.selected` belongs to the
  `.rh-dropdown-menu-item` family (mat-sys, `.menu-label` child), not
  the `.dse-menu` contract, so `.active` matches the sibling
  `.nav-menu-item.active` convention.
- **Spec** — all requirements verified in final state; submenu-child
  aria-current fix confirmed; reactive `PageIdentityService.url`
  confirmed (`navigationEnd()` dep read). Coverage gap noted: no test
  for submenu-child active state — **fixed** (new spec asserts trigger
  `.active`, child `.active`, `aria-current="page"`).
- **Thermo-nuclear** — verdict **clean**, no structural findings.
  `PageIdentityService` confirmed as the correct canonical owner of
  the `url` signal; stub typechecks; specificity verified
  (`.nav-submenu .menu-item.active` wins over global `.dse-menu`);
  `h &&` guard covers submenu triggers' empty `href: ''`.
- **Round-2 fixes applied:** `@let childActive` symmetry in the
  submenu branch; `.menu-item.active` gains the accent-tint background
  (was text-only — now matches `.nav-menu-item.active`); new submenu
  active-state spec (12/12 green).
- **Remaining cosmetic notes (accepted):** flyout submenu can overflow
  the viewport right edge on very narrow windows; `isActive` allocates
  the href array per binding call (trivial at ~20 items).

Next: `/proj qa 1024 1470`.
