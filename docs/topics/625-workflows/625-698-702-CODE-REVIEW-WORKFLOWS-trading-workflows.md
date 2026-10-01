**Topic:** Trading Workflows  
**Topic Slug:** trading-workflows  
**Thread:** Journey Navigation  
**Thread Slug:** journey-navigation  
**Issue:** #698  
**Task:** #702  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** CODE-REVIEW  
**Status:** Complete — PASS (1 finding round, all fixed in-round)  
**Created:** 2026-09-30  
**Last Updated:** 2026-09-30  

# Code Review — #702 FE Header refactor (Savant Trader brand + global show/hide)

Three-axis review (Standards / Spec / Thermo-nuclear). Scope:
`header.component.{ts,html,scss,spec.ts}`, `core.component.{html,scss,spec.ts}`,
`core.component.ts`, `src/styles.scss`, deletion of `refresh-time/` (component +
NgRx store), deletion of `select-stock-dialog.service.ts`, the sticky-fullscreen
bug fix (`order.component.ts`, `triage-report.component.ts` — both gained
`ngOnDestroy → setFullscreen(false)`), and the round-1 sweep converting 16
hardcoded `calc(100vh - 64px|4rem)` sites to `var(--header-height, 48px)`.

## Findings

### Round 1 — all resolved

| Sev | Finding | Resolution |
|---|---|---|
| Major | `--app-header-height` 64px→48px stranded ~13 hardcoded `calc(100vh - 64px)`/`4rem` sites → 16px dead band when header visible (Standards + Thermo converged) | Swept all 16 sites to `var(--header-height, 48px)`; `--header-height` is bound on `mat-drawer-content` and inherits to every routed page. Bonus: pages lacking a `.fullscreen` override (backtest-dashboard, spread-chart) had a permanent 64px hole in fullscreen — now fixed for free since the var is `0px` there |
| Major | `.header-reveal` chevron pinned `top:0; left:50%` can visually cover and swallow clicks on page-header controls that occupy top-center (signal-review filter pills, order scoreboard, triage date fields) | Kept spec-mandated top-edge placement (PRD: "floating chevron, not a hover strip"). Mitigated: it's a single 40px icon button. **QA watch item** — exercise collision on signal-review/order at ~1280–1600px widths |
| Minor | Chevron capped below CDK overlays — `mat-drawer-container` (z-index:1) creates a stacking context; dialogs/menus/tooltips/snackbars paint above it | Accepted limitation: modal overlays block interaction anyway; chevron reappears when the overlay closes. Noted for QA |
| Minor | No regression test for the `ngOnDestroy` fix; triage-report had no spec at all | Added `resets fullscreen on destroy` to `order.component.spec.ts`; created `triage-report.component.spec.ts` (init sets fullscreen + destroy resets) |
| Minor | Dead `.menu-button` rule in `core.component.scss` (can never match — the element lives inside HeaderComponent's encapsulated view) | Deleted |
| Minor | `menu` icon-button lacked `aria-label` (the two new buttons had them) | Added `aria-label="Open navigation menu"` |
| Minor | Stale `64px` fallback in `run-dashboard/dashboard.component.scss` | → `var(--header-height, var(--app-header-height))` |
| Nit | `AuthStore` mock used independent signals → impossible states | `isAuthenticated` now `computed(() => !!user())`, matching the real store invariant |
| Nit | Missing `Sign up → /signup` nav test; dead Firebase providers in core spec; untested `--header-height` binding + `openSidenav` wiring | All four added/removed in core + header specs |
| Nit | Redundant `RouterModule`, empty `ngOnInit`, `console.log` in `core.component.ts`; double-margin + unreachable selector in header scss | All removed |
| Nit | Chevron lacked `matTooltip` (every per-page toggle has one) | Added `matTooltip="Show header"` + `MatTooltipModule` |

### Verified clean by axes

- Deletions: zero remaining references to `RefreshTimeComponent`/refresh-status
  store or `SelectStockDialogService`. `Subcollection.REFRESH_STATUS` and
  `st.store.refreshStatus()` are unrelated live paths — correctly untouched.
- `SelectStockDialogComponent` retained — still imported by `stock-list-form`
  (dashboard-v2). Functionally unreachable now (no `dialog.open` call site) —
  residual dead-weight island noted, removal deferred to legacy-page teardown.
- Destroy/init ordering: `ngOnDestroy → setFullscreen(false)` runs synchronously
  during deactivation before the next page's `ngOnInit → setFullscreen(true)` —
  single re-render, no header flash on fullscreen→fullscreen navigation.
- Spec axis: all 5 ACs verified MET with file:line evidence; 13
  `setFullscreen(true)` opt-ins intact; in-page toggles unchanged.

## Test results

Full suite green: **163 suites / 2354 tests** (includes 8 new header spec tests,
5 new core spec tests, new triage-report spec, order destroy regression).
SCSS parse check on all 15 edited stylesheets: clean.

## Verdict

**PASS**

## QA watch items

- Chevron vs top-center page controls on signal-review / order at mid widths.
- Chevron behind modal dialogs while fullscreen (dismiss dialog to reveal).
- Pages now size to the real 48px header — spot-check signal-history,
  dashboard-v3, rs-chart-view for correct bottom edge.
