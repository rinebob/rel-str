# Test Plan — SHARED: theme token layer

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1194  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** TEST  
**Status:** Draft  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Scope

`savant-ds/styles/_tokens.scss` — the full semantic color vocabulary in
light (`:root`) and dark (`[data-theme="dark"]`) sets. Pure Sass; the
seam is compile + emitted-CSS inspection, not runtime.

## E2E / visual journeys (manual, dev server)

- E1: `/dev/ds` with the new token sets — every demo card legible in
  light (default, no attribute) and under `data-theme="dark"`.
- E2: direction badges/edges/pills/strips carry `--ds-up`/`--ds-down`
  defaults matching today's `#4caf50`/`#f44336`; container tints render
  on banner/chip demos.
- E3: accent family check — chosen accent appears on borders, headings,
  accent containers, glow; base surfaces stay hue-free grey.
- E4: up-token vs accent adjacency — if a green-family accent ships, the
  direction-badge demo shows up and accent clearly distinct.

## Verify relay — `design-system-theme-tokens-<task>.ts`

- R1: `_tokens.scss` compiles via `sass` with no errors.
- R2: emitted CSS contains every required token name — surfaces
  (`--ds-surface`, `-raised`, `-overlay`, `--ds-on-surface`,
  `-on-surface-variant`, `--ds-border-subtle`, `-strong`), accent
  (`--ds-accent`, `-on-accent`, `-container`, `-on-accent-container`,
  `-border`, `-glow`), direction (`--ds-up`, `--ds-down`, `-container`,
  `-on-*-container`), feedback (success/error/warning + `-container` +
  `-on-*-container`). The `on-{x}-container` names pair only with their
  `{x}-container` fill — they are not text-on-solid tokens.
- R3: light values emitted under `:root`; dark overrides under
  `[data-theme="dark"]` — assert selector presence, not specific hexes.
  (Emission-model deviation — see SHARED IMPL: the staging-safe order,
  nothing flips until the F1 bootstrap sets the attribute.)
- R4: no `color-mix(` in the emitted token declarations.
- R5: vendored copies (`vendor/savant-ds/` in rel-str and av-proxy-api)
  byte-identical to package source after sync.

## Integration boundaries

- `_index.scss` never forwarded `tokens` by design (tokens emit once
  from the app's global `styles.scss` via `@use 'tokens'`) — an app
  compile catches a break in that path.
- `--mat-sys` alias comments updated; the app-level `styles.scss` bridge
  supplies both modes (FE plan), so package comments must not imply a
  light-only bridge.

## Unit test targets

- None — declarative SCSS. Relay + compile is the test surface.

## Edge cases

- Bootstrap failure → the app lands on light, not the product-default
  dark — readable-wrong rather than half-flipped (deliberate consequence
  of the staging-safe emission model; a broken bootstrap means no
  Angular anyway).
- Consumers that assumed `:root` = the Material-mirrored values (legacy
  `--mat-sys` aliases) now get baked light literals — visually identical
  to the pre-#1204 light resolution.
- Missing dark override for a new color token → dark mode silently
  inherits the light value; the dark-block exact-name-set check in
  verify.mjs catches it.
