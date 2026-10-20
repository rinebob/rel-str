# UAT — #1114 signals/review widget migration (QA #1151)

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1151  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1114  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

## Scope

Task #1114 migrates the current Signals/Review widget chrome from component-
local declarations to the shared `savant-ds` Widget Layer through the existing
`_pd-visual-language` forwarding shim. Covered surfaces are filter pills, the
Signal Review toolbar/counts/actions, the Chart Review toolbar controls/order
pill, and Signal Table direction badges/row edges.

## Prerequisites

- `rel-str` dependencies installed.
- Vendored `savant-ds` package present under `vendor/savant-ds`.
- Authenticated local app session for manual routes.
- Dev server: `npm start` from `C:\aa\projects\rel-str`.

## Scenarios

### S1 — Migration contract relay

- **Steps:** run `npx tsx scripts/verify/design-system-widget-migration-1114.ts`.
- **Expected:** all four stylesheets import the real shim; applicable mixins and
  canonical markup exist; dead selectors and duplicated direction literals are
  absent; registration and guide exist; all four SCSS files compile against the
  vendored package.
- **Cleanup:** none.
- **Result:** **PASS** — 47/47 checks, exit 0.

### S2 — Widget-layer regression relay

- **Steps:** run `npx tsx scripts/verify/design-system-widgets-1112.ts`.
- **Expected:** package/vendor/index/shim/gallery/inventory contracts remain
  green.
- **Cleanup:** none.
- **Result:** **PASS** — 85/85 checks, exit 0.

### S3 — Focused Signal Review behavior

- **Steps:** run:
  `npx jest src/app/features/savant-trader/pages/signal-review/signal-review.component.spec.ts src/app/features/savant-trader/stores/signal-review.facade.spec.ts --coverage=false`.
- **Expected:** component and facade behavior remain green.
- **Cleanup:** none.
- **Result:** **PASS** — 2/2 suites, 33/33 tests.

### S4 — Angular application compile

- **Steps:** run `npx ng build --configuration development`.
- **Expected:** Angular and Sass compilation complete using the real application
  resolution path.
- **Cleanup:** generated `dist/` output is ignored.
- **Result:** **PASS** — application bundle generated, exit 0.

### S5 — Full regression suite

- **Steps:** run `npx jest --coverage=false`.
- **Expected:** every suite and test passes.
- **Cleanup:** none.
- **Result:** **PASS** — 244/244 suites, 4100/4100 tests.

### S6 — Signal Review visual refinement

- **Starting state:** authenticated app at `/signals/review` with signal data.
- **Steps:** inspect filter pill groups; W/D and long/short badges; Signals total;
  action pills; toolbar rhythm; and table direction badge/left edge. Exercise
  timeframe and direction pills when available.
- **Expected:** compact canonical widgets, correct active states, green/red
  direction semantics, no clipping/wrapping/contrast regression.
- **Cleanup:** restore preferred filters if changed.
- **Result:** **PASS** — explicit user confirmation: “ok looks good”.

### S7 — Chart Review visual refinement

- **Starting state:** authenticated app at `/signals/charts`.
- **Steps:** inspect back/history/observation controls, toolbar spacing, Order
  pill/count, wrapping, and contrast.
- **Expected:** icon controls remain aligned, Order pill remains readable, and
  header hierarchy matches the accepted widget baseline.
- **Cleanup:** none.
- **Result:** **PASS** — explicit user confirmation: “ok looks good”.

### S8 — Migration-boundary integrity

- **Steps:** inspect `review-header` SCSS/template and the migration relay.
- **Expected:** no paper migrations for selectors absent from current markup;
  dead field/chip/badge/decision selectors are absent; local `.review`/
  `.accept` ACR variants remain explicitly exempt until workflow deletion.
- **Cleanup:** none.
- **Result:** **PASS** — relay guards dead-selector absence and the FE TEST plan
  records the ACR exception.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Signal filter pills consume `pill-toggle` | S1, S6 |
| Signal header consumes toolbar/pill/badge contracts | S1, S6 |
| Review header consumes applicable toolbar/icon/pill contracts | S1, S7, S8 |
| Signal table consumes badge/dir-edge contracts | S1, S6 |
| Duplicated direction literals removed | S1 |
| Local review/accept variants preserved | S1, S8 |
| Visual parity | S6, S7 |
| Jest green | S3, S5 |
| Angular/Sass build green | S4 |

## Refinement pass

Complete. The user inspected both changed routes and reported that they look
good. Review-time cleanup removed dead non-rendering selectors and tightened the
relay; no additional visual findings remain.

## Regression checklist

- [x] Migration relay green
- [x] Widget contract relay green
- [x] Focused Signal Review suites green
- [x] Angular build green
- [x] Full Jest suite green
- [x] Signals Review visually confirmed
- [x] Chart Review visually confirmed
- [x] Dead-selector and ACR-boundary checks confirmed

## Findings

None.
