# Implementation Plan — SHARED: theme token layer

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1194  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** IMPL  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Scope

Extend `styles/_tokens.scss` in the `savant-ds` package from the current
~30-token foundation set to a complete semantic color vocabulary with
full dark and light sets. No Angular code, no mixins changes — tokens
only. Consumed identically by both apps (SA inherits on its own rollout).

## Token emission model — `:root` is light, `[data-theme="dark"]` is dark

*Deviation from the approved approach.* The approved direction was
`:root`=dark + `[data-theme="light"]` (bootstrap failure lands on dark).
Reconsidered during #1204 implementation: the vendored sync (S2) ships
before the bootstrap plumbing (F1) — with `:root`=dark, every DS surface
would flip dark while Material chrome stays light, a visibly broken
interim. With the established convention (`:root` light +
`[data-theme="dark"]`), nothing changes until F1's bootstrap sets the
attribute — every intermediate state stays coherent, and a broken
bootstrap means no Angular anyway (not a wrong theme). Dark is still the
product default: bootstrap writes `data-theme="dark"` whenever no stored
preference exists.

## Token families

All values are **baked literals** — no `color-mix` in shipped tokens.
`color-mix` remains dev-page tooling (`/dev/ds` explorer) where its
live-derivation is the feature.

### Neutral surfaces (hue-free grey ramp)

| Token | Role |
|---|---|
| `--ds-surface` | page background |
| `--ds-surface-raised` | cards, panels |
| `--ds-surface-overlay` | dialogs, menus |
| `--ds-on-surface` | primary text |
| `--ds-on-surface-variant` | secondary/muted text |
| `--ds-border-subtle` | hairlines, card borders |
| `--ds-border-strong` | emphasized edges |

Dark ramp approx: `#0f1114` / `#181b1f` / `#212529` with `--on-surface`
near `#e6e8eb`. Light ramp is the mirror (`#ffffff`/`#f5f6f8`/`#eceef1`,
dark text). Surfaces carry **no hue tint** — neutral grey in both modes.

### Brand Accent family

| Token | Role |
|---|---|
| `--ds-accent` | primary accent — borders, headings, interactive |
| `--ds-on-accent` | text/icon on accent fills |
| `--ds-accent-container` | accent-tinted surface (accent cards) |
| `--ds-on-accent-container` | text on accent container |
| `--ds-accent-border` | accent-colored border value |
| `--ds-accent-glow` | shadow/glow value for accent elements |

One accent per mode (dark-mode accent is brighter; the same hue is
darkened in light mode for contrast). Final hexes are locked on `/dev/ds`
before this task ships — Neon Cyan and Neon Mint are the front-runners.

### Direction Colors

| Token | Role |
|---|---|
| `--ds-up` | long/up/buy-positive — default `#4caf50` (preserved) |
| `--ds-down` | short/down/sell-negative — default `#f44336` (preserved) |
| `--ds-up-container` | up-tinted background (banners, chips, pills) |
| `--ds-on-up-container` | text on the up container fill only |
| `--ds-down-container` | down-tinted background |
| `--ds-on-down-container` | text on the down container fill only |

Naming contract (M3): `on-{x}` pairs with the solid `{x}` fill;
`on-{x}-container` pairs ONLY with `{x}-container` — never emit
`color: var(--ds-on-up-container)` over a `var(--ds-up)` background.
On-solid direction/feedback tokens land when a consumer needs one.

Defaults preserve today's values. If the chosen Brand Accent lands near
green, the up token may need a small hue shift to stay visually distinct
— checked adjacently on the direction-badge demos before locking.

### Feedback family

| Token | Role |
|---|---|
| `--ds-success` / `--ds-success-container` / `--ds-on-success-container` | positive status |
| `--ds-error` / `--ds-error-container` / `--ds-on-error-container` | errors |
| `--ds-warning` / `--ds-warning-container` / `--ds-on-warning-container` | warnings |

Dark-mode values brightened for legibility on grey; light mode uses the
existing light-tuned values. Success/error remain related to but
distinct from `--ds-up`/`--ds-down` (status vs direction semantics).

### Existing tokens

Spacing, typography, density, radius tokens are unchanged. The existing
`--ds-up`/`--ds-down` literals keep their values in both sets; shadows
deepen under `[data-theme="dark"]` as before.

## Tasks

- **S1 — Token taxonomy + emission**: rewrite `_tokens.scss` with the
  families above under `:root` (light) + `[data-theme="dark"]`; keep the
  existing non-color tokens and the `--mat-sys` alias comments updated to
  reflect that the bridge is light-only today and FE Phase 2 (#1209)
  supplies the dark half.
- **S2 — Vendored sync + sass verify**: run the existing sync to
  `vendor/savant-ds/` in both apps; extend `scripts/verify` relay to
  assert the new token names compile and both modes emit.

## Out of scope

- Mixin changes (`_widgets`, `_feedback`, `_page`) — they consume
  `var(--ds-*)` and pick up new tokens transparently.
- The app-level `--mat-sys` bridge, theme toggle plumbing, palette
  explorer, and literal sweep — FE Blueprint.
- Locking the final accent/direction hexes — decided on `/dev/ds` in FE
  Phase 3; SHARED lands whatever values that pass selects.
