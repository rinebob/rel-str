# Code Review — #1115 chart-toolbar/group-panel widget migration

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1109  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1115  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

## Scope

- `chart-toolbar` — toolbar row, icon controls, timeframe/range toggles, and
  prev/next navigation consume `toolbar-row`, `icon-btn`, `pill-toggle`, and
  `nav-stepper` with canonical markup.
- `group-panel` — expand/collapse-all consumes `icon-btn`; group long/short
  counts consume `badge` + `dir-long`/`dir-short`; dead `signal-badge`,
  `total-badge`, and `grp-dir` selectors removed.
- Shared `pill-toggle` flat-variant fix in `savant-ds/styles/_widgets.scss`,
  synced byte-identical to both vendored copies: distinct active fill +
  on-primary foreground, plus a `surface-container-highest` hover.
- Task #1115 relay + guide + root runner/index registration.

## Standards

**PASS.** Both consumer stylesheets import the real relative
`_pd-visual-language` shim and compile through the vendored package path
Angular resolves. Canonical classes replace relay-only hook classes
(`.interval-toggle`/`.range-toggle` became `pill-group` + `pill` markup).
The shim's stale "do not import from other features" comment was corrected —
SavantTrader consumption of the shim is the sanctioned vl.* path for the
Widget Layer.

In-review fixes:

1. Group Panel's live direction summary used a local `.grp-dir` selector with
   a hard-coded `#2e7d32` long literal — migrated to the shared
   `badge dir-long`/`dir-short` contract; the dead selector was deleted and
   the relay now guards its absence plus the canonical badge markup.
2. Stale shim feature-boundary comment corrected.

Accepted boundary: `.expand-all-btn` keeps two trivial local overrides
(margin, opacity-on-dim) layered over the shared mixin; `!important`
Material expansion-panel sizing rules predate this migration and stay.

## Spec

**PASS.** Acceptance traceability:

| Requirement | Result |
|---|---|
| Chart Toolbar → `toolbar-row`/`icon-btn`/`pill-toggle`/`nav-stepper` | Met — mixin includes verified, canonical markup pinned |
| Canonical markup normalization | Met — flat `pill-group`/`pill` options, `toolbar-spacer`, `symbol-nav`/`nav-btn`/`nav-position` |
| Compact aligned icon controls + dim state | Met — `icon-btn` with preserved `.dim` modifier |
| Timeframe and range/data-load pill behavior | Met — behavior unchanged; flat active state now visibly marked |
| Prev/next nav + position counter | Met — `nav-stepper`, `nav-btn`, `nav-position` |
| Group Panel expand/collapse-all → `icon-btn` | Met |
| Dead badge selectors removed | Met — `signal-badge`, `total-badge`, and `grp-dir` guarded absent |
| Distinct flat active state | Met — primary fill + on-primary foreground, asserted via compiled CSS in both the relay and package verify |
| Vendor byte parity | Met — all three `_widgets.scss` copies identical |
| Visual parity | Met — user confirmed the active-selection appearance |

## Thermo-nuclear

**PASS.** Contract path reviewed end to end:

`pill-toggle mixin (source pkg) → vendored copies (byte-identical) → vl shim
→ component selectors → canonical markup → compiled-CSS assertions →
migration relay → Angular compile`.

In-review hardening:

- Flat active state is asserted on **compiled** Sass output (background +
  color), not source text.
- Flat variant now has a `surface-container-highest` hover so non-active
  options still give feedback — closes the pre-existing "no hover" hole the
  flat removal of the ring exposed.
- Relay requires Group Panel's `badge` consumption and both directional
  badge bindings; dead-selector guards cover all three removed selectors.
- Group Panel badge/direction checks were added after the review found the
  `.grp-dir` holdout — the relay now covers every live style the migration
  claims.

## Test results

- `design-system-widget-migration-1115.ts` — **30/30 PASS**
- `design-system-widget-migration-1114.ts` — **47/47 PASS**
- `design-system-widgets-1112.ts` — **85/85 PASS**
- `savant-ds` package verify — **ALL CHECKS PASS** (compiled flat active +
  hover assertions)
- Vendor `_widgets.scss` byte parity — **PASS** (source ↔ rel-str ↔
  av-proxy-api)
- Chart Toolbar + Signal Review focused specs — **8/8 PASS**
- Full Jest — **245/245 suites, 4115/4115 tests PASS**
- Angular development build — **PASS**
- Manual visual pass — **PASS**, user confirmed flat active selection is now
  clearly marked
