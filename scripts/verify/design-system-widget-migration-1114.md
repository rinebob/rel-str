# Verification Guide — task #1114: signals/review widget migration

## `design-system-widget-migration-1114.ts`

Static and compile-level verification that the four Signals/Review consumers
use the shared Widget Layer rather than retaining local copies of its chrome.

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

1. All four component stylesheets import the visual-language forwarding shim.
2. `signal-filter-pills` consumes `pill-toggle`.
3. `signal-review-header` consumes `toolbar-row`, `pill-btn`, and `badge`.
4. `review-header` consumes `toolbar-row`, `icon-btn`, and `pill-btn`; stale
   field/chip/badge/decision selectors with no template markup are absent.
5. `signal-table` consumes `badge` and `dir-edge`.
6. Canonical markup contracts are present for toolbar spacers, timeframe and
   direction badges, emphasized totals, icon buttons, order pills, and table
   row edges.
7. The local `.review`/`.accept` pill variants remain local until their
   retired workflow is deleted.
8. Migrated files contain none of the retired direction literals named by
   Task #1114.
9. All four component stylesheets compile through the real shim and package
   include paths.

## Pass and failure

- **Pass:** 47/47 checks pass and the process exits `0`.
- **Failure:** each drift prints a `FAIL` line and the process exits `1`.
  Restore the canonical class contract, shared mixin include, token binding,
  or Sass compilation and rerun.

The relay is disk-only and has no setup or cleanup side effects.
