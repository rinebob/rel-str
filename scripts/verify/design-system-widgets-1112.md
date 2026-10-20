# Verification Guide — task #1112: widget contract relay

## `design-system-widgets-1112.ts`

Static and compile-level verification of the shipped widget layer across the
canonical package, both vendored consumers, the SavantTrader forwarding shim,
the `/dev/ds` gallery contract, and the design-system inventory.

## Usage

```powershell
npx tsx scripts/verify/design-system-widgets-1112.ts
```

The script accepts no flags or positional arguments.

## Prerequisites

- Run from the `rel-str` repository root.
- Sibling checkouts must exist at `../savant-ds` and `../av-proxy-api`.
- Dependencies must be installed in `savant-ds` so its pinned Sass API can
  compile the `vl.*` fixture.

## Checks

1. `savant-ds/styles/_widgets.scss` and `_index.scss` exist.
2. The rel-str and SavantApi vendored copies are byte-identical to the
   package copies.
3. `_index.scss` forwards `widgets` exactly once.
4. `_widgets.scss` exports exactly the nine contracted mixins.
5. Executable Sass contains no retired verdict/ACR/expando/Material-expansion
   artifacts; comments are stripped before this guard runs.
6. `_pd-visual-language.scss` still forwards `index`, and a fixture using all
   nine `vl.*` mixins compiles through the real package include paths.
7. Every widget has a gallery entry, template case, and `ds.*` include; there
   are exactly nine widget entries.
8. Every widget has moved into the inventory's Extracted table and none remains
   as a Candidate row key; later migration candidates may still cite an extracted
   widget as their target.

## Deferred migration checks

The original FE test plan listed consumer-migration checks as R6, but Task
#1112 is in Phase 1 while those migrations belong to Phase 2 Tasks #1114 and
#1115. Enforcing them here would make this relay unable to pass before Phase 2.
Those tasks must add their own checks for expected `vl.*` includes and retired
literal removal when each migration lands.

## Pass and failure

- **Pass:** every line is `OK`, the final count has no failures, and the process
  exits `0`.
- **Failure:** one or more `FAIL` lines identify the drift and the process exits
  `1`. Restore package/vendor parity, the missing public contract, gallery
  coverage, or inventory row and rerun.

The relay is disk-only and has no setup or teardown side effects.
