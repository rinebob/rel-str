# UAT — #1115 chart-toolbar/group-panel widget migration (QA #1155)

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1155  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1115  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

## Scope

Task #1115 migrates the Chart Toolbar and Group Panel chrome onto the shared
`savant-ds` Widget Layer through the `_pd-visual-language` forwarding shim,
plus a shared `pill-toggle` flat-variant fix (distinct active fill +
`surface-container-highest` hover) synced byte-identical across all three
`_widgets.scss` copies (source, rel-str vendor, av-proxy-api vendor).

## Prerequisites

- `rel-str` dependencies installed.
- Vendored `savant-ds` package present under `vendor/savant-ds`.
- Authenticated local app session for manual routes.
- Dev server: `npm start` from `C:\aa\projects\rel-str`.

## Scenarios

### S1 — Migration contract relay

- **Steps:** run `npx tsx scripts/verify/design-system-widget-migration-1115.ts`.
- **Expected:** both stylesheets import the real shim; Chart Toolbar consumes
  `toolbar-row`/`icon-btn`/`pill-toggle`/`nav-stepper`; Group Panel consumes
  `icon-btn`/`badge`; flat active + direction-badge contracts pinned; dead
  `signal-badge`/`total-badge`/`grp-dir` selectors absent; registration,
  guide, and vendored-path SCSS compiles present.
- **Cleanup:** none.
- **Result:** **PASS** — 30/30 checks, exit 0.

### S2 — Widget-layer regression relay

- **Steps:** run `npx tsx scripts/verify/design-system-widgets-1112.ts`.
- **Expected:** package/vendor/index/shim/gallery/inventory contracts remain
  green.
- **Cleanup:** none.
- **Result:** **PASS** — 85/85 checks, exit 0.

### S3 — Shared package verification

- **Steps:** run `npm run verify` in `C:\aa\projects\savant-ds`.
- **Expected:** compiled-Sass assertions pass, including the flat `.active`
  primary/on-primary fill and the flat hover `surface-container-highest`
  fill.
- **Cleanup:** none.
- **Result:** **PASS** — all checks, exit 0.

### S4 — Vendor parity

- **Steps:** byte-compare `savant-ds/styles/_widgets.scss` against both
  vendored copies.
- **Expected:** all three files byte-identical.
- **Cleanup:** none.
- **Result:** **PASS**.

### S5 — Angular application compile

- **Steps:** run `npx ng build --configuration development`.
- **Expected:** Angular and Sass compilation complete using the real
  application resolution path.
- **Cleanup:** generated `dist/` output is ignored.
- **Result:** **PASS** — application bundle generated, exit 0.

### S6 — Focused component suites

- **Steps:** run `npx jest` on `chart-toolbar.component.spec.ts` and
  `signal-review.component.spec.ts`.
- **Expected:** behavior suites green.
- **Cleanup:** none.
- **Result:** **PASS** — 2/2 suites, 8/8 tests.

### S7 — Full regression suite

- **Steps:** run `npx jest --coverage=false`.
- **Expected:** every suite and test passes.
- **Cleanup:** none.
- **Result:** **PASS (with documented out-of-scope exception)** — 244/245
  suites, 4113/4115 tests. The only failures are the two `core-routes.spec.ts`
  PAGE_INFO assertions tripped by `dev/table-perf`, an uncommitted
  unguarded diagnostic route belonging to the concurrent #1084
  analysis-table-hang work. No Task #1115 file appears in that diagnostic;
  user confirmed the route stays out of this session.

### S8 — Chart Toolbar visual refinement

- **Starting state:** authenticated app at `/signals/charts`.
- **Steps:** inspect toolbar row, icon controls, D/W/M and range/data-load
  pills, prev/next stepper + position counter; exercise pill selection.
- **Expected:** compact aligned icons, canonical pill chrome, visibly distinct
  active pill (primary fill), subtle hover on non-active flat pills.
- **Cleanup:** none.
- **Result:** **PASS** — user confirmed the fixed active-selection
  appearance ("ok thats good").

### S9 — Group Panel visual refinement

- **Starting state:** authenticated app at `/signals/review`.
- **Steps:** inspect the expand/collapse-all icon and the group long/short
  count chips, which now render as shared `badge dir-long`/`dir-short`.
- **Expected:** aligned icon button; green long / red short badges consistent
  with direction badges elsewhere.
- **Cleanup:** none.
- **Result:** **PASS** — user confirmed "chips look good".

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Chart Toolbar consumes toolbar-row/icon-btn/pill-toggle/nav-stepper | S1, S8 |
| Canonical markup + compact icons + dim state | S1, S8 |
| Timeframe/range pill behavior + visible active state | S1, S3, S8 |
| Prev/next stepper + position counter | S1, S8 |
| Group Panel icon-btn + direction badges | S1, S9 |
| Dead badge/grp-dir selectors removed | S1 |
| Flat active fill distinct across all three package copies | S3, S4, S8 |
| Visual parity | S8, S9 |
| Jest green | S6, S7 |
| Angular/Sass build green | S5 |

## Refinement pass

Complete. User confirmed the shared flat-active fix on `/signals/charts` and
the Group Panel direction badges on `/signals/review`. The flat hover fill
added during review gives non-active pills subtle feedback; no additional
visual findings remain.

## Regression checklist

- [x] Migration relay green (30/30)
- [x] Widget contract relay green (85/85)
- [x] Shared package verify green (compiled flat active + hover)
- [x] Vendor `_widgets.scss` byte parity across all three copies
- [x] Angular build green
- [x] Focused suites green (8/8)
- [x] Full Jest green except 2 known out-of-scope core-routes failures from
      the user's uncommitted #1084 `dev/table-perf` diagnostic route
- [x] `/signals/charts` visually confirmed
- [x] `/signals/review` Group Panel badges visually confirmed

## Findings

None in scope. The `dev/table-perf` route-registry failures belong to the
#1084 diagnostic work and resolve when that route is removed or registered.
