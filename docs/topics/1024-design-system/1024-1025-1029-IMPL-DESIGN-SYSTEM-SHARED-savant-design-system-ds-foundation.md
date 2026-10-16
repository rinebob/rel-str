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

# IMPL — SHARED: savant-ds package

The standalone design-system package at `C:\aa\projects\savant-ds`. SCSS/CSS
only — no build step, no Angular code — so Angular 21 (ST) and Angular 19
(SA) consume it identically via an npm `file:` dependency.

## Layout

```
savant-ds/
  package.json          # name "savant-ds", private, version 0.1.0; sass devDep
  README.md             # consumption docs for ST + SA
  .gitignore
  styles/
    _index.scss         # @forward all partials — single @use entry point
    _tokens.scss        # --ds-* custom properties + [data-theme="dark"]
    _page.scss          # page-host, page-shell, content-column, header-bar
    _dialog.scss        # dialog-chrome, dialog-status
    _feedback.scss      # error-banner, badge/direction helpers
  scripts/
    verify.mjs          # sass-compile check (see below)
```

## Tokens (`_tokens.scss`)

CSS custom properties on `:root`, dark overrides under `[data-theme="dark"]`
(same convention as `src/app/styles/_variables-global.scss`). Names carry the
`--ds-` prefix. Seed set, drawn from `_pd-visual-language.scss` +
`_variables-global.scss` + the reference surfaces (run-dashboard,
signal-review, signal-table):

- **Color:** `--ds-surface`, `--ds-on-surface`, `--ds-surface-variant`,
  `--ds-up` (#4caf50), `--ds-down` (#f44336), `--ds-error`,
  `--ds-border-subtle`
- **Spacing scale:** `--ds-space-1..6` (4px base → 4/8/12/16/24/32)
- **Typography:** `--ds-font-size-{sm,md,lg}`, `--ds-font-weight-{regular,medium,bold}`
- **Density:** `--ds-row-height` (32px — the spread-builder/dialog density
  convention), `--ds-field-height` (40px)
- **Elevation:** `--ds-shadow-{1,2}`, `--ds-radius-{sm,md}`

When a token mirrors a Material system value (surface, error, on-surface-
variant), emit it as an alias to the `var(--mat-sys-*)` so DS-styled and
Material-styled elements stay in sync during coexistence — e.g.
`--ds-error: var(--mat-sys-error)`. Pure-DS values (P&L accents, spacing)
get literals.

## Pattern mixins

Graduated verbatim from `_pd-visual-language.scss` (Thread #751/task #776),
renamed to the `ds-` namespace:

| mixin | emits |
|---|---|
| `ds.page-host()` | routed-page `:host` — `height: calc(100vh - var(--header-height, 0px))` |
| `ds.page-shell()` | full-height flex column root, mat-sys surface colors |
| `ds.content-column()` | 1100px-capped centered column |
| `ds.header-bar()` | compact page header + `.bar-actions` compact-button rule |
| `ds.dialog-chrome()` | dense form-field custom props, action row, header styles |
| `ds.dialog-status()` | `.status-section` + success/error icons, `.result-row`, `.error-message` |
| `ds.error-banner()` | tokenized error banner (replaces `#fef0f0` literals) |

`_index.scss` is `@forward 'tokens'; @forward 'page'; @forward 'dialog';
@forward 'feedback';` so consumers write `@use 'index' as ds;`.

## Consumption contract

`npm install` with `"savant-ds": "file:../savant-ds"` symlinks the package
into `node_modules`. Each app adds `node_modules/savant-ds/styles` to
`stylePreprocessorOptions.includePaths` in `angular.json`; component SCSS
then does `@use 'index' as ds;` (ST) — SA likewise. Global token emission:
import `_tokens.scss` once from `src/styles.scss` (tokens must exist at
runtime for all consumers; mixins are compile-time only).

## Verify script (`scripts/verify.mjs` in savant-ds)

Offline check, same spirit as rel-str's `scripts/verify/data-pipeline-st-*`
pattern: run `sass --no-source-map` (devDependency `sass`) over a fixture
entry that `@use`s the index and exercises every mixin; assert each `--ds-*`
token name appears in the compiled output and that compilation exits clean.
No credentials, no network. Mirrored into rel-str as a `scripts/verify/`
entry during the FE blueprint so the repo's run-all picks it up.

## Ordering

1. `git init` + package.json + .gitignore + README
2. `_tokens.scss`
3. `_page.scss` / `_dialog.scss` / `_feedback.scss`
4. `_index.scss`
5. `verify.mjs` + `sass` devDependency

## Dependencies / risks

- **npm `file:` symlink on Windows** — npm uses junctions; works on this
  machine's NTFS, no admin needed. If a consumer ever copies instead of
  linking, edits in savant-ds won't propagate — README must say "edit the
  package, not node_modules."
- **Sass deprecation warnings** — use `@use`/`@forward` only, no `@import`,
  so the package survives both apps' sass versions.
- **Token emission ordering** — `:root` tokens must be emitted once
  (styles.scss), not per-component (custom props are runtime, not deduped
  by Sass — re-emitting per component bloats output).
