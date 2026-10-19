# Implementation Plan — SHARED: savant-ds widget mixins

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1104  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-20  

## 1. Scope

Add the widget layer to `savant-ds`: one new Sass partial,
`styles/_widgets.scss`, containing 9 mixins emitted on `--ds-*`/`--mat-sys-*`
tokens. No TypeScript, no Angular, no new build tooling — Sass-only per the
PRD decisions.

## 2. File changes

| File | Change |
|---|---|
| `styles/_widgets.scss` | NEW — 9 mixins (below) |
| `styles/_index.scss` | EDIT — add `@forward 'widgets';` after the existing partials |

Vendored copies (`rel-str/vendor/savant-ds/`, `av-proxy-api/vendor/savant-ds/`)
are **not** hand-edited — they land via each app's `sync:ds` script (FE
blueprint owns that step).

## 3. Mixin contracts

All mixins are `@mixin name() { … }` emitting rules inside the consuming
selector — identical shape to `dense-table`/`stat-strip`. Variant classes
are nested (`&.active`, `&.dir-long`). Source-verified values are quoted
from the real consumers (see §5).

### `pill-toggle`

Applied at the group container; emits container + nested option-class
rules:

```scss
// consumer: .pill-group { @include vl.pill-toggle; }  — .pill is the option class
display: inline-flex; gap: 2px; align-items: center;
background: var(--mat-sys-surface-container);
border: 1px solid var(--mat-sys-outline-variant);
border-radius: 12px; padding: 2px;
// nested option: font-size 10px / weight 600 / padding 3px 8px /
//   border-radius 10px / transparent bg / on-surface-variant / nowrap /
//   transition background,color,border-color .15s
//   &:hover:not(.active) → container-high + on-surface
//   &.active → primary-container/on-primary-container + primary border + ring, 700
//   &.long.active → success-container/on-success-container + success ring
//   &.short.active → error-container/on-error-container + error ring
// container &.flat (as-built) — borderless compact variant for
//   chart-toolbar interval/range (container-high bg, radius 10px, no
//   ring on active); option class parametrized ($option, default .pill)
```

### `pill-btn`

```scss
// consumer: .pill-btn { @include vl.pill-btn; }  — emits .pill-count child
display: inline-flex; align-items: center; gap: 3px;
font-size: 9px; font-weight: 600; padding: 2px 6px; border-radius: 10px;
border: 1px solid var(--mat-sys-outline-variant);
background: var(--mat-sys-surface-container);
color: var(--mat-sys-on-surface-variant); cursor: pointer; white-space: nowrap;
//   mat-icon → 11px
//   &:hover:not(:disabled) → container-high + outline border
//   &:disabled → 0.4 / not-allowed
//   &.emph (signals-total) → primary-container/on-primary-container +
//     primary border; nested .pill-count inverts (primary/on-primary)
//   &.small → 8px, 2px 4px, radius 8px
// nested .pill-count: 8px/700, container-high bg, on-surface-variant,
//   0 3px, radius 4px, min-width 14px, centered
```

**Excluded:** `.review`/`.accept` variants — ACR-tied hard-codes
(`#7b1fa2`, `#1b5e20`) that die with the retired workflow.

### `badge`

```scss
// consumer: .dir-badge { @include vl.badge; }
padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 500;
text-transform: uppercase; white-space: nowrap;
display: inline-flex; align-items: center; gap: 3px;
//   &.dir-long → color-mix(in srgb, var(--ds-up) 15%, transparent) / --ds-up
//   &.dir-short → color-mix(in srgb, var(--ds-down) 15%, transparent) / --ds-down
//   &.type → primary-container / primary
//   &.tf → surface-container bg, radius 6px, weight 600 (not uppercase)
//   &.count → primary-container/on-primary-container, radius 8px,
//     min-width 20px, weight 700 (+&.count.muted → container-high/on-surface-variant)
```

`dir-count` consumers (signal-review-header) migrate onto `.badge
dir-long`/`dir-short` — badge chosen over bare colored text (prototype
decision 2026-10-18: bare text too weak on the container background).

### `icon-btn`

```scss
// consumer: .toolbar-icon-btn { @include vl.icon-btn; }
width: 28px; height: 28px; display: inline-flex; align-items: center;
justify-content: center; padding: 0; border: none; border-radius: 4px;
background: transparent; color: var(--mat-sys-on-surface-variant);
cursor: pointer;
//   mat-icon → 18px
//   &:hover:not(:disabled) → container-highest
//   &:disabled / &.dim → opacity 0.4
```

### `toolbar-row`

```scss
// consumer: .chart-toolbar { @include vl.toolbar-row; }
display: flex; align-items: center; gap: 8px; padding: 4px 8px;
background: var(--mat-sys-surface-container);
border-bottom: 1px solid var(--mat-sys-outline-variant);
min-height: 40px; flex-shrink: 0;
//   nested .toolbar-spacer (or configurable) → flex: 1
```

### `nav-stepper`

```scss
// consumer: .symbol-nav { @include vl.nav-stepper; }
display: inline-flex; align-items: center; flex-shrink: 0;
//   .nav-btn: 22×22, border-radius 4px, transparent, on-surface-variant,
//     hover container-highest, :disabled 0.35; mat-icon 18px
//   .nav-position: 10px/600, tabular-nums, on-surface-variant,
//     min-width 28px, centered
```

### `field-input`

```scss
// consumer: .header-filter { @include vl.field-input; }
display: flex; align-items: center; gap: 4px; width: 120px; height: 32px;
padding: 0 8px; border: 1px solid var(--mat-sys-outline);
border-radius: 4px; background: var(--mat-sys-surface);
//   .icon slot (as-built canonical name) → 14px, on-surface-variant
//   input → flex 1, borderless, transparent, 12px, outline none,
//     placeholder on-surface-variant, font-family inherit
//   .clear btn (as-built canonical name) → 18×18, mat-icon 12px,
//     hover container-highest
```

### `toggle-chip`

```scss
// consumer: .strategy-btn { @include vl.toggle-chip; }
border: 1px solid var(--mat-sys-outline-variant);
background: var(--mat-sys-surface-container-highest);
color: var(--mat-sys-on-surface-variant);
font-size: 10px; font-weight: 600; padding: 3px 8px; border-radius: 12px;
cursor: pointer; white-space: nowrap; line-height: 1;
//   &:hover → outline border
//   &.active → primary-container bg / primary text + border + ring
```

### `dir-edge`

```scss
// consumer: tr (or .card etc.) { @include vl.dir-edge; }
//   emits &.dir-edge-long → border-left: 3px solid var(--ds-up)
//   emits &.dir-edge-short → border-left: 3px solid var(--ds-down)
```

Companion marker — usable on `tr`, cards, list items; `dense-table` is
not modified (decision: option B, companion not baked).

## 4. Token impact

**Zero new tokens.** All variant colors bind to existing properties:
`--mat-sys-success*`, `--mat-sys-error*`, `--mat-sys-primary*` (verified
present in ST's theme — `signal-filter-pills` consumes them today), and
`--ds-up`/`--ds-down`. The dir-badge tint uses `color-mix` on `--ds-*`
since `rgba()` cannot unpack a hex token.

## 5. Source-of-truth consumers (migration targets — FE blueprint)

| Mixin | Canonical source | Additional copies |
|---|---|---|
| pill-toggle | `signal-filter-pills.component.scss` | `chart-toolbar` interval/range |
| pill-btn | `signal-review-header.component.scss` | `review-header` |
| badge | `signal-table.component.scss` `.dir-badge` | review headers, `group-panel`, dir-counts |
| icon-btn | `chart-toolbar` `.toolbar-icon-btn` | `review-header`, `group-panel` |
| toolbar-row | `chart-toolbar` `.chart-toolbar` | `gr-header`, `review-header` |
| nav-stepper | `chart-toolbar` `.symbol-nav` | — |
| field-input | `review-header` `.header-filter` | — |
| toggle-chip | `review-header` `.strategy-btn` | — |
| dir-edge | `signal-table` `tr.long/short` | cards/lists (future) |

## 6. Phases / tasks

One phase, one task — the partial is small and ships atomically:

- **Phase: Widget mixins**
  - **Task:** `styles/_widgets.scss` with the 9 mixins + `_index.scss`
    forward. AC: all 9 mixin names present, no `verdict`/`acr`/expando
    CSS, partial compiles standalone (`sass` render of a probe file that
    `@include`s each mixin inside a selector).

## 7. Risks / edge cases

- **`color-mix` browser support** — Chrome 111+/Safari 16.2+/FF 113+.
  Acceptable for this app's targets; alternatively emit a `--ds-up-15`
  tint token. Decide at implement time; contract stays identical.
- **Exact-look drift** — the mixins must emit *pixel-identical* chrome vs
  current components. Baseline: `.devin/tmp/ds-widgets-prototype.html`
  + side-by-side `/dev/ds` comparison in the FE blueprint.
