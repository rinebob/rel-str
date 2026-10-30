# Verification Guide — task #1114: signals/review widget migration

## `design-system-widget-migration-1114.ts`

Static and compile-level verification that the surviving Signals/Review
consumers use the shared Widget Layer rather than retaining local copies of
its chrome. `review-header` was retired with chart-review (#1260) and its
checks were dropped; the remaining three consumers stay covered.

## Usage

```powershell
npx tsx scripts/verify/design-system-widget-migration-1114.ts
```

The script accepts no flags or positional arguments.

## Prerequisites

- Run from the `rel-str` repository root.
- Dependencies are installed in `rel-str`; Sass resolves the same vendored
  package path used by the Angular build.

## Checks

1. All three component stylesheets import the visual-language forwarding shim.
2. `signal-filter-pills` consumes `pill-toggle`.
3. `signal-review-header` consumes `toolbar-row`, `pill-btn`, and `badge`.
4. `signal-table` consumes `badge` and `dir-edge`.
5. Canonical markup contracts are present for toolbar spacers, timeframe and
   direction badges, emphasized totals, and table row edges.
6. The local `.review`/`.order` pill variants remain local.
7. Migrated files contain none of the retired direction literals named by
   Task #1114.
8. All three component stylesheets compile through the real shim and package
   include paths.

## Pass and failure

- **Pass:** 33/33 checks pass and the process exits `0`.
- **Failure:** each drift prints a `FAIL` line and the process exits `1`.
  Restore the canonical class contract, shared mixin include, token binding,
  or Sass compilation and rerun.

The relay is disk-only and has no setup or cleanup side effects.
