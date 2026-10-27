# Verification Guide: /dev/ds Explorer + Palette Lock (#1211)

**Task:** #1211 — `FE: /dev/ds palette lock (explorer shipped 2026-10-22)`
**Blueprint:** #1202 (FE: theme plumbing + bridge + explorer + sweep)
**Script:** `design-system-palette-lock-1211.ts` — no credentials.

## What it verifies

The `/dev/ds` explorer formalized under the shipped `--ds-*` taxonomy:

1. **Real compile** — `ds-gallery.component.scss` through dart-sass with the
   vendored `node_modules/savant-ds/styles` includePaths.
2. **Explicit `data-theme`** — the host binding emits `dark|light`, never
   attributeless. An attributeless host inherits the app root's attribute:
   under a dark app a "light" preview would silently render dark tokens
   (the app-state leak the host-scoping AC forbids).
3. **Shipped-name binding** — accent previews derive the full `--ds-accent`
   family (accent / on-accent / containers / border / glow) from
   `--picker-accent` in both modes, not just the `--mat-sys` bridge;
   `--ds-up`/`--ds-down` bind on the host styles.
4. **Light restate parity** — every `--ds-*` literal the dark token set
   re-declares in `vendor/savant-ds/styles/_tokens.scss` is restated
   verbatim under `:host[data-theme=light]`. Parsed from the vendored
   source, so any shipped-token change fails loudly here instead of
   drifting.
5. **Dark mirror parity** — the `:host[data-theme='dark']` block mirrors
   every `--mat-sys-*` literal in the app `:root` bridge (`src/styles.scss`).
   Redundant under a dark app, load-bearing under a light one.
6. **Palette lock** — `lockPalette`/`clearPaletteLock` + the
   `ds-gallery.palette-lock` localStorage key; the lock readout renders
   accent/up/down hexes in the template.
7. **Adjacency check** — `hueOf`/`hueDistance`/`upAdjacency` exist and the
   warning is rendered on the up-picker *and* the direction-badge demo
   (the AC surface for green-family accents).
8. **No app-state leak** — the component never writes `data-theme` or
   app-level theme state. The one deliberate exception is the *app-accent
   preview* toggle (`App` chip): it pushes the derived `--ds-accent` +
   `--mat-sys-primary` families onto `<html>` so a candidate can be judged
   on real pages, and self-clears on toggle-off/`ngOnDestroy`. The relay
   pins the self-cleanup.
9. **Persistence intact** — `ds-gallery.swatches` / `ds-gallery.palettes`
   keys, `inspectColors`, `compareName`.
10. **`SHIPPED_ACCENT` parity** — the component's `'current'` fallback
    copies the shipped `--ds-accent` light/dark literals; pinned against
    `_tokens.scss` so post-bake token edits can't drift the lock and
    adjacency resolution stale.

## Run

```bash
npx tsx scripts/verify/design-system-palette-lock-1211.ts
```

**SKIP (exit 0):** `node_modules/savant-ds` missing → run `npm install`.

## Pass

```
OK   gallery scss compiles through vendored includePaths
...
=== ALL 19 CHECKS PASSED ===
```

## Fail

`FAIL` lines name the broken check and (for parity checks) the first
mismatched keys with want/got values. Common causes:

- Shipped `--ds-*` literals edited in `_tokens.scss` without updating the
  gallery light restate → parity check 4 fails (fix: sync the literals or
  re-run the palette lock through the explorer).
- App `--mat-sys` bridge values changed without updating the gallery dark
  block → parity check 5 fails.
- Host binding reverted to attributeless → check 2 fails (re-introduces
  the dark-app→light-preview leak).

## Manual follow-up (UAT)

This relay is static — the AC's *visual* half stays manual: pick a
green-family accent (Mint/Acid) on `/dev/ds`, confirm the adjacency flag
fires on the up-picker and the LONG badge still reads distinct from the
accent; lock the palette, refresh, confirm the readout survives.
