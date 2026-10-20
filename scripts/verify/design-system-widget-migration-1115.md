# Verification Guide — task #1115: chart/gallery widget migration

## `design-system-widget-migration-1115.ts`

Static and compile-level verification that Chart Toolbar and Group Panel use
the shared Widget Layer rather than retaining local widget chrome.

## Usage

```powershell
npx tsx scripts/verify/design-system-widget-migration-1115.ts
```

The script accepts no flags or positional arguments.

## Prerequisites

- Run from the `rel-str` repository root.
- Dependencies are installed; Sass compiles against `vendor/savant-ds/styles`,
  the same package path used by Angular.

## Checks

1. Both component stylesheets import the real visual-language shim.
2. Chart Toolbar consumes `toolbar-row`, `icon-btn`, `pill-toggle`, and
   `nav-stepper`.
3. Chart Toolbar markup uses canonical icon, dim-state, pill-group/flat/pill,
   toolbar-spacer, and nav-stepper classes.
4. The shared flat-toggle active state has a visibly distinct primary fill and
   matching foreground.
5. Group Panel consumes `icon-btn` and `badge`, uses canonical markup, and
   shows exactly two flat pill groups in Chart Toolbar.
6. Stale Group Panel badge/direction selectors with no template markup are
   absent, and the flat-toggle active/hover states carry distinct fills.
7. The relay guide and root runner/index registrations are present.
8. Both component stylesheets compile through the vendored package.

## Pass and failure

- **Pass:** 30/30 checks pass and the process exits `0`.
- **Failure:** each drift prints a `FAIL` line and the process exits `1`.
  Restore the canonical class contract, shared include, dead-selector cleanup,
  registration, or Sass compilation and rerun.

The relay is disk-only and has no setup or cleanup side effects.
