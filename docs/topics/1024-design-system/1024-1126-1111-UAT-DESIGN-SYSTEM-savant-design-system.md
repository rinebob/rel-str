# UAT — #1111 vendored sync + /dev/ds Widgets section (QA #1126)

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1126  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1111  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS — mechanical checks green; visual refinement confirmed by user

## Scope

Task #1111 lands the widget layer in both apps' vendored copies and adds
the `/dev/ds` Widgets section — 9 demo cards exercising the real emitted
mixin output (`ds.*`), which is also the visual confirmation package QA
#1123 deferred (no user-facing surface at package level).

## Prerequisites

- Dev server running (`npm start` — already serving at `localhost:4200`).
- Signed in (route is behind `authGuard`).

## Test scenarios

| # | Scenario | Steps | Expected | Result | Evidence |
|---|----------|-------|----------|--------|----------|
| S1 | Vendored parity — rel-str | `cmp` each of 7 `vendor/savant-ds/styles/*` vs `C:\aa\projects\savant-ds\styles\` | byte-identical | **PASS** | 7/7 identical incl. `_widgets.scss` + `_index.scss` |
| S2 | Vendored parity — av-proxy-api | same against SA vendor dir | byte-identical | **PASS** | 7/7 identical |
| S3 | `vl.*` shim resolution | sass compile probe of all 9 mixins through `_pd-visual-language.scss` | emits rules; shim diff = 0 | **PASS** | 49 rules emitted; `git diff` on shim = 0 bytes |
| S4 | Widgets section structure | `npx jest ds-gallery` | 7/7 — 9 `data-kind` cards, canonical child classes, seen-in footers, toggle state | **PASS** | spec asserts contract classes per card |
| S5 | App compiles | `npx ng build` | clean | **PASS** | build complete; 1 pre-existing `UpperCasePipe` warning in `gallery-ticket-dialog` (unrelated in-flight work) |
| S6 | **Visual — light theme** | open `/dev/ds`, scroll to "Widgets" | 9 cards render like the prototype baseline: pill group segmented, badges tinted, 28px icon buttons, toolbar composition tight, stepper chevrons, field input 32px, chips, 3px dir-edge accents | **PASS** | user confirmed after refinement |
| S7 | **Visual — dark theme** | click "Dark theme" toggle, re-scan the 9 cards | all values ride tokens → tints/containers/edges hold contrast; nothing goes invisible or hard-coded light | **PASS** | user confirmed cards, full page, stat strip, page-shell/header-bar after fixes |
| S8 | **Interaction spot-check** | click pills/chips in the pill-toggle + toggle-chip cards; type in field-input, hit clear | `.active` follows click; input text + clear work | **PASS** | focused spec; controls visually present in user pass |

## QA findings + fixes

1. **Dark toggle moved nothing but shadows** — root cause documented in
   `_tokens.scss:19-22`: the app emits no dark `--mat-sys-*` palette, so
   only pure-DS tokens (shadows) can flip. **Fixed:** gallery-scoped
   `:host[data-theme="dark"]` palette in `ds-gallery.component.scss`
   re-declares the tokens the widgets consume (approximate M3 dark
   values, demo-scoped — no app-wide dark mode shipped).
2. **`--mat-sys-success-container` / `--mat-sys-on-success-container`
   never defined** — consumed by `pill-toggle`'s `.long.active` AND ~8
   production components (signal-filter-pills, review-header,
   run-status-bar, signal-list, status-summary-chips, backtest detail/
   report). Undefined `var()` → declarations silently dropped; those
   success presentations were already broken in prod (one signal-list
   line carried a `#c8e6c9` fallback — prior local patch). **Fixed:**
   both tokens added to the hand-rolled `:root` palette in
   `styles.scss` (`#c8e6c9` / `#1b5e20`, matching the fallback
   convention) — un-breaks prod success surfaces and the demo.
3. **Dark surfaces changed while inherited text remained dark** — fixed
   the route canvas and demo control foregrounds explicitly, then rebound
   the five `--ds-*` color aliases in the dark scope. This exposed a
   package-level follow-up: inherited DS aliases do not automatically
   rebind when a descendant overrides their Material targets.

## Refinement pass

Complete — the user inspected the running `/dev/ds` page in light and
dark modes. Initial dark-mode failures were iteratively corrected across
cards, the full route canvas, controls/placeholders, stat-strip values,
and the page-shell/header-bar demo. Final visual verdict: "ok thats good."

## Regression checklist

- [x] Existing 12 foundation cards still render (same loop, shared `ng-template`) — spec covers card count + footers
- [x] `npx jest` full suite — 3894 pass; 2 failures are pre-existing & unrelated (stale `screenshot-capture-contracts` spec vs committed `PositionType` enum; stale `sidenav-menu` spec vs committed "DS Gallery (Dev)" nav item — both files untouched by this diff)
- [x] `_pd-visual-language.scss`, consumer components, and package source remain unchanged; gallery styles + missing app success-container tokens were refined during QA

## Results log

- `cmp` parity ×14 checks — all identical
- sass probe — 49 rules through `vl.*`, shim untouched
- `npx jest ds-gallery` — 7/7
- `npx jest` — 3894/3896 (2 pre-existing failures documented)
- `npx ng build` — clean
