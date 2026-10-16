# Verify guide — #1035: savant-ds token layer (`_tokens.scss`)

## What it proves

`scripts/verify/design-system-tokens-1035.ts` runs the package's own
`npm run verify` inside `../savant-ds` and relays its result. The real
checks live in `C:\aa\projects\savant-ds\scripts\verify.mjs`:

- `styles/_index.scss` exists; `styles/` populated; no `@import`
  directive anywhere in `styles/` (dual-sass-version contract)
- `styles/_tokens.scss` sass-compiles clean via the real `sass`
  devDependency
- every documented `--ds-*` token name appears in the compiled output:
  surfaces (`--ds-surface`, `--ds-on-surface`, `--ds-surface-variant`,
  `--ds-error`, `--ds-border-subtle`), P&L accents (`--ds-up`,
  `--ds-down`), spacing `--ds-space-1..6`, font size/weight triples,
  density (`--ds-row-height`, `--ds-field-height`), elevation
  (`--ds-shadow-1/2`, `--ds-radius-sm/md`)
- `[data-theme="dark"]` overrides emitted
- Material-mirroring tokens alias `var(--mat-sys-*)`
- `@use 'tokens'` resolves via a `loadPaths` entry — the exact shape
  consumers get from `stylePreprocessorOptions.includePaths`

## Usage

```bash
npx tsx scripts/verify/design-system-tokens-1035.ts
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
