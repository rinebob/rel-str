# Code Review — #1114 signals/review widget migration

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1109  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1114  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

## Scope

- `signal-filter-pills` — segmented controls consume `pill-toggle`.
- `signal-review-header` — toolbar, pills, timeframe/direction markers consume
  `toolbar-row`, `pill-btn`, and `badge` with canonical markup.
- `review-header` — live toolbar/icon/order-pill chrome consumes
  `toolbar-row`, `icon-btn`, and `pill-btn`; stale selectors with no current
  template markup were removed rather than preserved as paper migrations.
- `signal-table` — direction markers and row accents consume `badge` and
  `dir-edge`.
- Task #1114 relay + guide + root runner/index registration.

## Standards

**PASS.** All four consumer stylesheets import the real relative
`_pd-visual-language` shim and compile through the actual vendored package path
used by Angular. Canonical markup classes replace local naming where the mixin
contract requires it. The migration removes duplicated widget bodies instead
of wrapping them with includes.

In-review fixes:

1. The first relay compile used a synthetic include path that Angular did not
   have. Imports now use the real relative shim path, and relay compilation
   uses `vendor/savant-ds/styles` so the mistake cannot recur.
2. Dead `review-header` field/chip/badge/decision/raised-button selectors were
   deleted after confirming no matching template markup exists. The relay now
   guards their absence rather than requiring dead includes.
3. Dead `.active-toggle` and `.review-queue` hooks were removed.
4. Redundant toolbar-spacer overrides were removed; the shared toolbar mixin
   remains the source of flex behavior.

Accepted boundary: `.review`/`.accept` and the remaining ACR controls stay
local until that retiring workflow is deleted, as required by the plan.

## Spec

**PASS.** Acceptance traceability:

| Requirement | Result |
|---|---|
| Signal filter pills → `pill-toggle` | Met |
| Signal header → toolbar/pill/badge contracts | Met, including `badge tf`, direction badges, `emph`, and `toolbar-spacer` markup |
| Review header → shared live contracts | Met for current markup: toolbar, three icon buttons, and order pill; stale field/chip/badge requirements corrected as not applicable |
| Signal table → badge + direction edge | Met with explicit long/short class bindings |
| Retired direction literals absent | Met with whitespace-insensitive RGBA guard |
| Local review/accept variants preserved | Met |
| Visual parity | Met — user confirmed `/signals/review` and `/signals/charts` look good |
| Jest green | Met — 242/242 suites, 4075/4075 tests |

The FE TEST plan was corrected to resolve its internal contradiction: duplicated
direction literals are prohibited, while the explicitly local ACR variants are
exempt until deletion.

## Thermo-nuclear

**PASS.** Contract path reviewed end to end:

`widget mixins → package index → vl shim → component selector → canonical
markup → migration relay → Angular compile`.

In-review hardening:

- The relay compiles against the vendored package Angular actually resolves.
- Dead-selector checks operate on comment-stripped executable Sass with
  selector-aware regexes.
- Direction-literal matching is case- and whitespace-insensitive.
- The relay registers itself and its guide, and compiles every migrated SCSS.

No critical, major, or unresolved minor findings remain. A bounded third pass
reported no new findings on any axis.

## Test results

- `design-system-widget-migration-1114.ts` — **47/47 PASS**
- `design-system-widgets-1112.ts` — **85/85 PASS**
- Signal Review focused suites — **33/33 PASS**
- Full Jest — **242/242 suites, 4075/4075 tests PASS**
- Task-scoped Sass compile against vendored package — **PASS**
- Angular development build — **PASS** before a concurrent out-of-scope
  Analysis template edit introduced its own parser error; no Task #1114 file
  appears in that diagnostic.
- Manual visual pass — **PASS**, user confirmation.
