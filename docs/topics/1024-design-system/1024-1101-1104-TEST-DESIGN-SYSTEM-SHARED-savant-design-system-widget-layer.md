# Test Plan — SHARED: savant-ds widget mixins

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1104  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** TEST  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-20  

## Scope

`savant-ds/styles/_widgets.scss` — 9 Sass mixins. Sass-only package; tests
are a compile probe + emitted-CSS assertions, not a runtime suite.

## Compile probe

A probe `.scss` file that `@use`s the package index and `@include`s each
mixin inside a selector; compiled with `sass` (devDependency already used
by the package or added if absent):

```scss
// probe-widgets.scss (test-only, not shipped)
@use '../styles/index' as ds;
.t-pill   { @include ds.pill-toggle; }
.t-btn    { @include ds.pill-btn; }
.t-badge  { @include ds.badge; }
.t-icon   { @include ds.icon-btn; }
.t-bar    { @include ds.toolbar-row; }
.t-nav    { @include ds.nav-stepper; }
.t-field  { @include ds.field-input; }
.t-chip   { @include ds.toggle-chip; }
.t-edge   { @include ds.dir-edge; }
```

- T1: probe compiles with no errors → all 9 mixin names exist and are
  exported through `_index.scss`.

## Emitted-CSS assertions (on the probe output)

- T2: `.t-pill` emits `border-radius: 12px` container + nested `.active`
  rule referencing `--mat-sys-primary-container`; `long`/`short` variants
  reference `success`/`error` system colors.
- T3: `.t-btn` emits `.pill-count` child rule; `.emph` and `.small`
  variants present; **absent:** `review`, `accept` variant rules.
- T4: `.t-badge` emits `&.dir-long`/`&.dir-short` referencing `--ds-up`/
  `--ds-down` (via color-mix or tint token), `&.type`, `&.tf`, `&.count`.
- T5: `.t-icon` emits `28px` width/height.
- T6: `.t-bar` emits `min-height: 40px` + `border-bottom`.
- T7: `.t-nav` emits `.nav-btn` (22px) + `.nav-position` (tabular-nums).
- T8: `.t-field` emits `height: 32px` + nested `input` + clear button.
- T9: `.t-chip` emits `&.active` referencing primary-container.
- T10: `.t-edge` emits `&.dir-edge-long`/`&.dir-edge-short` with
  `--ds-up`/`--ds-down`.

## Retired-scope guard

- T11: emitted CSS contains zero occurrences of `verdict`, `acr`,
  `expansion`, `details`, `--ds-verdict`.

## Unit test targets

None — no TS in the package. The probe + assertions live in the FE verify
relay (they compile the vendored copy) or a package-local script if the
package gains a test runner; FE blueprint's relay is the enforcement
point either way.

## Edge cases

- Mixin included at a `tr` selector (`dir-edge`) — probe covers this by
  including inside a `tr.t-edge` too.
- Double-`@forward` collision — probe also asserts `@use 'index'`
  resolves each mixin name exactly once (compile would fail otherwise).
