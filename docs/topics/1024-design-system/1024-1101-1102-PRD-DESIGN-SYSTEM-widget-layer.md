# PRD — Widget Layer

**Topic:** Savant Design System  
**Topic Slug:** 1024-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1102  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** PRD  
**Status:** Approved  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

## Problem

ST's widget-level chrome (pills, badges, icon buttons, toolbars, filters,
chips) is hand-rolled and duplicated across signals/runs, signals/review,
signals/charts, and dev/gallery. The `pill-group`/`pill` segmented toggle
exists as at least two independent copies (`signal-filter-pills`,
`chart-toolbar` `interval-toggle`/`range-toggle`); badge variants,
28px icon buttons, and secondary toolbar rows each repeat across multiple
components. The `/dev/ds` gallery currently demos only the layout layer —
none of these widgets exist in `savant-ds`, so new surfaces keep
re-implementing them.

## Decisions (from grilling, 2026-10-18)

- **Sass-only** — `savant-ds` stays mixins + `--ds-*` tokens; no `.ts`,
  no Angular components/directives, no ng-packagr. The `/dev/ds` gallery
  template is the canonical markup contract for behavior-bearing widgets.
- **ACR/verdict out of scope** — the accept/consider/reject workflow is
  retired (gallery view → order ticket directly). No `verdict-btn` mixin,
  no `--ds-verdict-*` tokens, no status-pending/accepted/considered/
  rejected badge variants.
- **Expandos out of scope** — being phased out; no `mat-expansion-panel`
  styling, no `<details>` convention.
- **Direction accent = companion mixin** — a standalone `dir-edge`
  marker (`.dir-edge-long`/`.dir-edge-short`), not baked into
  `dense-table`, so cards and lists can carry the same accent.
- **Form controls: partial** — `field-input` (the `filter-input` pattern,
  generalized to labeled inputs) ships in this thread; `<select>`/dropdown
  styling is deferred (native-vs-`mat-select` decision is its own thread).

## Goals

- Graduate 9 widget patterns into `savant-ds` Sass mixins, tokenized on
  `--ds-*` (hard-coded literals like `#4caf50`/`#7b1fa2` map onto
  `--ds-up`/`--ds-down` and new semantic tokens).
- Extend `/dev/ds` with a Widgets section demoing each mixin with the
  canonical markup.
- Migrate the surveyed call sites onto the mixins, deleting the
  duplicated local CSS.
- A verification relay pinning mixin names + emitted CSS contract.

## User stories

All stories are scoped to "as the developer building/maintaining ST/SA
surfaces" unless noted.

### US-1 — Segmented pill toggle

As a developer adding a segmented toggle (direction, interval, range,
status), I apply one mixin so it looks and behaves like every other
toggle without re-writing the CSS.

- AC1.1: `pill-toggle` mixin exists in `savant-ds` and emits the
  `.pill-group` + `.pill` contract (container, option, hover, active,
  `long`/`short` accent variants).
- AC1.2: `/dev/ds` demos all variants; markup in the gallery template is
  the canonical contract.
- AC1.3: `signal-filter-pills` and `chart-toolbar` toggles consume the
  mixin; their local pill CSS is deleted.

### US-2 — Micro action pills + count chips

As a developer adding compact action buttons with counts, I apply one
mixin for the `pill-btn` + inner `pill-count` shape.

- AC2.1: `pill-btn` mixin exists (base, hover, emphasized, disabled,
  inner count chip).
- AC2.2: `/dev/ds` demo; `signal-review-header` and `review-header`
  migrated; `stage-accepted-btn` folded into the same contract.

### US-3 — Badge family

As a developer labeling direction/type/timeframe/counts, I apply badge
mixins so all badges share one visual language.

- AC3.1: `badge` mixin emits dir (`long`/`short`), `type`, `tf`, and
  `count` variants; no ACR status variants exist.
- AC3.2: `/dev/ds` demo; `signal-table` `.dir-badge`, `review-header`,
  `signal-review-header`, and `group-panel` badge literals migrated.

### US-4 — Icon buttons

As a developer adding 28px square icon buttons, I apply one mixin.

- AC4.1: `icon-btn` mixin exists (base, hover, dim/disabled).
- AC4.2: `chart-toolbar` `.toolbar-icon-btn`, `review-header` header
  action buttons, and `group-panel` `.expand-all-btn` consume it.

### US-5 — Toolbar row

As a developer building a secondary toolbar, I apply one mixin for the
40px container row.

- AC5.1: `toolbar-row` mixin exists (height, border-bottom, surface
  background, gap, spacer/title slots).
- AC5.2: `chart-toolbar`, `signal-review-header` `.gr-header`, and
  `review-header` consume it.

### US-6 — Symbol nav stepper

As a developer adding prev/next + counter navigation, I apply one mixin.

- AC6.1: `nav-stepper` mixin exists (nav buttons, position counter,
  disabled state).
- AC6.2: `chart-toolbar` `.symbol-nav` migrated.

### US-7 — Field input

As a developer adding a compact labeled/filter input, I apply one mixin.

- AC7.1: `field-input` mixin exists (icon slot, input, clear button,
  focus state); the `filter-input` usage is a documented special case.
- AC7.2: `review-header` `.header-filter` migrated.
- AC7.3: `<select>` styling is NOT in this mixin — deferred.

### US-8 — Toggle chips

As a developer adding single-select toggle chips (strategy filters etc.),
I apply one mixin.

- AC8.1: `toggle-chip` mixin exists (base, hover, active).
- AC8.2: `review-header` `.strategy-toggles`/`.strategy-btn` migrated.

### US-9 — Direction edge accent

As a developer marking long/short on any element (table row, card,
list item), I apply one marker mixin.

- AC9.1: `dir-edge` mixin emits `.dir-edge-long`/`.dir-edge-short`
  (3px left accent on `--ds-up`/`--ds-down`), usable on `tr` and
  non-table elements.
- AC9.2: `signal-table` `tr.long`/`tr.short` literals migrated.
- AC9.3: `dense-table` is NOT modified — accent stays a companion.

### US-10 — Package wiring + gallery + relay

As a maintainer, the widget mixins ship through the existing package
path and are continuously verified.

- AC10.1: New partial (e.g. `_widgets.scss`, or `_controls.scss` +
  `_badges.scss`) is exported through `styles/_index.scss`.
- AC10.2: `sync:ds` propagates to both `rel-str` and `av-proxy-api`
  vendored copies.
- AC10.3: `/dev/ds` gains a Widgets section; every mixin has a live demo
  with canonical markup.
- AC10.4: A verify relay (`design-system-widgets-<task>.ts`) asserts the
  mixin names exist, no `--ds-verdict-*`/`verdict` tokens exist, and
  gallery demos reference each mixin.
- AC10.5: `1024-1025-DS-INVENTORY.md` candidate rows for these patterns
  updated to Extracted.

## Non-goals

- ACR/verdict controls, status badges for retired states, `--ds-verdict-*`
  tokens.
- Expando styling of any kind.
- `<select>`/dropdown panel styling, `mat-slide-toggle` dense overrides,
  form validation states (deferred thread).
- Angular components, directives, or any TS in `savant-ds`.
- `bounded-tab-group`/`tab-scroll-pane` (remain PD-local per #1043).

## Technical context

- Package: `C:\aa\projects\savant-ds` — Sass-only (`styles/_*.scss`
  partials + `_tokens.scss` emitting `--ds-*` custom properties, bridged
  to `--mat-sys-*` where consumers expect them).
- Consumption: vendored into `rel-str` (`vendor/savant-ds`,
  `scripts/sync-savant-ds.ts`) and `av-proxy-api`
  (`av-proxy-api/vendor/savant-ds`, `av-proxy-api/scripts/sync-savant-ds.mjs`).
- ST shim: `src/styles/_pd-visual-language.scss` — `@forward 'index'`;
  consumers use the `vl.` namespace (`@use 'pd-visual-language' as vl`).
- Canonical markup lives in the `/dev/ds` gallery template
  (`src/app/features/ds-gallery/`).
- Inventory: `docs/topics/1024-design-system/1024-1025-DS-INVENTORY.md`.

## System context

```mermaid
flowchart LR
  subgraph PKG["savant-ds (Sass only)"]
    T[_tokens.scss<br/>--ds-* props]
    W[_widgets.scss<br/>pill-toggle · pill-btn · badge<br/>icon-btn · toolbar-row · nav-stepper<br/>field-input · toggle-chip · dir-edge]
    I[_index.scss]
    T --> W --> I
  end
  subgraph ST["rel-str (SavantTrader)"]
    V1[vendor/savant-ds] --> SHIM[_pd-visual-language.scss<br/>@forward 'index']
    SHIM --> COMPS[component .scss<br/>signal-filter-pills · chart-toolbar<br/>review-header · signal-table · group-panel]
    SHIM --> GAL[/dev/ds gallery<br/>canonical markup + demos/]
  end
  subgraph SA["av-proxy-api (SavantApi)"]
    V2[av-proxy-api/vendor/savant-ds]
  end
  I -->|sync:ds| V1
  I -->|sync:ds| V2
```

## Source survey (basis)

| Pattern | Canonical source | Copies |
|---|---|---|
| pill toggle | `signal-filter-pills.component.scss` | `chart-toolbar` interval/range |
| pill-btn + count | `signal-review-header.component.scss` | `review-header` (stage-accepted) |
| badges | `signal-table` `.dir-badge` | review headers, `group-panel` |
| icon-btn | `chart-toolbar` `.toolbar-icon-btn` | review-header, group-panel |
| toolbar row | `chart-toolbar` | `gr-header`, `review-header` |
| nav stepper | `chart-toolbar` `.symbol-nav` | — |
| field input | `review-header` `.header-filter` | — |
| toggle chip | `review-header` `.strategy-btn` | — |
| dir edge | `signal-table` `tr.long/short` | future: cards/lists |

## Acceptance (thread level)

1. All 9 mixins exist, exported via `_index.scss`, tokenized on `--ds-*`.
2. Zero `verdict`/ACR artifacts in the package.
3. `/dev/ds` Widgets section demos every mixin.
4. Surveyed call sites migrated; duplicate local CSS deleted.
5. Verify relay green; inventory doc updated.

## Risks

- **Visual drift on migration** — the mixins must emit *exactly* the
  current look; compare `/dev/ds` demos against live components side by
  side. Prototype baseline: `.devin/tmp/ds-widgets-prototype.html`.
- **Scope creep into form controls** — `field-input` only; anything
  resembling a `<select>` goes to the deferred thread.
