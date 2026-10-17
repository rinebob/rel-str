# Verification Guide — task #1040: `_pd-visual-language` delegation shim

## `design-system-vl-shim-1040.ts`

Proves the shim contract on
`src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`:

- `@forward 'index'` delegates the 7 graduated mixins to savant-ds
  (page-host, page-shell, content-column, header-bar, dialog-chrome,
  dialog-status, error-banner) — zero local bodies for those names,
  exactly one `@forward`, and no `index*` partial/dir beside the shim
  (an importer-relative shadow would silently reroute the delegation)
- The 5 ungraduated data-display mixins stay sole-source in the file
  pending #1052 (dense-table, state-block, bounded-tab-group,
  tab-scroll-pane, stat-strip); no unexpected extra mixins
- `$up`/`$down` are `var(--ds-up)`/`var(--ds-down)` reads — no hex
  accent literals remain
- Header names savant-ds as the source of truth
- Live compile through the real includePaths resolves all 12 mixin
  names + `vl.$up`/`vl.$down` (14 members), emitted via the shim with
  no `:root`/token leakage

Comment-stripped source scans — a commented-out `@forward`/`@mixin`
can't fake a pass. Sass comes from the savant-ds checkout's own
devDependency via `createRequire` (same pinned compiler as the package
verify; rel-str doesn't declare `sass`).

### Usage

```powershell
npx tsx scripts/verify/design-system-vl-shim-1040.ts
```

### Prerequisites

- Sibling `../savant-ds` checkout with `npm install` run inside it
  (SKIPPED cleanly when absent — the junction makes it the same tree
  `node_modules/savant-ds` resolves to).

### Pass criteria

`=== ALL CHECKS PASSED ===`, exit 0 — 39 checks.

### Notes

- Verbatim declaration semantics for the delegated mixins were proven by
  the `#1036`/`#1037` parity probes — this relay asserts the delegation
  is *live* (names resolve, bodies emit), not the decl text.
- Jest AC evidence (`portfolio-dashboard` specs green) is in the UAT
  doc — component specs don't compile SCSS, so the relay covers the
  stylesheet layer.
