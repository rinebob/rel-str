# Implementation Plan — FE: theme plumbing, bridge, explorer, sweep

**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Thread:** Theme & Palette  
**Thread Slug:** theme-palette  
**Issue:** #1194  
**Thread Parent:** #1161  
**Topic Parent:** #1024  
**Domain:** DESIGN-SYSTEM  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

## Scope

Everything app-side: theme bootstrap + toggle, the `--mat-sys` bridge,
the `/dev/ds` palette explorer, and the app-wide literal sweep. Depends
on the SHARED token layer for final token names.

## Phase 1 — Theme plumbing

- **Bootstrap before paint**: a small synchronous script in
  `index.html` reads `localStorage['savant-theme']` and sets
  `document.documentElement.dataset.theme` (`'dark'` when unset). Runs
  before Angular bootstraps — no flash of wrong theme, no JS-framework
  dependency.
- **`ThemeService`** (core): signal-backed `theme()` ('dark'|'light'),
  `toggle()`, `set()`. Writes `data-theme` on `documentElement` +
  persists to `localStorage`. Single authority — the gallery and the
  header toggle both call it.
- **Header toggle**: a light/dark icon button in the app header
  (mat-icon-button is fine — #1163 replaces it later). Calls
  `ThemeService.toggle()`.
- Default resolution: stored value → else `'dark'`. No
  `prefers-color-scheme` probing.

## Phase 2 — `--mat-sys` bridge

`src/styles.scss` currently emits one light `--mat-sys-*` block. Extend
to two blocks matching the SHARED model (`:root` light +
`[data-theme="dark"]` dark — see the SHARED IMPL emission-model section
for why light sits in `:root`):

- `:root` — the existing light values, unchanged.
- `[data-theme="dark"]` — a dark `--mat-sys-*` set (primary/accent,
  surfaces, on-colors, error, outline-variant…) so un-migrated Material
  components render legibly once bootstrap sets the attribute.

The `--ds-*` tokens are already self-contained literals (SHARED #1204
removed the aliases); `--mat-sys` survives purely as the Material bridge
until #1163 removes it. Deliberately minimal — legibility, not polish.
Sequencing note: the F1 bootstrap (#1207) and this dark bridge should
land together — `data-theme="dark"` without it flips DS surfaces while
Material chrome stays light.

## Phase 3 — `/dev/ds` explorer + palette lock

The working explorer already exists (uncommitted): accent preset
swatches, native color picker seeded from the active preset, up/down
pickers binding `--ds-up`/`--ds-down` on the gallery host, saved accents
+ named palettes in `localStorage`, apply/compare, and the token
inspector. This phase:

- Formalizes the explorer under the new token taxonomy (bindings target
  the shipped `--ds-*` names).
- **Palette lock**: user picks final accent + up/down hexes on the page;
  chosen values are recorded and baked into the SHARED token sets.
  Purple rejected; Arcade Blue darkened; Neon Cyan / Neon Mint are the
  front-runners. Neon-green accents require the adjacent check against
  `--ds-up` on the direction-badge demo before locking.

## Phase 4 — Literal sweep (inventory-driven)

`docs/topics/1024-design-system/ui-color-sites.json` (script:
`scripts/inventory-ui-colors.mjs`) lists ~3,994 candidate color sites in
195 files. Sweep converts literal colors in component styles to
`var(--ds-*)` references (or documented semantic roles). Split by
feature area so commits stay atomic:

- Global/styles layer (`styles.scss`, `app/styles/`, `_variables-global`)
- savant-trader feature pages (trading/live, portfolio, paper)
- options surfaces (strategy builder, dashboard, chain)
- shared components (dialogs, tables, review surfaces)
- long-tail cleanup + inventory re-run

**Exceptions, documented per-site:** chart-series/indicator colors,
order-side colors that are intentionally not accent-bound, third-party
(Syncfusion) styles, and literal values that are genuinely one-off
(non-color-themable). Each exception gets a comment or inventory tag —
the goal is zero *untriaged* literals, not zero literals.

## Cross-area boundaries

- FE Phases 2–4 are **blocked by SHARED** (need final token names).
  Phase 1 plumbing is independent.
- Palette lock (Phase 3) gates the *values* baked in SHARED S1 — the
  SHARED task and palette lock are done together in practice.
- The sweep overlaps #1163's territory only where a surface is about to
  be rewritten anyway — sweep still converts colors to tokens first so
  De-Materify inherits themed markup.

## Verification

- `npx jest` stays green; new specs for ThemeService (storage, attribute,
  toggle) and any explorer logic changes (existing 9 specs extended).
- Sass compile of `_tokens.scss` + `styles.scss` + gallery styles.
- Visual UAT: `/dev/ds` both modes; spot-check trading/live, portfolio,
  options pages under dark + light.
- Sweep verification: re-run `inventory-ui-colors.mjs`, diff literal
  counts per area; every remaining literal has an exception marker.

## Out of scope

- SavantAPI rollout; Syncfusion recolor; order/chart color changes;
  Material component replacement (#1163); card component (#1162); chart
  layout (#1164).
