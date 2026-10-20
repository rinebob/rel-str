# Test Plan — FE: widget consumption + gallery

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Widget Layer  
**Thread Slug:** widget-layer  
**Issue:** #1104  
**Thread Parent:** #1101  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-18  
**Last Updated:** 2026-10-18  

## Scope

`/dev/ds` Widgets section, consumer migrations, vendored sync, verify
relay. All FE; no BE surface touched.

## E2E / visual journeys (manual, dev server)

- E1: `/dev/ds` renders a Widgets section with 9 demo cards; each demo
  matches the corresponding real component's current look (side-by-side
  against `signal-filter-pills`, `chart-toolbar`, review headers,
  `signal-table`, `group-panel`).
- E2: `[data-theme="dark"]` toggle on the gallery — all widget demos hold
  contrast (token-bound values only).
- E3: Migrated surfaces render identically: signals/review pills +
  headers, chart toolbar, signal table badges + row accents, group panel
  badges/icon buttons.
- E4: `color-mix` renders the dir-badge tint in the app's target
  browsers (fallback: tint token per SHARED IMPL §7).

## Verify relay — `design-system-widgets-<task>.ts`

- R1: `vendor/savant-ds/styles/_widgets.scss` exists and is byte-identical
  to `savant-ds/styles/_widgets.scss`; same for `av-proxy-api/vendor/…`.
- R2: `_index.scss` forwards `widgets`; `_pd-visual-language.scss` still
  resolves (`vl.*` namespace intact).
- R3: all 9 mixin names present in the partial.
- R4: zero `verdict`/`acr`/`expansion`/`--ds-verdict` in package + vendored
  copies.
- R5: gallery template contains all 9 demo sections (marker comments or
  stable class hooks), and all 9 inventory rows are Extracted rather than
  Candidate.
- R6 (Tasks #1114/#1115): each migrated `.scss` contains `@include
  vl.<mixin>`; retired literals (`#4caf50`, `#f44336`, `#7b1fa2`,
  `#1b5e20`, `rgba(76,175,80`) are absent from migrated files. This is a
  Phase 2 gate and cannot run in Task #1112 before the migrations exist.

## Integration boundaries

- `sync:ds` — vendored copies update without hand edits (R1 enforces).
- `_pd-visual-language.scss` shim — `vl.pill-toggle` etc. resolve via the
  existing `@forward 'index'` (covered by app compile + R2).

## Unit test targets

- None required for pure-SCSS migrations; existing specs (`nav-sections`,
  component specs) must stay green (`npx jest`).
- Gallery component spec (if present) — update demo-count expectations.

## Edge cases

- `dir-count` consumers now carry `.badge dir-long`/`dir-short` markup —
  verify no orphaned `.dir-count` styles remain.
- `.review`/`.accept` pill-btn local rules stay until the ACR surfaces
  are deleted — relay must not flag them outside migrated files.
- Toolbar `.spacer` class name — canonical contract is `.toolbar-spacer`
  (chart-toolbar's name); migrations normalize `header-spacer` etc.
