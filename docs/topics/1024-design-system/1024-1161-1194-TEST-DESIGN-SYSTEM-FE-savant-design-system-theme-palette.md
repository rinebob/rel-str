# Test Plan — FE: theme plumbing, bridge, explorer, sweep

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

Theme bootstrap + toggle service, `--mat-sys` dark/light bridge,
`/dev/ds` palette explorer formalization, and the app-wide literal
sweep. All FE; no BE surface.

## E2E / visual journeys (manual, dev server)

- E1: cold load with cleared storage → app renders dark on first paint
  (no light flash).
- E2: header toggle → light mode applies live; reload persists; toggle
  back → dark persists.
- E3: `/dev/ds` — accent preset swap, custom picker (seeded from active
  preset), up/down pickers retint all direction demos; save palette →
  refresh → apply restores; compare shows stored vs current per token.
- E4: swept surfaces under dark — trading/live, portfolio, options
  builder, dialogs: no light-tuned literals stranded on dark (white text
  on white, washed-out greys, invisible borders).
- E5: light mode across the same surfaces — legible, accent contrast ok.
- E6: Material surfaces that remain (menus, dialogs, form fields)
  legible on dark via the bridge — functional, not final design.
- E7: charts unchanged — Syncfusion chart colors, indicators, buy/sell
  markers identical to pre-change.

## Verify relay — `design-system-theme-fe-<task>.ts`

- R1: `index.html` contains the synchronous data-theme bootstrap script
  before the app bundle tag.
- R2: `styles.scss` emits `--mat-sys-*` under both `:root` (light) and
  `[data-theme="dark"]` — matching the SHARED emission model.
  **Superseded by #1209 task body:** shipped inverted — `:root` = dark,
  `[data-theme="light"]` = pre-change light (see
  `design-system-mat-sys-bridge-1209.md` for why).
- R3: `inventory-ui-colors.mjs` re-run after each sweep phase shows the
  phase's literal count dropped; remaining literals carry exception
  markers.
- R4: no component `.scss` in swept areas introduces new hex/rgba color
  literals (diff-grep the phase's file set).
- R5: `--ds-up`/`--ds-down` values unchanged from pre-sweep defaults.

## Integration boundaries

- `ThemeService` is the only writer of `data-theme` post-bootstrap; the
  explorer's preview state stays host-scoped and never writes app theme.
- The sweep touches files also being edited by concurrent topics —
  selective staging discipline applies (no foreign hunks in theme
  commits).
- `#1163` overlap: surfaces scheduled for Material rewrites still get
  tokenized colors first.

## Unit test targets

- `ThemeService` spec: default dark, storage round-trip, attribute
  write, toggle, corrupt-storage fallback.
- `ds-gallery` spec: existing 9 specs stay green; add/adjust for renamed
  bindings and palette-lock flow.
- Swept components' existing specs must stay green (`npx jest`).

## Edge cases

- `localStorage` holds a legacy/unknown value → falls back to dark,
  never throws.
- Toggle during a Material overlay (open menu/dialog) → new theme
  applies on next render without trapping the overlay.
- A swept file that relied on literal color contrast in both modes gets
  a semantic role (e.g. warning text) rather than a raw accent token —
  catch in visual pass E4/E5.
- Syncfusion's imported light stylesheet must not be "fixed" by the
  sweep — its selectors stay out of scope and untouched.
