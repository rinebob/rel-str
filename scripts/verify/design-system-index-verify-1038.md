# Verify guide — #1038: savant-ds index forwards + full-surface verify

## What it proves

`scripts/verify/design-system-index-verify-1038.ts` runs the package's own
`npm run verify` inside `../savant-ds` and relays its result. For #1038 the
real checks in `C:\aa\projects\savant-ds\scripts\verify.mjs` are:

- `styles/` directory contents set-equal with the partial manifest — a
  dropped-but-unforwarded partial can't hide unverified mixins
- `_index.scss` contains only `@forward` statements AND forwards exactly
  `page`, `dialog`, `feedback` — tokens are never forwarded (emission
  contract); a missing or extra forward fails
- every `@mixin` defined anywhere in `styles/` (outside `_index`/
  `_tokens`) is exercised by an index fixture — public-surface coverage,
  both directions
- (carried from #1035–#1037) token manifest/values/dark/alias surface,
  per-mixin declaration assertions, emission contracts, `@keyframes
  spin` non-redefinition, no hex literals, no `@import`, direct-partial
  resolution via `loadPaths`

## Usage

```bash
npx tsx scripts/verify/design-system-index-verify-1038.ts
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
