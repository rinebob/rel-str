# #1039 — savant-ds consumption wiring

Relates to issue #1039 (FE blueprint #1031 → Phase #1033). Proves THIS
app consumes the package — the #1034 relay proved `file:` installability
in a scratch consumer; this checks the real wiring the app builds with.

## What it checks

- `package.json` declares `"savant-ds": "file:vendor/savant-ds"` — the
  **committed** copy (#1071: `file:../savant-ds` can't resolve in cloud
  builds; `../savant-ds` stays the source of truth, synced via
  `npm run sync:ds`)
- `node_modules/savant-ds` exists, is a **link/junction** (not a copied
  dir — vendor edits must propagate), and its realpath resolves to
  `vendor/savant-ds`
- **Vendor drift** — every file in `vendor/savant-ds/styles/` is
  content-identical to `../savant-ds/styles/` (names + contents,
  line-ending normalized — IDE CRLF re-saves don't false-positive; an
  unsynced package edit FAILs with the `npm run sync:ds` remedy)
- `angular.json` carries `stylePreprocessorOptions.includePaths:
  ["node_modules/savant-ds/styles"]` on **both** SCSS-compiling targets
  (`build` and `test` — component styles compile under karma too)
- `src/styles.scss` loads the token layer (`@use 'tokens'`) via the
  package specifier
- **No `src/` shadow** — Sass resolves `@use 'tokens'` importer-relative
  before loadPaths, so a future `src/_tokens.scss` (or `tokens.scss`,
  `tokens/`, and the same for every package partial name) would
  silently reroute the layer while every other check stays green. The
  shadowable-name list is **derived** from the installed `styles/` dir,
  so new partials (e.g. `data-display` in #1052) enter the guard
  automatically.
- A `sass.compileString("@use 'tokens'")` through the real installed
  includePaths emits **every** `--ds-*` token declared in
  `_tokens.scss` (read live from the package — not hard-coded) scoped to
  the `:root` block with boundary-exact matching, plus the
  `[data-theme="dark"]` overrides. Sass comes from the package's own
  devDependency via `createRequire` — rel-str doesn't declare `sass`.

## Running

```
npx tsx scripts/verify/design-system-consumption-1039.ts
```

- **Prereqs:** sibling `../savant-ds` checkout with `npm install` run
  there (its `sass` devDependency is the compiler used here), and
  `npm install` in rel-str so `node_modules/savant-ds` exists.
- **Passing:** `OK` per check, `=== ALL CHECKS PASSED ===`, exit 0.
- **Sibling missing:** prints `SKIPPED`, exit 0 (deliberate — same
  contract as the other savant-ds relays).
- **Failing:** `FAIL` lines, `=== N CHECK(S) FAILED ===`, exit 1.

## What it does NOT check

- `npm run build` — AC2's green-build evidence is produced by actually
  building (verified during implementation; the emitted
  `dist/rel-str/browser/styles-*.css` carries the `--ds-*` set).
- Runtime `:root` inspection in a live browser — UAT manual item.
