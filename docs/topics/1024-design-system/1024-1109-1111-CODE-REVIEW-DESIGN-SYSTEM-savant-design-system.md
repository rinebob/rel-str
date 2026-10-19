# Code Review — #1111 vendored sync + /dev/ds Widgets section

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1109  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Task:** #1111  
**Domain:** DESIGN-SYSTEM  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Verdict: PASS

## Scope

- `vendor/savant-ds/styles/` — synced via `npm run sync:ds` (`_widgets.scss`
  added, `_index.scss` +`@forward 'widgets'`; other files EOL-only)
- `av-proxy-api/vendor/savant-ds/styles/` — synced via its `sync:ds`
- `ds-gallery.component.{ts,html,scss,spec.ts}` — Widgets section: 9 demo
  cards, shared `ng-template` card body, canonical markup, demo state

## Standards

- `ng-template` + `NgTemplateOutlet` hoists the card body so both entry
  arrays share one `@switch` — correct dedup vs. duplicating ~180 lines.
- Demo markup uses the canonical class names (`.pill-group`/`.pill`,
  `.pill-btn`/`.pill-count`, `.badge`, `.icon-btn`, `.chip`, `.nav-btn`,
  `.toolbar-spacer`, `.icon`/`.clear`) — the class names are the contract.
- Widget SCSS is `@include ds.*` only for contracted classes; demo-local
  chrome (`.demo-row`/`.demo-stack`/`.edge-*` containers) stays token-bound.
- `chipSel` updates immutably (`new Set`); `fieldValue` bound via
  `[value]` + `(input)` — no ngModel import needed.
- Vendor parity: `_widgets.scss` + `_index.scss` byte-identical to
  `C:\aa\projects\savant-ds\styles\` in BOTH repos (`cmp` verified).
- Spec conventions: jest patterns, `Array.from` for NodeList iteration.

## Spec

| AC | Result |
|---|---|
| `_widgets.scss` vendored in rel-str + SA | Met — `cmp` byte-identical, `_index.scss` forwards `widgets` in both |
| `_pd-visual-language.scss` unchanged; `vl.*` resolves | Met — zero diff on shim; sass compile probe emits `vl.pill-toggle`/`vl.badge`/`vl.toolbar-row` |
| `/dev/ds` Widgets section, 9 demo cards, canonical markup | Met — `widgetEntries` (9), spec asserts all `data-kind` cards + child-class contract |
| `seen in:` provenance footers | Met — all 9 entries cite canonical sources; spec asserts footer on every card |
| `[data-theme="dark"]` toggle exercises widget demos | Met — every emitted value rides `--ds-*`/`--mat-sys-*`; spec asserts the attribute flip; visual confirm lands in QA refinement pass |
| App compiles; `npx jest` green | Met — `ng build` clean; ds-gallery spec 7/7; suite 3894/3896 |

The 2 suite failures are **pre-existing and unrelated** — files untouched
by this diff: `screenshot-capture-contracts.spec.ts` (stale guard —
`PositionType` enum gained option members in earlier committed work) and
`sidenav-menu.component.spec.ts` (stale expectation — "DS Gallery (Dev)"
has been in `constants.ts` since #1041). Flagged to the user during
implement; not in scope for this task.

## Thermo-nuclear

- **Minor** — demo markup can silently drift from the mixin contract if
  `_widgets.scss` child selectors change. Mitigated: spec asserts the
  child-class contract per card; the #1112 relay will pin it harder.
- **Nit** — `$any($event.target).value` in the field-input demo — usual
  Angular template cast; acceptable in demo code.
- **Nit** — `.demo-note` 10px literal — consistent with the file's
  existing small-literal precedent (`.swatch-name` 11px).

## Test results

- `npx jest ds-gallery` — 7/7 pass (new: widget-section count, canonical
  contract, toggle state).
- `npx jest` full suite — 3894 pass, 2 pre-existing failures (above).
- `npx ng build` — clean (one pre-existing `UpperCasePipe` warning in
  `gallery-ticket-dialog`, unrelated in-flight work).
