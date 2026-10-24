**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1231  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Task:** #1209  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-10-23  

# UAT — #1209 FE: --mat-sys dark+light bridge in styles.scss

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 Bridge emits both modes (automated) | PASS | relay 11/11, 2026-10-23 |
| S2 Light block = pre-change literals (automated) | PASS | relay pin + git HEAD verbatim diff |
| S3 Sass compiles + specs green (automated) | PASS | relay compile OK; jest 259/259, 4471 tests |
| S4 Dark: Material menus legible (user) | PASS | user-confirmed legible, 2026-10-23 |
| S5 Dark: dialogs legible (user) | PASS | user-confirmed legible |
| S6 Dark: form fields legible (user) | PASS | user-confirmed legible |
| S7 Light mode unchanged (user) | PASS | user-confirmed identical to pre-change |
| S8 Charts unchanged (user) | PASS | user-confirmed colors/indicators/markers identical |
| S9 Native chrome follows color-scheme (user) | PASS | user-confirmed legible chrome in dark |
| S10 ds-gallery previews behave (user) | PASS | no new issues vs known #1211 bounds |

## Scope

`src/styles.scss` now emits a 31-key dark `--mat-sys-*` set under
`:root` (the app default — the #1207 bootstrap always writes
`data-theme` before first paint) and moved the pre-change light set
verbatim under `[data-theme="light"]`. `color-scheme` flips per mode.
The bridge exists so un-migrated Angular Material surfaces (menus,
dialogs, form fields) and vendored `savant-ds` mixins that read
`var(--mat-sys-*)` stay legible until #1163 removes Material.

Deliberately out of scope: palette polish (the dark ramp is the
ds-gallery demo ramp — tuning/locking is #1211), the ds-gallery local
dark block dedup (#1211), and `--ds-*` token migration of component
literals (#1213–#1217 sweeps).

**User-observed bound (accepted):** many screens show "incorrect"
colors in dark — components with hardcoded light literals that don't
read `--mat-sys-*` at all. The bridge only themes Material surfaces;
those literals migrate to `--ds-*` in the sweep phases (#1213–#1217)
and the palette locks in #1211. User direction: finish the theme
pipeline, then one comprehensive color pass over all screens — not
piecemeal fixes now.

## Prerequisites

- Repo at `prod` with the uncommitted #1209 working tree.
- Dev server: `npm start` → http://localhost:4210 (confirmed up
  2026-10-23, serving rebuilt styles).
- Normal signed-in session (the bridge affects all pages).
- Dark mode active by default. To flip: the header theme-toggle icon
  button (sun/moon) in the top-right header, or
  `localStorage['savant-theme']` + reload.

## Start instructions

- Any authenticated page — e.g. http://localhost:4210/signals/charts
- Gallery: http://localhost:4210/trading/gallery (dialogs + menus)
- DS gallery: http://localhost:4210/dev/ds (dark/light preview hosts)
- DevTools → Elements → `<html data-theme="…">` to confirm the mode
  you think you're looking at.

## Scenarios

### S1 — Bridge emits both modes (automated, executed)

- `npx tsx scripts/verify/design-system-mat-sys-bridge-1209.ts` →
  `ALL 11 CHECKS PASSED`. Covers: compile, `:root` bridge exists, all
  31 dark literals exact, no `[data-theme="dark"]` mat-sys block,
  `[data-theme="light"]` block exists, emission order, both
  `color-scheme` flips, anti-smuggle exactly-twice guard,
  `--app-header-height` once under `:root`.

### S2 — Light block = pre-change literals (automated, executed)

- Same relay: `light block = exact pre-#1209 literals (all 31)`.
- Independent check: `git show HEAD:src/styles.scss` light values
  vs the `[data-theme="light"]` block — verbatim (done at review).

### S3 — Sass compiles + specs green (automated, executed)

- Relay check 1 compiles `styles.scss` through vendored includePaths.
- `npx jest` → 259/259 suites, 4471/4471 tests.

### S4 — Dark: Material menus legible (user)

1. With `data-theme="dark"` (default), open any mat-menu — e.g. the
   header account/menu button, or an indicator-menu on a chart page.
2. Expected: menu surface dark (`#1c1f24`-family), text light
   (`#e2e4e8`), hover states visible, no white-on-white or
   black-on-black.

### S5 — Dark: dialogs legible (user)

1. Open a Material dialog — e.g. gallery card → **Trade** → ticket
   dialog, or any mat-dialog.
2. Expected: dialog surface dark, labels/values legible, buttons
   readable, close/backdrop behavior unchanged.

### S6 — Dark: form fields legible (user)

1. Any mat-form-field — e.g. symbol search/autocomplete, dialog
   inputs, scanner filters.
2. Expected: outline/label/value readable in dark; placeholder dimmed
   but visible; focus ring visible.

### S7 — Light mode unchanged (user)

1. Header toggle → light (or `localStorage['savant-theme']='light'`
   + reload). Confirm `<html data-theme="light">`.
2. Repeat S4–S6 surfaces.
3. Expected: identical appearance to before this change — the light
   block is byte-identical pre-#1209 values; anything different is a
   regression.

### S8 — Charts unchanged (user)

1. Open a Syncfusion chart page (`/signals/charts`).
2. Expected: chart colors, indicators, buy/sell markers identical to
   pre-change — charts don't read `--mat-sys-*`.

### S9 — Native chrome follows color-scheme (user)

1. In dark: check scrollbars, native form controls, date pickers.
2. Expected: UA chrome renders dark (`color-scheme: dark` on `:root`),
   not blinding-white scrollbars.
3. In light: chrome renders light.

### S10 — ds-gallery previews behave (user)

1. `/dev/ds` — toggle the gallery's own dark/light preview.
2. Expected: previews still work. Known: the host-scoped dark block is
   now redundant with the global bridge (dedup is #1211); a funky
   light-preview under dark-app was already flagged → #1211. Flag
   anything NEW vs that known state.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `--mat-sys-*` under `:root` (dark) + `[data-theme="light"]` | S1 |
| light block = pre-change light values | S2, S7 |
| menus/dialogs/form fields legible in dark | S4, S5, S6 |
| Sass compiles; existing specs stay green | S3 |
| (TEST E5 light-mode legibility) | S7, S9 |
| (TEST E6 dark Material surfaces) | S4, S5, S6, S9 |
| (TEST E7 charts unchanged) | S8 |
| Refinement pass | S4–S10 subjective notes |

## Regression / smoke checklist

- [ ] Header toggle still flips `data-theme` + persists across reload
- [ ] No light flash on reload in dark mode (bootstrap unchanged)
- [ ] DS surfaces (`--ds-*` consumers — scanner page, widget mixins)
  still themed correctly in both modes
