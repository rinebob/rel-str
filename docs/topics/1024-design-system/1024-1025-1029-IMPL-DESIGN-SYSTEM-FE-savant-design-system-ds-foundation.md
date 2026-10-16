**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Design System Foundation  
**Thread Slug:** ds-foundation  
**Issue:** #1029  
**Thread Parent:** #1025  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-15  
**Last Updated:** 2026-10-15  

# IMPL — FE: ST consumption, /dev gallery, SA smoke test, inventory

Blocked by the SHARED blueprint — every task consumes `savant-ds` via
`file:../savant-ds`.

## 1. ST consumption wiring

- `package.json`: add `"savant-ds": "file:../savant-ds"`; `npm install`.
- `angular.json`: add `"stylePreprocessorOptions": { "includePaths":
  ["node_modules/savant-ds/styles"] }` to the build target (both `build`
  configurations if the file lists more than one).
- `src/styles.scss`: emit the token layer once —
  `@use '../node_modules/savant-ds/styles/tokens'` (or via includePaths)
  placed after the Material theme so `--ds-*` aliases to `--mat-sys-*`
  resolve.
- `src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`
  becomes a delegation shim: `@forward 'index'` (or per-partial forwards)
  keeping the same mixin names so existing `vl.page-shell`,
  `vl.dialog-chrome`, `vl.dialog-status`, `vl.error-banner` call sites are
  untouched. Its `$up`/`$down` vars become aliases reading
  `var(--ds-up)`/`var(--ds-down)` — or are deleted in favor of direct token
  use if no call site needs the Sass var.
- Keep the feature-internal comment updated: the file's role changes from
  "duplication inventory" to "delegation shim" — point future readers at
  savant-ds.

## 2. `/dev/ds` gallery page

New sibling route under the existing `/dev` family — do not reuse
`dev/gallery` (that's savant-trader's trade-UI gallery).

- `AppRoutes.DS_GALLERY = 'dev/ds'` in `core/common/interfaces.ts` +
  `PAGE_INFO` entry + route in `core-routes.ts` (`loadComponent`,
  `authGuard`, same shape as `DEV_GALLERY`).
- `DsGalleryComponent` under `src/app/features/dev-ds/` (or wherever dev
  surfaces live — follow `dev-screenshot`'s placement).
- One card per element group: color tokens (swatches incl. up/down),
  spacing, typography, elevation; then pattern demos — page shell +
  header bar skeleton, dialog chrome + status states (submitting / success /
  error), error banner, direction badges.
- Each card carries a **"seen in"** footnote naming the source surfaces the
  element generalizes (run-dashboard, signal-review, signal-table,
  portfolio-dashboard dialogs, savant-trader order-confirm).
- Data-driven: a const array of `{ name, kind, seenIn[], demo }` so later
  threads add elements by adding entries. Page chrome uses the DS mixins
  themselves (dogfooding).
- Density toggle (compact/comfortable) if cheap — density is a DS axis.

## 3. SA smoke test (av-proxy-api)

- `package.json`: `"savant-ds": "file:../savant-ds"`; `npm install`.
- `angular.json`: append `node_modules/savant-ds/styles` to the existing
  `includePaths: ["src/styles"]`.
- One real element consuming the package — e.g. an existing SA banner/panel
  re-skinned with `@use 'index' as ds`, or a minimal demo block on an
  existing admin page. Proves Angular 19 + Material 19 consumption.
- Build check: `npm run build` (or `ng build`) green in av-proxy-api.

## 4. Inventory catalog doc

`docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md` — thin catalog,
~10–20 rows:

| element | kind | source files | duplicated-in | extracted? |
|---|---|---|---|---|
| page shell + host height | pattern | `_pd-visual-language.scss`, run-dashboard, gallery-view, option-chain, positions-view | 5+ pages | yes → ds.page-* |
| dialog chrome + density | pattern | 5 portfolio-dashboard dialogs, order-confirm-dialog | 6 dialogs | yes → ds.dialog-* |
| P&L up/down accents | token | signal-table badges, pd dialogs | several | yes → --ds-up/down |
| …candidate rows… | | | | |

The catalog is the seed the next thread (full inventory + ranked
Material-exit hit list) grows — keep it a table, not prose.

## 5. Mockup convention

State it in the catalog doc header + savant-ds README: mockups in planning
docs are screenshots of the `/dev/ds` gallery or inline SVGs built on DS
tokens, cited by element name. No raster editor files in the repo.

## Dependencies / risks

- **`file:` + npm install ordering** — savant-ds must exist before
  `npm install` in either app; SHARED blueprint lands first (blocker edge).
- **Windows junction vs copy** — confirm `node_modules/savant-ds` is a link
  so package edits propagate; document in READMEs.
- **Gallery inside authGuard** — consistent with `dev/gallery`; dev-only
  visibility is a later concern (prod build gating is already how the app
  treats dev routes — verify the existing guard pattern, follow it).
- **SA is the user's repo too** — edits land in `C:\aa\projects\av-proxy-api`;
  coordinate commits there separately (same never-commit rule).
