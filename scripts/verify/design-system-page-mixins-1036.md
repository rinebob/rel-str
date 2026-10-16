# Verify guide — #1036: savant-ds page/layout mixins (`_page.scss`)

## What it proves

`scripts/verify/design-system-page-mixins-1036.ts` runs the package's own
`npm run verify` inside `../savant-ds` and relays its result. The real
checks live in `C:\aa\projects\savant-ds\scripts\verify.mjs`:

- `styles/_page.scss` exists and the four mixins compile through a
  `@use 'index' as ds` fixture via `loadPaths` — the exact shape consumers
  get from `stylePreprocessorOptions.includePaths`
- emitted properties match `_pd-visual-language.scss` source semantics,
  tokenized: `page-host` (`calc(100vh - var(--header-height, 0px))`),
  `page-shell` (flex column + `--ds-surface`/`--ds-on-surface`),
  `content-column` (1100px cap), `header-bar` (`--ds-space-*` padding/gap,
  `--ds-border-subtle` border, `.bar-actions` right-anchored cluster,
  compact stroked buttons at `--ds-row-height`/`--ds-font-size-sm`)
- emission contract: `@use 'index'` emits no `:root`/`--ds-*` block —
  mixins are compile-time only
- direct `@use 'page'` partial resolution via `loadPaths`

## What the relay adds locally

After the package verify passes, this script runs a **verbatim-semantics
parity probe**: it compiles the same four mixins from BOTH
`savant-ds/styles/_page.scss` (via `@use 'index'`) and the source
`src/app/features/portfolio-dashboard/styles/_pd-visual-language.scss`,
normalizes `var(--ds-*)` to whatever the compiled `_tokens.scss` `:root`
block actually declares (derived map — token-value changes surface as
real diffs, not normalized away), and diffs emitted declarations per
selector. `OK` means byte-identical semantics; any `source-only`/
`ds-only` line is a FAIL — this is what makes AC2 ("matches source
semantics verbatim") executable rather than asserted. It also asserts
`_page.scss`'s `@mixin` surface equals the probed set (a mixin added
without coverage fails) and that every probed name exists on both sides.

## Usage

```bash
npx tsx scripts/verify/design-system-page-mixins-1036.ts
```

## Passing

The relayed `npm run verify` prints `OK` per check and ends with
`All checks passed.`; this script prints `=== ALL CHECKS PASSED ===` and
exits 0.

## Failing

Any `FAIL` line in the relayed output, or `=== PACKAGE VERIFY FAILED ===`
+ exit 1.

## Setup / teardown

- Needs the sibling checkout at `C:\aa\projects\savant-ds`; without it
  run-all reports SKIPPED (`needsPath`), and this script exits 0 with a
  SKIPPED line when run standalone.
- No credentials, no network, nothing written.
