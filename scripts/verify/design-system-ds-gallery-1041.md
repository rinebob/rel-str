# Verification Guide — task #1041: /dev/ds element gallery

## `design-system-ds-gallery-1041.ts`

Static + compile-level proof that the gallery exists and consumes the
package honestly — no browser needed.

### What it checks

1. **Route wiring** — `AppRoutes.DS_GALLERY = 'dev/ds'`, `PAGE_INFO`
   entry, nav child, core-routes block with `loadComponent` +
   `authGuard` (same shape as `dev/gallery`).
2. **Files exist** — `ds-gallery.component.{ts,html,scss,spec.ts}`.
3. **Package consumption** — the SCSS `@use 'index' as ds`; every
   `@include ds.<name>` is pinned against the mixin surface parsed live
   from the vendored partials (an include of a non-existent mixin
   FAILs); zero local `@mixin` bodies — the demos can never silently
   fork the package; **no `index*` partial beside the component** (an
   importer-relative shadow reroutes the `@use` before includePaths —
   same guard class as the #1040 shim relay).
4. **Live compile** — the component's own SCSS is compiled by the
   package's pinned sass through the real includePaths; emitted CSS is
   non-trivial and carries no `:root` token leakage.
5. **Template contract** — `@for (entry of entries; track entry.kind)`,
   `.seen-in` footnote + `entry.seenIn.join`, `[attr.data-theme]` dark
   toggle on the host, spec covers the flip.

### Usage

```powershell
npx tsx scripts/verify/design-system-ds-gallery-1041.ts
```

### Prerequisites

- Sibling `../savant-ds` checkout with `npm install` run inside it
  (SKIPPED cleanly when absent).

### Pass criteria

`=== ALL CHECKS PASSED ===`, exit 0 — 37 checks.
